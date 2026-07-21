// ── Stale-variant sweep (shared by the status route and the cron sweep) ──────
// A variant whose worker VM was killed mid-render (OOM, Vercel hard-kill,
// server restart) never gets to write its own 'failed', so it spins forever.
// Historically this sweep only lived inside the status GET route — meaning it
// only ran while a browser tab was open polling that specific job. Close the
// tab and a dead job sat 'processing' indefinitely (observed in production:
// jobs stuck for 3+ days). The cron route now runs the same sweep across ALL
// processing jobs on a schedule, browser or not.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoVariant } from './video-pipeline'
import { patchVariant } from './job-lock'

// Absolute ceiling, used ONLY for variants with no heartbeat (see below). The
// heartbeat is the real test — this is the backstop for older rows and for any
// path that renders without reporting progress.
export const STALE_MS = 45 * 60 * 1000

// How long a render may go WITHOUT a progress update before it counts as dead.
//
// This is the real liveness test, and STALE_MS above is only a backstop for
// variants that never send a heartbeat. Judging by total elapsed time alone was
// wrong and caused the failure it was meant to catch: a Motion Lab render is
// allowed 45 minutes on its delayRender budget and then legitimately RETRIES at
// half the tab count, with a subprocess ceiling of 70 minutes — so the sweep
// firing at 45 killed live renders at the exact moment they began their retry
// (job b550d052 lost v4 and v6 that way). A render writing progress every few
// seconds is alive no matter how long it has been going; one silent for this
// long is not.
export const NO_HEARTBEAT_MS = 15 * 60 * 1000

// A much shorter cap for variants that have reported NO progress at all —
// the render task never checked in (Sandbox VM failed to launch or died during
// bootstrap). A real render emits its first progress within a minute or two.
export const NEVER_STARTED_MS = 12 * 60 * 1000

// Fails every definitively-dead processing variant on one job. Returns how many
// were swept (0 = nothing to do). Callers that hold a stale row should re-read
// the job after a non-zero return.
export async function sweepStaleVariants(
  db: SupabaseClient,
  jobId: string,
  variants: VideoVariant[],
  jobCreatedAt?: string | null,
): Promise<number> {
  const now = Date.now()
  const jobAge = jobCreatedAt ? now - new Date(jobCreatedAt).getTime() : 0

  const stale = (variants ?? []).filter(v => {
    if (v.status !== 'processing') return false
    if (!v.processing_started_at) {
      // Legacy rows predating the start stamp can't be aged per-variant; fall
      // back to job age so they don't dodge the sweep forever.
      return jobAge > STALE_MS
    }
    const age = now - new Date(v.processing_started_at).getTime()
    const neverStarted = !v.progress && age > NEVER_STARTED_MS
    if (neverStarted) return true

    // Heartbeat present: trust it over the clock. A long render that is still
    // reporting is doing its job.
    const beat = v.progress?.at ? new Date(v.progress.at).getTime() : null
    if (beat && Number.isFinite(beat)) return now - beat > NO_HEARTBEAT_MS

    // No heartbeat (an older variant, or a path that never reports): fall back
    // to total elapsed, but allow the full subprocess ceiling the renderer is
    // permitted rather than cutting in at its retry point.
    return age > STALE_MS
  })

  for (const v of stale) {
    // LAST LOOK before declaring a Submagic render dead: it runs on THEIR
    // servers and survives anything that happens to ours. If the process that
    // was polling it died (container restart, OOM), the render may have
    // FINISHED with nobody watching — failing it here would throw away a
    // completed, paid-for video. One poll decides; a still-processing answer
    // past the sweep threshold falls through to the failure below, since no
    // real Submagic render takes that long.
    if (v.external_id) {
      try {
        const { pollSubmagicJob } = await import('./video-pipeline')
        const res = await pollSubmagicJob(v.external_id)
        if (res.status === 'ready' && res.downloadUrl) {
          console.warn(`[stale-sweep] ${jobId}:${v.id} actually FINISHED on Submagic — rescuing instead of failing`)
          // Dynamic import to stay off this module's init path: sandbox-tasks
          // transitively imports this file (submagic-start needs STALE_MS), and
          // a static cycle here would race module initialisation.
          const { dispatchPipelineTask } = await import('./sandbox-tasks')
          await dispatchPipelineTask({ task: 'finalize-submagic', jobId, variantId: v.id, downloadUrl: res.downloadUrl })
          continue
        }
      } catch { /* poll failed — treat as dead, exactly as before */ }
    }
    const neverStarted = !v.progress
    console.warn(
      `[stale-sweep] variant ${jobId}:${v.id} ${
        neverStarted
          ? `never reported progress in ${NEVER_STARTED_MS / 60000}m`
          : v.progress?.at
            ? `silent for over ${NO_HEARTBEAT_MS / 60000}m (last: "${v.progress.label}")`
            : `no heartbeat and processing past ${STALE_MS / 60000}m`
      } — marking failed`,
    )
    // patchVariant alerts ops on every status:'failed' write, so swept
    // variants notify Slack without extra plumbing here.
    await patchVariant(db, jobId, v.id, {
      status: 'failed',
      error: neverStarted
        ? 'This render never started — the machine that was supposed to pick it up never came up. Please retry it.'
        : 'This render stopped part-way through and went quiet, usually because the server restarted while it was working. Nothing is lost — press retry and it will pick up from the work already done.',
      progress: null,
    }, { completeWhenAllDone: true })
  }

  return stale.length
}
