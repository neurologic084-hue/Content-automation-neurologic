// ── Ops alerting (Slack incoming webhook) ─────────────────────────────────────
// The pipeline degrades gracefully in a lot of places (LLM fallbacks, audio
// cleaner cascade, stale sweeps) — which is exactly why nobody finds out when
// something is wrong: the job still "succeeds". Every silent-failure site calls
// notifyOps() so a human hears about it in Slack the moment it happens.
//
// Setup: create a Slack incoming webhook for an ops channel and set
// SLACK_OPS_WEBHOOK_URL. Without the env var this is a no-op, so it's safe to
// call unconditionally from anywhere (including render VMs).
//
// Fire-and-forget by design: never throws, never blocks the pipeline, and
// failures to deliver only warn to the console.

const DEFAULT_DEDUPE_MS = 30 * 60 * 1000

// Per-process throttle so a poll loop or per-segment fallback doesn't flood the
// channel with the same alert. Each render VM / lambda is its own process, so
// cross-process duplicates can still happen — acceptable for an ops channel.
const recentAlerts = new Map<string, number>()

export function notifyOps(message: string, opts: { key?: string; dedupeMs?: number } = {}): void {
  const url = process.env.SLACK_OPS_WEBHOOK_URL
  if (!url) return

  const key = opts.key ?? message
  const dedupeMs = opts.dedupeMs ?? DEFAULT_DEDUPE_MS
  const now = Date.now()
  const last = recentAlerts.get(key)
  if (last && now - last < dedupeMs) return
  recentAlerts.set(key, now)
  if (recentAlerts.size > 500) {
    for (const [k, t] of recentAlerts) if (now - t > dedupeMs) recentAlerts.delete(k)
  }

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(10_000),
  })
    .then(res => {
      if (!res.ok) console.warn(`[notify] Slack webhook returned ${res.status}`)
    })
    .catch(e => console.warn('[notify] Slack webhook failed:', (e as Error).message))
}
