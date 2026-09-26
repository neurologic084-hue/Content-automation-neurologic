import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pollSubmagicJob, VARIANT_DEFINITIONS } from '@/lib/video-pipeline'
import type { VideoVariant } from '@/lib/video-pipeline'
import { releaseJobSource } from '@/lib/motion-renderer'
import { dispatchPipelineTask } from '@/lib/sandbox-tasks'
import { explainFailure, isTransientRenderError, isSubmagicHourlyCap } from '@/lib/error-explain'
import { rendersDir } from '@/lib/paths'
import { patchVariant, withJobLock } from '@/lib/job-lock'
import { sweepStaleVariants, autoRequeueVariant } from '@/lib/stale-sweep'
import fs from 'fs'
import path from 'path'

// A ready variant should point at OUR storage (R2 or local /renders), never at
// Submagic's hosted URL — theirs expires after a while, which shows up as a
// black preview player later even though the render "worked".
function isSubmagicHostedUrl(url: string | null | undefined): boolean {
  if (!url) return false
  if (url.startsWith('/renders/')) return false
  const r2 = process.env.R2_PUBLIC_URL
  if (r2 && url.startsWith(r2)) return false
  return url.startsWith('http')
}

// Re-pull attempts for ready-but-Submagic-hosted variants, once per variant
// per server process — an expired source URL would otherwise retry forever.
const healAttempted = new Set<string>()

// Cross-job stale sweep, rate-limited per server process so a polling studio
// tab (which hits this route every few seconds) triggers it at most this often.
const GLOBAL_SWEEP_EVERY_MS = 5 * 60 * 1000
let lastGlobalSweep = 0

// Per-variant throttle on the OUTBOUND Submagic poll. The studio tab hits this
// route every few seconds, and each hit used to poll Submagic once per
// processing variant — with three variants rendering that alone is ~2000
// requests/hour against Submagic's budget, and it is part of what got the
// whole account 429'd in production (2026-07-21). A render takes 8-15 minutes;
// learning it finished up to 15s late is imperceptible. Between real polls the
// route simply serves the DB state it already has.
const SUBMAGIC_POLL_GAP_MS = 15_000
const lastSubmagicPoll = new Map<string, number>()

// Fails dead variants on jobs OTHER than the one being viewed. The daily cron
// does this too; this makes normal app usage close the gap between ticks so a
// dead variant is not still claiming to be 'processing' hours later.
async function sweepOtherProcessingJobs(
  db: Awaited<ReturnType<typeof createClient>>,
  skipJobId: string,
): Promise<void> {
  try {
    const { data: jobs } = await db
      .from('video_jobs')
      .select('id, created_at, variants')
      .eq('status', 'processing')
      .neq('id', skipJobId)
    let swept = 0
    for (const j of jobs ?? []) {
      swept += await sweepStaleVariants(db, j.id, (j.variants ?? []) as VideoVariant[], j.created_at)
    }
    if (swept) console.warn(`[status] background sweep failed ${swept} dead variant(s) on other jobs`)
  } catch (e) {
    console.warn('[status] background sweep skipped:', (e as Error).message)
  }
}

// Jobs snapshot the variant definitions (name/description/flags) at creation
// time, so old jobs keep showing stale labels after a template is renamed or
// redesigned. Overlay the CURRENT definitions for display — render state
// (status/urls/progress) stays from the stored row. Display-only: never
// written back to the DB.
function withCurrentDefinitions(variants: VideoVariant[]): VideoVariant[] {
  return variants
    // Drop experimental/hidden variants (e.g. the v7 collage test) so they
    // never surface in the client's studio, even on jobs created while the
    // variant was still visible.
    .filter(v => {
      const def = VARIANT_DEFINITIONS.find(d => d.id === v.id)
      return !def?.hidden
    })
    .map(v => {
      const def = VARIANT_DEFINITIONS.find(d => d.id === v.id)
      return def ? { ...v, ...def } : v
    })
}

const STATUS_COLUMNS = 'id, status, created_at, selected_variant, variants'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = await createClient()

  // Polled every 4s — fetch only what the sweep and the studio read, not the
  // transcript / word timings / B-roll analysis the full row carries.
  const { data: job, error } = await supabase
    .from('video_jobs')
    .select(STATUS_COLUMNS)
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  // Stale sweep: fail any variant whose worker died mid-render so the UI stops
  // spinning and the retry button appears. Shared with /api/cron/sweep, which
  // covers the closed-tab case — this inline call just keeps the studio's view
  // fresh between cron ticks. Rules and rationale live in lib/stale-sweep.ts.
  {
    const swept = await sweepStaleVariants(supabase, jobId, (job.variants ?? []) as VideoVariant[], job.created_at)
    if (swept > 0) {
      const { data: refreshed } = await supabase.from('video_jobs').select(STATUS_COLUMNS).eq('id', jobId).single()
      if (refreshed) Object.assign(job, refreshed)
    }
    // ...and opportunistically sweep OTHER jobs too. The cron that was meant to
    // cover closed tabs runs once a day, so a variant whose worker died could
    // sit 'processing' for up to 24h looking alive — observed in production.
    // Anyone opening any job now clears the rest. Throttled per process and
    // never awaited: this is housekeeping, not part of the response.
    if (Date.now() - lastGlobalSweep > GLOBAL_SWEEP_EVERY_MS) {
      lastGlobalSweep = Date.now()
      void sweepOtherProcessingJobs(supabase, jobId)
    }
  }

  // Heal: any ready variant still pointing at Submagic's expiring URL gets
  // re-pulled into our storage in the background (once per server process).
  // Runs before the complete-job early return because damaged rows are
  // usually on finished jobs.
  for (const v of (job.variants ?? []) as VideoVariant[]) {
    const key = `${jobId}:${v.id}`
    if (v.status === 'ready' && isSubmagicHostedUrl(v.download_url) && !healAttempted.has(key)) {
      healAttempted.add(key)
      console.log(`[video-status] ready variant ${key} still on Submagic's URL — re-pulling into storage`)
      dispatchPipelineTask({ task: 'finalize-submagic', jobId, variantId: v.id, downloadUrl: v.download_url! }).catch((e) =>
        console.warn(`[video-status] heal failed for ${key}:`, (e as Error).message)
      )
    }
  }

  if (job.status === 'complete') {
    return NextResponse.json({ ...job, variants: withCurrentDefinitions(job.variants ?? []) })
  }

  const variants: VideoVariant[] = job.variants ?? []

  // Poll any Submagic variants that are still processing — at most once per
  // SUBMAGIC_POLL_GAP_MS per variant (see the throttle note at the top).
  const pollNow = Date.now()
  if (lastSubmagicPoll.size > 500) lastSubmagicPoll.clear() // old jobs; repolling once is harmless
  const submagicPending = variants
    .filter((v) => v.tool === 'submagic' && v.status === 'processing' && v.external_id)
    .filter((v) => {
      const key = `${jobId}:${v.id}`
      if (pollNow - (lastSubmagicPoll.get(key) ?? 0) < SUBMAGIC_POLL_GAP_MS) return false
      lastSubmagicPoll.set(key, pollNow)
      return true
    })

  // Each change is recorded per variant and written through patchVariant, so
  // it merges onto FRESH state — a bulk write of this request's snapshot could
  // revert a finisher's 'ready' that landed mid-request (TODO-JUNE §9).
  const patches = new Map<string, Partial<VideoVariant> & { finalize_at?: string }>()
  const recordPatch = (id: string, patch: Partial<VideoVariant> & { finalize_at?: string }) =>
    patches.set(id, { ...patches.get(id), ...patch })

  // Recovery: if a locally-rendered variant is still showing "processing" but
  // the output file exists on disk, the DB missed the markVariant write (race condition).
  // Trust the file and heal the DB state here.
  const jobRendersDir = rendersDir(jobId)
  for (const v of variants) {
    if (v.status === 'processing' && !v.tool) {
      const localFile = path.join(jobRendersDir, `${v.id}.mp4`)
      if (fs.existsSync(localFile)) {
        const healed = {
          status: 'ready' as const,
          download_url: `/renders/${jobId}/${v.id}.mp4`,
          preview_url: `/renders/${jobId}/${v.id}.mp4`,
          progress: null,
        }
        Object.assign(v, healed)
        recordPatch(v.id, healed)
      }
    }
  }

  if (submagicPending.length > 0) {
    const pollResults = await Promise.allSettled(
      submagicPending.map((v) => pollSubmagicJob(v.external_id!))
    )

    for (let i = 0; i < submagicPending.length; i++) {
      const variant = submagicPending[i]
      const result = pollResults[i]
      if (result.status !== 'fulfilled') continue

      const poll = result.value
      const target = variants.find((v) => v.id === variant.id)
      if (!target) continue

      if (poll.status === 'ready' && poll.downloadUrl) {
        // Never write Submagic's expiring URL as the final state — hand off to
        // the canonical finisher (retrieval, SFX, R2 upload, ready write).
        // The 'Finalizing' progress label is the poll-storm guard: status is
        // polled every few seconds and must not launch a finisher each time
        // (on Vercel each launch would be a whole Sandbox VM). The in-process
        // lock inside finalizeSubmagicVariant stays as the second layer.
        // The engine is done; hand off to our finisher (download → grade →
        // effects → music → save). Gate the dispatch on a TIMESTAMP, not the
        // progress label: the finisher advances the label through its own steps
        // (3→4), so a label check would misread that as "not dispatched" and
        // re-launch it every poll. We dispatch once, then re-dispatch only if
        // there's still no result after FINALIZE_RETRY_MS — the finisher can die
        // (a Sandbox VM on Vercel) before writing 'ready', which otherwise leaves
        // the variant stuck until the 45-min sweep falsely fails it.
        // finalizeSubmagicVariant writes a fixed R2 path and self-dedupes, so a
        // retry is safe.
        const FINALIZE_RETRY_MS = 6 * 60 * 1000
        const nowMs = Date.now()
        const at = (target as { finalize_at?: string }).finalize_at
        const needsDispatch = !at || (nowMs - Date.parse(at)) > FINALIZE_RETRY_MS
        if (needsDispatch) {
          // Only reset the label on the FIRST dispatch (step 3); on a stale
          // retry keep whatever step the previous finisher reached so the bar
          // doesn't jump backwards.
          const finalizePatch: Partial<VideoVariant> & { finalize_at?: string } = { finalize_at: new Date(nowMs).toISOString() }
          if (!at) finalizePatch.progress = { step: 3, total: 4, label: 'Color grading & effects' }
          Object.assign(target, finalizePatch)
          recordPatch(target.id, finalizePatch)
          if (at) console.warn(`[video-status] finalize for ${jobId}:${target.id} had no result in ${Math.round(FINALIZE_RETRY_MS / 60000)}min — re-dispatching`)
          dispatchPipelineTask({ task: 'finalize-submagic', jobId, variantId: target.id, downloadUrl: poll.downloadUrl }).catch((e) =>
            console.warn(`[video-status] finalize failed for ${jobId}:${target.id}:`, (e as Error).message)
          )
        }
      } else if (poll.status === 'failed') {
        // Transient reason → silent self-heal: fresh submission, card stays
        // 'processing'. The helper already wrote the row; mirror it into the
        // local copy so the response shows it.
        let healed = false
        if (isTransientRenderError(poll.error ?? '')) {
          healed = await autoRequeueVariant(supabase, jobId, target, `Submagic reported: ${String(poll.error).slice(0, 120)}`, {
            delayMs: isSubmagicHourlyCap(poll.error) ? 50 * 60 * 1000 : 2 * 60 * 1000,
            freePark: isSubmagicHourlyCap(poll.error),
          })
          if (healed) {
            const { data: fresh } = await supabase.from('video_jobs').select('variants').eq('id', jobId).single()
            const fv = ((fresh?.variants ?? []) as VideoVariant[]).find((x) => x.id === target.id)
            if (fv) Object.assign(target, fv)
          }
        }
        if (!healed) {
          const failedPatch = { status: 'failed' as const, error: explainFailure(poll.error), progress: null }
          Object.assign(target, failedPatch)
          recordPatch(target.id, failedPatch)
        }
      }
    }
  }

  const started = variants.filter((v) => v.status !== 'pending')
  const allDone = started.length > 0 && started.every((v) => v.status === 'ready' || v.status === 'failed')
  const newStatus = allDone ? 'complete' : 'processing'

  for (const [variantId, patch] of patches) {
    await patchVariant(supabase, jobId, variantId, patch)
  }
  if (allDone) {
    // Re-check on fresh state under the job lock: a variant restarted since
    // this request's read must keep the job 'processing'.
    await withJobLock(jobId, async () => {
      const { data: fresh } = await supabase.from('video_jobs').select('variants').eq('id', jobId).single()
      const freshStarted = ((fresh?.variants ?? []) as VideoVariant[]).filter((v) => v.status !== 'pending')
      if (freshStarted.length > 0 && freshStarted.every((v) => v.status === 'ready' || v.status === 'failed')) {
        await supabase.from('video_jobs').update({ status: 'complete' }).eq('id', jobId)
      }
    })
  }

  if (allDone) {
    // Job just finished — the compressed source in R2 has served its purpose.
    // Fire-and-forget; deleting an already-deleted key is a no-op, so
    // concurrent polls racing here are harmless.
    void releaseJobSource(jobId)
  }

  return NextResponse.json({ ...job, status: newStatus, variants: withCurrentDefinitions(variants) })
}
