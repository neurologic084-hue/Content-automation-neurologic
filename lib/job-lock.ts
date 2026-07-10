// ── Per-job serialization for video_jobs.variants updates ─────────────────────
// Every variant renders concurrently and updates the SHARED `variants` JSON on
// the job row by read-modify-write (select the array, change its own entry, write
// it all back). When two variants finish at nearly the same time they read the
// same snapshot and their writes clobber each other — a classic lost update —
// leaving a variant stuck "processing" or pointing at a stale URL even though its
// render actually succeeded.
//
// All updaters run inside one server process, so an in-process per-job promise
// chain is enough to make these updates atomic: each patch waits for the previous
// one on the same job, then reads FRESH state before writing.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoVariant } from './video-pipeline'
import { notifyOps } from './notify'

const chains = new Map<string, Promise<unknown>>()

export async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = (chains.get(jobId) ?? Promise.resolve()).catch(() => {})
  const run = (async () => { await prev; return fn() })()
  chains.set(jobId, run)
  try {
    return await run
  } finally {
    // Only clear if we're the tail, so a later waiter isn't orphaned.
    if (chains.get(jobId) === run) chains.delete(jobId)
  }
}

// Atomically patch a single variant's fields. Reads the current variants inside
// the lock (never a stale caller-held snapshot), so concurrent completions never
// overwrite each other. Optionally flips the job to 'complete' once every variant
// is ready/failed, or sets an explicit job status.
//
// The in-process lock only serializes writers in THIS process — but with all six
// variants running at once, writers live in separate processes too (each v4-v6
// render is its own sandbox VM, and v1-v3 finalize inside whatever Vercel lambda
// happens to poll). Two processes can interleave read→write and silently revert
// each other ("lost update") — the classic symptom is a variant whose render
// succeeded but that sits "processing" forever because its `ready` write was
// clobbered by another variant's progress tick. So after writing we re-read and
// verify our fields actually stuck; if a cross-process writer reverted them, we
// re-apply on top of the fresh state. Every writer only touches its own array
// entry, so retries converge.
export async function patchVariant(
  db: SupabaseClient,
  jobId: string,
  variantId: string,
  patch: Partial<VideoVariant>,
  opts: { completeWhenAllDone?: boolean; jobStatus?: string } = {},
): Promise<void> {
  // Every variant failure in the app funnels through this write (render errors,
  // launch errors, stale sweeps) — alert ops here so no failure is silent, even
  // if the DB write below gets clobbered.
  if (patch.status === 'failed') {
    notifyOps(
      `🔴 Variant failed — job \`${jobId}\` ${variantId}: ${patch.error ?? 'no error message'}`,
      { key: `variant-failed:${jobId}:${variantId}` },
    )
  }
  await withJobLock(jobId, async () => {
    const MAX_TRIES = 4
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
      if (!job?.variants) return
      let merged: VideoVariant | undefined
      const variants = (job.variants as VideoVariant[]).map(v => {
        if (v.id !== variantId) return v
        merged = { ...v, ...patch }
        // Stamp when the variant first enters processing; clear it on ready/failed.
        // The status route sweeps on this to catch a worker VM killed mid-render.
        if (patch.status === 'processing' && v.status !== 'processing') {
          merged.processing_started_at = new Date().toISOString()
        } else if (patch.status === 'ready' || patch.status === 'failed') {
          merged.processing_started_at = null
        }
        return merged
      })
      const update: Record<string, unknown> = { variants }
      if (opts.completeWhenAllDone && variants.every(v => v.status === 'ready' || v.status === 'failed')) {
        update.status = 'complete'
      } else if (opts.jobStatus) {
        update.status = opts.jobStatus
      }
      await db.from('video_jobs').update(update).eq('id', jobId)

      // Progress ticks are lossy-tolerable and high-frequency: skip the verify
      // round-trip unless the patch carries state that must not be lost.
      const critical = patch.status !== undefined || patch.download_url !== undefined || patch.external_id !== undefined
      if (!critical || !merged) return

      const { data: check } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
      const after = (check?.variants as VideoVariant[] | undefined)?.find(v => v.id === variantId)
      const stuck = after && (Object.keys(patch) as (keyof VideoVariant)[]).every(
        k => JSON.stringify(after[k] ?? null) === JSON.stringify(patch[k] ?? null),
      )
      if (stuck) return
      if (attempt === MAX_TRIES) {
        console.warn(`[job-lock] patch for ${jobId}:${variantId} kept getting clobbered by a concurrent writer — giving up after ${MAX_TRIES} tries`)
        return
      }
      // Brief jittered pause so two colliding processes don't retry in lockstep.
      await new Promise(r => setTimeout(r, 60 + Math.random() * 180))
    }
  })
}
