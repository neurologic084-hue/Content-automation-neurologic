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

// ── Silent self-heal ─────────────────────────────────────────────────────────
// A transient death (server restart mid-render, an upstream download flake, a
// rate/hourly window) is not the client's problem and must not become their
// error card. Instead of failing, requeue the task with the card still
// 'processing' — up to this many times per variant. A HUMAN retry starts a
// fresh budget (the start route resets auto_retries), so a person is never
// locked out by exhausted automatic attempts.
export const MAX_AUTO_RETRIES = 2

// Same-process dedupe for firing a due retry_at (see the scheduler pass in
// sweepStaleVariants): sweeps run concurrently from the watchdog and every
// status poll, usually with stale snapshots of the variants array.
const RETRY_DISPATCH_DEDUPE_MS = 10 * 60 * 1000
const retryDispatchedAt = new Map<string, number>()

/** Requeues one processing variant's task silently. Returns true when the
 *  requeue was taken (caller must NOT fail the variant), false when the budget
 *  is spent (caller proceeds to the honest failure card).
 *  `delayMs` schedules the requeue via variant.retry_at instead of dispatching
 *  now — for windows that need real waiting (Submagic's hourly upload cap).
 *  The watchdog sweep (every 5 min) is the scheduler that fires those. */
export async function autoRequeueVariant(
  db: SupabaseClient,
  jobId: string,
  v: VideoVariant,
  reason: string,
  opts: { delayMs?: number } = {},
): Promise<boolean> {
  const used = v.auto_retries ?? 0
  if (used >= MAX_AUTO_RETRIES) return false
  const isSubmagic = v.tool === 'submagic'
  const delayMs = opts.delayMs ?? 0
  console.warn(`[self-heal] ${jobId}:${v.id}: ${reason} — silent requeue ${used + 1}/${MAX_AUTO_RETRIES}${delayMs ? ` in ~${Math.round(delayMs / 60000)}m` : ''}`)
  try {
    await patchVariant(db, jobId, v.id, {
      status: 'processing',
      auto_retries: used + 1,
      // A dead Submagic project must not be reused; the fresh submission gets
      // its own id. Clearing it also lets the start task's idempotency guard
      // pass the resubmission through.
      external_id: null,
      error: null,
      retry_at: delayMs ? new Date(Date.now() + delayMs).toISOString() : null,
      progress: {
        step: 1,
        total: 4,
        label: delayMs ? 'The editing engine is busy — retrying automatically' : 'Recovering — restarting this render',
        at: new Date().toISOString(),
      },
    })
    if (!delayMs) {
      // Dynamic import for the same init-cycle reason as the rescue below.
      const { dispatchPipelineTask } = await import('./sandbox-tasks')
      await dispatchPipelineTask(isSubmagic
        ? { task: 'start-submagic', jobId, variantId: v.id }
        : { task: 'render-variant', jobId, variantId: v.id })
    }
    return true
  } catch (e) {
    console.warn(`[self-heal] requeue for ${jobId}:${v.id} failed — falling through to the failure card:`, (e as Error).message)
    return false
  }
}

// Fails every definitively-dead processing variant on one job — after giving
// each its silent requeues. Returns how many were touched (0 = nothing to do).
// Callers that hold a stale row should re-read the job after a non-zero return.
export async function sweepStaleVariants(
  db: SupabaseClient,
  jobId: string,
  variants: VideoVariant[],
  jobCreatedAt?: string | null,
): Promise<number> {
  const now = Date.now()
  const jobAge = jobCreatedAt ? now - new Date(jobCreatedAt).getTime() : 0

  // Deliberately-waiting variants first (retry_at set by a delayed requeue —
  // e.g. parked on Submagic's hourly window). They are not dead, they are
  // scheduled: fire the ones that are due, keep the rest visibly alive so the
  // liveness check below can never sweep a variant that is just waiting.
  let touched = 0
  for (const v of variants ?? []) {
    if (v.status !== 'processing' || !v.retry_at) continue
    touched++
    if (now >= new Date(v.retry_at).getTime()) {
      // This sweep runs from several callers (the watchdog, every status GET),
      // often with a stale variants snapshot — without the dedupe two sweeps
      // racing past a due retry_at would BOTH dispatch, and a doubled Submagic
      // submission is a doubled bill. numReplicas is pinned to 1, so a
      // process-local window is a real guard, not a hopeful one.
      const key = `${jobId}:${v.id}`
      if (now - (retryDispatchedAt.get(key) ?? 0) < RETRY_DISPATCH_DEDUPE_MS) continue
      retryDispatchedAt.set(key, now)
      console.log(`[self-heal] ${jobId}:${v.id} wait is over — dispatching the queued retry`)
      try {
        await patchVariant(db, jobId, v.id, {
          retry_at: null,
          progress: { step: 1, total: 4, label: 'Recovering — restarting this render', at: new Date().toISOString() },
        })
        const { dispatchPipelineTask } = await import('./sandbox-tasks')
        await dispatchPipelineTask(v.tool === 'submagic'
          ? { task: 'start-submagic', jobId, variantId: v.id }
          : { task: 'render-variant', jobId, variantId: v.id })
      } catch (e) {
        retryDispatchedAt.delete(key) // let the next sweep re-attempt
        console.warn(`[self-heal] queued retry dispatch failed for ${jobId}:${v.id} (next sweep re-attempts):`, (e as Error).message)
      }
    } else {
      // Tick the heartbeat so the wait reads as alive — but only every few
      // minutes: the status route sweeps on every poll, and an unthrottled
      // tick would write the row every few seconds for the whole wait.
      const lastBeat = v.progress?.at ? new Date(v.progress.at).getTime() : 0
      if (now - lastBeat > 4 * 60 * 1000) {
        await patchVariant(db, jobId, v.id, {
          progress: { ...(v.progress ?? { step: 1, total: 4, label: 'The editing engine is busy — retrying automatically' }), at: new Date().toISOString() },
        }).catch(() => { /* keep-alive only */ })
      }
    }
  }

  const stale = (variants ?? []).filter(v => {
    if (v.status !== 'processing') return false
    if (v.retry_at) return false // scheduled wait, handled above
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
    // servers and survives anything that happens to ours. Ask Submagic what it
    // actually is before failing it:
    //   ready      → rescue the finished, paid-for video (below)
    //   processing → it is ALIVE on their side; NEVER fail it. Our heartbeat
    //                stops the moment we hand off to the background poll, so a
    //                long render (or a dropped poller) crosses the sweep's
    //                silence threshold while the render is perfectly fine —
    //                failing it here would kill a live, paid render.
    //   failed/gone→ fall through and fail it with a real reason.
    if (v.external_id) {
      try {
        const { pollSubmagicJob } = await import('./video-pipeline')
        const res = await pollSubmagicJob(v.external_id)
        if (res.status === 'processing') {
          console.log(`[stale-sweep] ${jobId}:${v.id} quiet locally but Submagic still rendering it — leaving alone`)
          continue
        }
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
    const deathReason = neverStarted
      ? `never reported progress in ${NEVER_STARTED_MS / 60000}m`
      : v.progress?.at
        ? `silent for over ${NO_HEARTBEAT_MS / 60000}m (last: "${v.progress.label}")`
        : `no heartbeat and processing past ${STALE_MS / 60000}m`

    // A quiet death is almost always transient (the server restarted, the box
    // was overloaded) — the retry button would work, so press it ourselves.
    // The card stays 'processing'; only a variant that dies repeatedly gets
    // the honest failure below.
    if (await autoRequeueVariant(db, jobId, v, deathReason)) continue

    console.warn(`[stale-sweep] variant ${jobId}:${v.id} ${deathReason} — marking failed (self-heal budget spent)`)
    // patchVariant alerts ops on every status:'failed' write, so swept
    // variants notify Slack without extra plumbing here.
    await patchVariant(db, jobId, v.id, {
      status: 'failed',
      error: neverStarted
        ? 'This render never started — the machine that was supposed to pick it up never came up. Please retry it.'
        : 'This render stopped part-way through and went quiet, usually because the server restarted while it was working. Nothing is lost — press retry and it will pick up from the work already done.',
      progress: null,
      retry_at: null,
    }, { completeWhenAllDone: true })
  }

  return stale.length + touched
}
