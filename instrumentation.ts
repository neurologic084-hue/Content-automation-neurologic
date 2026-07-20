// Runs once when the server process boots (Next.js instrumentation hook).
//
// On Vercel the stale-variant sweep had to be an external cron, because
// functions die between requests — and Vercel's cheapest plan allows one cron
// run per DAY, so a variant whose worker died could look alive for 24 hours.
// A Railway container is long-lived, so it can just watch itself on a timer.
//
// It also owns graceful shutdown: on Railway the Next server and every render
// share ONE container, so a redeploy's SIGTERM has to stop new work and give a
// clean ending to what is already running (see lib/shutdown.ts).
//
// /api/cron/sweep still exists and still works; this does not replace it, it
// removes the dependence on it.

export async function register() {
  // The hook also runs for the edge runtime and during build. Only the real
  // Node server should own a background timer or a signal handler.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // Vercel would run this in a function instance that is about to be frozen,
  // where a setInterval either never fires or fires unpredictably against a
  // billed instance, and where SIGTERM handling is the platform's job. Only a
  // long-lived host should schedule anything or trap signals.
  if (process.env.VERCEL) return

  const { createClient } = await import('@supabase/supabase-js')
  const { sweepStaleVariants } = await import('./lib/stale-sweep')
  const { patchVariant } = await import('./lib/job-lock')
  const { installShutdownHandler } = await import('./lib/shutdown')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Marks a render interrupted by a redeploy failed-retryable, from the process
  // that owns it. Re-reads first and only touches a variant still 'processing',
  // so a result that landed in the same instant is never clobbered. Self-heals
  // to a no-op without credentials, and never throws (the shutdown path can't
  // afford to).
  async function failRender(jobId: string, variantId: string): Promise<void> {
    try {
      if (!url || !key) return
      const db = createClient(url, key)
      const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = ((job?.variants ?? []) as any[]).find((x) => x.id === variantId)
      if (!v || v.status !== 'processing') return
      await patchVariant(
        db,
        jobId,
        variantId,
        {
          status: 'failed',
          error: 'The render was interrupted by a server restart. Please retry this variant.',
          progress: null,
        },
        { completeWhenAllDone: true },
      )
    } catch (e) {
      console.warn(`[shutdown] could not fail ${jobId}:${variantId}:`, (e as Error).message)
    }
  }

  // Exit a margin BEFORE Railway's SIGKILL. The window is RAILWAY_DEPLOYMENT_-
  // DRAINING_SECONDS (default 0 — see RAILWAY.md: graceful shutdown needs this
  // set to a non-zero value or SIGTERM is followed by an immediate kill).
  const drainSec = Number(process.env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS)
  const graceMs = Number.isFinite(drainSec) && drainSec > 0 ? Math.max(2_000, (drainSec - 5) * 1000) : 20_000

  // Install FIRST — with NEXT_MANUAL_SIG_HANDLE=1 no one else traps SIGTERM, so
  // this must go up regardless of whether the watchdog below can start.
  installShutdownHandler({ failRender, graceMs })

  if (!url || !key) {
    console.warn('[instrumentation] no Supabase credentials — stale-variant watchdog not started')
    return
  }

  const db = createClient(url, key)

  async function sweep() {
    try {
      const { data: jobs } = await db
        .from('video_jobs')
        .select('id, created_at, variants')
        .eq('status', 'processing')
      let swept = 0
      for (const job of jobs ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        swept += await sweepStaleVariants(db, job.id, (job.variants ?? []) as any, job.created_at)
      }
      if (swept) console.warn(`[watchdog] failed ${swept} dead variant(s)`)
    } catch (e) {
      // Never throw out of the timer: an unhandled rejection here would take
      // the whole server down, which is a far worse outcome than a missed pass.
      console.warn('[watchdog] sweep skipped:', (e as Error).message)
    }
  }

  const EVERY_MS = 5 * 60 * 1000
  const timer = setInterval(sweep, EVERY_MS)
  // Do not hold the process open on account of the watchdog alone.
  timer.unref?.()

  // One sweep shortly after boot as well as every 5m. A crash-restart (SIGKILL,
  // OOM) never ran the shutdown handler, so its interrupted renders rely on this
  // — and waiting the full 5m to notice a variant that was ALREADY stale before
  // the restart is needless. It stays safe during a redeploy's deploy-overlap
  // because sweepStaleVariants only fails variants past its 45m / 12m-never-
  // started thresholds, which a live render on the old container never hits.
  const boot = setTimeout(sweep, 15_000)
  boot.unref?.()

  console.log(`[watchdog] stale-variant sweep every ${EVERY_MS / 60000}m (+ once at boot)`)
}
