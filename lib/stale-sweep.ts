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

// The sandbox itself caps at 40 min, so anything 'processing' past 45 min from
// its start stamp is definitively dead. No false positives: real renders finish
// well under the cap, and the stamp is per-variant (not job-age).
export const STALE_MS = 45 * 60 * 1000

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
    return age > STALE_MS || neverStarted
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
      `[stale-sweep] variant ${jobId}:${v.id} ${neverStarted ? `never reported progress in ${NEVER_STARTED_MS / 60000}m` : `stuck processing past ${STALE_MS / 60000}m`} — marking failed`,
    )
    // patchVariant alerts ops on every status:'failed' write, so swept
    // variants notify Slack without extra plumbing here.
    await patchVariant(db, jobId, v.id, {
      status: 'failed',
      error: neverStarted
        ? 'The render didn\'t start (the worker never came up). Please retry this variant.'
        : 'The render stopped unexpectedly (the worker was interrupted). Please retry this variant.',
      progress: null,
    }, { completeWhenAllDone: true })
  }

  return stale.length
}
