// ── Graceful shutdown for the single Railway container ────────────────────────
// The Next server and every heavy pipeline task share ONE long-lived container
// (see RAILWAY.md). On a redeploy Railway sends SIGTERM, then SIGKILL after
// RAILWAY_DEPLOYMENT_DRAINING_SECONDS — which DEFAULTS TO 0, i.e. an effectively
// instant kill unless that variable is set on the service. So this only buys
// anything when the operator has set a non-zero drain window.
//
// Two jobs:
//   1. isDraining() flips the instant SIGTERM lands, so dispatchPipelineTask
//      stops accepting new heavy work.
//   2. An in-process Remotion render cannot finish inside any sane drain window
//      and dies with the container, so the process that OWNS it marks it
//      failed-retryable NOW. Doing it here — in the owner, on the way down — is
//      unambiguous: a boot-time sweep in the next container could not tell a
//      genuinely dead render from one still rendering on the OLD container
//      during Railway's deploy overlap. Short Submagic tasks (start/finalize)
//      are instead waited on, so a finalize writing the permanent R2 URL over
//      Submagic's expiring one isn't cut in half.
//
// `next start` installs its own SIGTERM handler that process.exit()s as soon as
// the HTTP server closes, which would truncate the async drain below. The
// runtime sets NEXT_MANUAL_SIG_HANDLE=1 (Dockerfile) to suppress it and hand
// full control here. Without that env this still runs, just with a window that
// Next's own exit may cut short.

// How a tracked task should be treated when SIGTERM arrives.
//   fail    — cannot finish in the window and dies with the container; fail it.
//   wait    — short and state-critical; let it finish inside the budget.
//   abandon — job-level and self-healing on retry; neither fail nor wait.
export type DrainMode = 'fail' | 'wait' | 'abandon'

export interface InFlightTask {
  jobId: string
  variantId?: string
  task: string
  mode: DrainMode
}

// Pinned on globalThis for the same reason motion-renderer pins its queues: a
// module re-evaluated in a second bundle must not get a second, private copy of
// the draining flag or the in-flight set — the dispatcher and the shutdown
// handler have to see exactly the same state.
const g = globalThis as unknown as {
  __olyDraining?: boolean
  __olyInFlight?: Set<InFlightTask>
  __olyShutdownInstalled?: boolean
}

const inFlight = (g.__olyInFlight ??= new Set<InFlightTask>())

export function isDraining(): boolean {
  return g.__olyDraining === true
}

// Register a running task and get back an idempotent de-register. Call it in a
// finally so a task always leaves the set, win or lose.
export function trackTask(entry: InFlightTask): () => void {
  inFlight.add(entry)
  let removed = false
  return () => {
    if (removed) return
    removed = true
    inFlight.delete(entry)
  }
}

export function installShutdownHandler(opts: {
  // Marks one in-flight render failed-retryable. Must never throw.
  failRender: (jobId: string, variantId: string) => Promise<void>
  // Upper bound on the whole drain, ms — derive from the service's draining
  // window and leave a margin so we exit BEFORE Railway's SIGKILL.
  graceMs: number
}): void {
  if (g.__olyShutdownInstalled) return
  g.__olyShutdownInstalled = true

  const drain = (signal: string) => {
    if (g.__olyDraining) return
    g.__olyDraining = true

    const graceMs = Math.max(2_000, opts.graceMs)
    const deadline = Date.now() + graceMs
    console.warn(
      `[shutdown] ${signal} received — draining ${inFlight.size} in-flight task(s), budget ${Math.round(graceMs / 1000)}s`,
    )

    // Guarantee an exit even if the drain wedges: never hold the container past
    // the point Railway would SIGKILL it anyway.
    const hardExit = setTimeout(() => {
      console.warn('[shutdown] drain budget elapsed — exiting')
      process.exit(0)
    }, graceMs)
    hardExit.unref?.()

    void (async () => {
      try {
        const doomed = [...inFlight].filter((t) => t.mode === 'fail' && t.variantId)
        if (doomed.length) {
          console.warn(`[shutdown] failing ${doomed.length} interrupted render(s) as retryable`)
          await Promise.allSettled(doomed.map((t) => opts.failRender(t.jobId, t.variantId!)))
        }
        // Let the short, state-critical tasks finish inside the budget.
        while (Date.now() < deadline && [...inFlight].some((t) => t.mode === 'wait')) {
          await new Promise((r) => setTimeout(r, 250))
        }
      } catch (e) {
        console.warn('[shutdown] drain error:', (e as Error).message)
      } finally {
        clearTimeout(hardExit)
        console.log('[shutdown] drain complete — exiting cleanly')
        process.exit(0)
      }
    })()
  }

  // `once`: a second SIGTERM falls through to Node's default (terminate), so a
  // wedged drain can still be force-killed from outside.
  process.once('SIGTERM', () => drain('SIGTERM'))
  process.once('SIGINT', () => drain('SIGINT'))
}
