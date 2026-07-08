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
export async function patchVariant(
  db: SupabaseClient,
  jobId: string,
  variantId: string,
  patch: Partial<VideoVariant>,
  opts: { completeWhenAllDone?: boolean; jobStatus?: string } = {},
): Promise<void> {
  await withJobLock(jobId, async () => {
    const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    if (!job?.variants) return
    const variants = (job.variants as VideoVariant[]).map(v => {
      if (v.id !== variantId) return v
      const merged = { ...v, ...patch }
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
  })
}
