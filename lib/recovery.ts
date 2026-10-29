// ── Rescue a job whose variants failed for a reason that was never her fault ──
// A failed card normally needs her to tap Retry, and for a job whose prepared
// footage is gone that means every variant re-fetches and re-cleans the source
// on its own. This does it once, properly, and then starts the variants itself:
//
//   1. an operator sets `recover_requested` on the failed variants (DB write)
//   2. processRecoveryRequests (run by the watchdog) resets them to a visible
//      "preparing" state and dispatches ONE prepare-source for the job
//   3. when that prep finishes, resumeVariantsAfterPrep starts every variant
//      that was waiting, exactly as "Generate all" would have
//
// Flag-driven on purpose: nothing is retried unless someone asked for it, so a
// bug can never turn this into a loop that burns paid renders.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoVariant } from './video-pipeline'
import { patchVariant } from './job-lock'

const inFlight = new Set<string>()

/** Finds flagged variants and kicks off footage prep for their job. Returns how many jobs it started. */
export async function processRecoveryRequests(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString()
  const { data: jobs } = await db
    .from('video_jobs')
    .select('id, source_drive_url, variants')
    .gt('created_at', since)
  let started = 0
  for (const job of jobs ?? []) {
    const flagged = ((job.variants ?? []) as VideoVariant[]).filter(v => v.recover_requested && v.status === 'failed')
    if (!flagged.length || !job.source_drive_url || inFlight.has(job.id)) continue
    inFlight.add(job.id)
    try {
      console.log(`[recovery] job ${job.id.slice(0, 8)}: rebuilding footage for ${flagged.length} variant(s)`)
      for (const v of flagged) {
        await patchVariant(db, job.id, v.id, {
          status: 'pending',
          error: null,
          recover_requested: false,
          resume_after_prep: true,
          auto_retries: 0,
          retry_at: null,
          progress: { step: 5, total: 100, label: 'Preparing your footage again', at: new Date().toISOString() },
        }, { jobStatus: 'processing' })
      }
      const { dispatchPipelineTask } = await import('./sandbox-tasks')
      await dispatchPipelineTask({ task: 'prepare-source', jobId: job.id, sourceUrl: job.source_drive_url })
      started++
    } catch (e) {
      console.warn(`[recovery] job ${job.id.slice(0, 8)} could not start:`, (e as Error).message)
    } finally {
      // Held only for this pass: the flags are already cleared, so a later
      // sweep has nothing to pick up twice.
      inFlight.delete(job.id)
    }
  }
  return started
}

/** Called when a job's prep finishes: starts every variant that was waiting on it. */
export async function resumeVariantsAfterPrep(db: SupabaseClient, jobId: string): Promise<number> {
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  const waiting = ((job?.variants ?? []) as VideoVariant[]).filter(v => v.resume_after_prep && v.status === 'pending')
  if (!waiting.length) return 0
  const { dispatchPipelineTask } = await import('./sandbox-tasks')
  for (const v of waiting) {
    const submagic = v.tool === 'submagic'
    await patchVariant(db, jobId, v.id, {
      status: 'processing',
      resume_after_prep: false,
      external_id: null,
      preview_url: null,
      download_url: null,
      error: null,
      auto_retries: 0,
      retry_at: null,
      park_count: 0,
      progress: submagic
        ? { step: 1, total: 4, label: 'Sending your footage', at: new Date().toISOString() }
        : { step: 1, total: 6, label: 'Setting up render environment', at: new Date().toISOString() },
    }, { jobStatus: 'processing' })
    try {
      await dispatchPipelineTask(submagic
        ? { task: 'start-submagic', jobId, variantId: v.id }
        : { task: 'render-variant', jobId, variantId: v.id })
    } catch (e) {
      const { explainFailure } = await import('./error-explain')
      await patchVariant(db, jobId, v.id, { status: 'failed', error: explainFailure(e), progress: null })
    }
  }
  console.log(`[recovery] job ${jobId.slice(0, 8)}: started ${waiting.length} variant(s) after prep`)
  return waiting.length
}
