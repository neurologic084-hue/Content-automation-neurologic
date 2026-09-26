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
  // Node server should own a background timer or a signal handler. The import
  // must sit INSIDE this literal NEXT_RUNTIME check (not after an early return)
  // so the bundler can drop it from the Edge build — otherwise every Node-only
  // module the watchdog reaches is compiled for Edge, which was 66 warnings.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node')
    await registerNode()
  }
}
