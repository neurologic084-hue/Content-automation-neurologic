// ── Failure explainer ─────────────────────────────────────────────────────────
// Turns a raw thrown error / API message into a SHORT, actionable sentence for
// the variant card, so a failure says WHY (out of credits, quota hit, bad key,
// storage blip) instead of a cryptic stack or status code.
//
// It leans on the fact that our API wrappers already put the service name +
// status code in the message, e.g.:
//   "OpenRouter error 402: ..."         (openrouter.ts / gemini.ts)
//   "ElevenLabs transcription failed (429): ..."   (caption-renderer.ts)
//   "Submagic job failed: ..."          (video-pipeline.ts)
//   "Vercel Sandbox launch failed: Status code 402 ..."  (sandbox-tasks.ts)
//
// Unknown errors fall through to a trimmed version of the original, so nothing is
// ever hidden — we only ever REPLACE a message when we're confident what it means.

export function explainFailure(raw: unknown): string {
  const msg = (raw instanceof Error ? raw.message : String(raw ?? '')).trim()
  if (!msg) return 'The render failed. Please retry this variant.'
  const low = msg.toLowerCase()
  const has = (code: number) => new RegExp(`\\b${code}\\b`).test(msg)
  const mentions = (...words: string[]) => words.some(w => low.includes(w))

  // Messages we already wrote to be user-facing — pass them straight through.
  if (mentions('please retry', 'please retry this variant', 'came back empty', 'could not download the footage', 'took too long', 'timed out')) {
    return trim(msg)
  }

  // ── Remotion render (v4-v6) ──────────────────────────────────────────────────
  // A delayRender() handle that never cleared: headless Chrome couldn't finish
  // loading an asset inside the timeout. The raw message quotes the handle's
  // label, which embeds a multi-MB base64 font — and because callers keep only
  // the TAIL of stderr, the readable half is already gone by the time it lands
  // here, leaving cards showing "[binary], format: truetype, weight: undefined…".
  // Catch it before the generic trim so the card says something actionable.
  // "not cleared after" is the whole tell — it survives the tail-cut even when
  // "delayRender()"/"Loading font" don't, and no other service phrases it that way.
  if (mentions('delayrender', 'not cleared after')) {
    return 'The render host ran out of time loading fonts/assets (it was overloaded). Please retry this variant.'
  }

  // ── Ran out of credits — checked BEFORE any per-service branch ───────────────
  // Providers disagree wildly on how they say "your account is empty":
  //   ElevenLabs -> HTTP 401 + quota_exceeded  (reads as a broken key)
  //   Auphonic   -> a sentence with an <a href> Add Credits link
  //   OpenRouter -> HTTP 402
  //   Submagic   -> a plan/upgrade message
  // Detecting the CONDITION first means an empty account can never masquerade
  // as a bad key, a rate limit, or a raw stack trace on the variant card.
  const credits = outOfCredits(low)
  if (credits) return credits

  // ── OpenRouter / Gemini (video analysis, cut plan, b-roll, graphics) ──────────
  if (mentions('openrouter', 'gemini')) {
    if (has(402) || mentions('insufficient', 'credit', 'payment required', 'quota', 'balance'))
      return 'AI service (OpenRouter) is out of credits. Add credits at openrouter.ai, then retry.'
    if (has(401) || has(403) || mentions('invalid api key', 'no auth', 'unauthorized'))
      return 'AI service key (OpenRouter) is invalid or missing. Check OPENROUTER_API_KEY.'
    if (has(429) || mentions('rate limit', 'rate-limit', 'too many requests'))
      return 'AI service (OpenRouter) is rate-limited right now. Wait a minute, then retry.'
    return 'AI service (OpenRouter) had an error. Retry; if it persists, check your OpenRouter account.'
  }

  // ── Submagic (v1-v3 captions/styling) ────────────────────────────────────────
  if (mentions('submagic')) {
    if (has(402) || mentions('plan', 'upgrade', 'limit', 'quota', 'credits', 'exceeded'))
      return 'Submagic limit reached (plan or usage). Check your Submagic plan/usage, then retry.'
    if (has(401) || has(403) || mentions('unauthorized', 'api key', 'api-key', 'invalid key'))
      return 'Submagic key is invalid. Check SUBMAGIC_API_KEY.'
    if (has(429) || mentions('rate limit', 'too many requests'))
      return 'Submagic is rate-limited right now. Wait a minute, then retry.'
    return 'Submagic had an error finishing this edit. Please retry this variant.'
  }

  // ── ElevenLabs (transcription + voice isolation) ─────────────────────────────
  if (mentions('elevenlabs', 'eleven labs', 'scribe')) {
    // Quota FIRST: ElevenLabs answers an exhausted quota with HTTP 401, so the
    // auth branch below used to claim "key is invalid" while the key was
    // perfectly fine — a genuinely misleading message that cost real debugging
    // time. The body carries quota_exceeded / "credits remaining"; trust that
    // over the status code.
    if (mentions('quota', 'credits remaining', 'exceeds your quota', 'quota_exceeded'))
      return 'ElevenLabs is out of credits (transcription). Top up at elevenlabs.io, then retry.'
    if (has(401) || has(403) || mentions('invalid api key', 'unauthorized', 'missing_permissions'))
      return 'ElevenLabs key is invalid or lacks permissions. Check ELEVENLABS_API_KEY.'
    if (has(429) || mentions('rate limit', 'too many requests', 'concurrent'))
      return 'ElevenLabs is rate-limited (too many renders at once). Wait a moment, then retry.'
    if (mentions('limit', 'exceeded'))
      return 'ElevenLabs quota reached (transcription). Check your ElevenLabs plan/usage, then retry.'
    return 'Transcription service (ElevenLabs) had an error. Please retry this variant.'
  }

  // ── Auphonic (backup audio cleaner for v4-v6) ────────────────────────────────
  // Had no branch at all, so its failures reached the card as raw text — and
  // Auphonic embeds HTML links in its messages, which looked like gibberish.
  if (mentions('auphonic')) {
    if (has(401) || has(403) || mentions('unauthorized', 'invalid token'))
      return 'Auphonic key is invalid. Check AUPHONIC_API_TOKEN.'
    return 'Auphonic (backup audio cleanup) failed — the render continues on the ElevenLabs fallback.'
  }

  // ── Render host (Vercel Sandbox / GitHub Actions) ────────────────────────────
  if (mentions('sandbox', 'vercel sandbox')) {
    if (has(402) || mentions('payment', 'spend', 'quota', 'limit'))
      return 'Render host (Vercel) hit a usage/billing limit. Raise the Vercel spend cap, or switch the render host, then retry.'
    return 'Render host could not start the job. Please retry this variant.'
  }
  if (mentions('github') && mentions('dispatch', 'actions'))
    return 'Could not reach the render host (GitHub). Retry; if it persists, check GITHUB_DISPATCH_TOKEN.'

  // ── Storage (R2) ─────────────────────────────────────────────────────────────
  if (mentions('could not upload', 'r2', 'bad record mac') || (mentions('storage') && mentions('fail')))
    return 'Storage upload failed (temporary network/R2 issue). Please retry this variant.'

  // ── Google Drive source ──────────────────────────────────────────────────────
  if (mentions('drive') || (mentions('download') && mentions('footage', 'source')))
    return 'Could not download the footage from Google Drive. Confirm the link is shared/accessible, then retry.'

  // Unknown — keep the original, just trimmed so it isn't a wall of stack trace.
  return trim(msg)
}

// Every phrasing our providers actually use for "this account is empty". Kept
// deliberately literal — these strings came from real failure bodies, not guesses.
const CREDIT_SIGNS = [
  'quota_exceeded', 'exceeds your quota', 'quota exceeded',
  'credits remaining', 'available credits', 'add credits', 'out of credits',
  'insufficient credits', 'insufficient_quota', 'insufficient balance',
  'not enough credits', 'credit balance', 'payment required',
  'billing hard limit', 'spend limit', 'usage limit reached',
]

// Names the service AND says what to do about it. Returns null when the message
// isn't about credits at all, so the caller falls through to its normal branches.
function outOfCredits(low: string): string | null {
  if (!CREDIT_SIGNS.some(s => low.includes(s))) return null
  if (low.includes('auphonic'))
    return 'Auphonic is out of credits (audio cleanup). Top up at auphonic.com — renders continue on the ElevenLabs fallback meanwhile.'
  if (low.includes('elevenlabs') || low.includes('eleven labs') || low.includes('scribe'))
    return 'ElevenLabs is out of credits (transcription). Top up at elevenlabs.io, then retry.'
  if (low.includes('openrouter') || low.includes('gemini') || low.includes('whisper'))
    return 'OpenRouter is out of credits (AI planning + captions). Add credits at openrouter.ai, then retry.'
  if (low.includes('submagic'))
    return 'Submagic plan or usage limit reached. Check your Submagic plan, then retry.'
  if (low.includes('pexels'))
    return 'Pexels hourly quota reached (stock B-roll). It resets on the hour — retry then.'
  if (low.includes('vercel') || low.includes('sandbox'))
    return 'Render host (Vercel) hit a billing/usage limit. Raise the spend cap, then retry.'
  return 'A service ran out of credits. Check your provider accounts (OpenRouter, ElevenLabs, Auphonic, Submagic), then retry.'
}

function trim(msg: string): string {
  // Remotion render errors quote the component props back, which embed fonts as
  // base64 (sometimes raw, not a data: URI) — a wall of bytes that buries the
  // real message. Collapse those BEFORE trimming so any readable error survives.
  const cleaned = msg
    .replace(/data:[^;,\s"']+;base64,[A-Za-z0-9+/=]+/g, '[font]')
    .replace(/[A-Za-z0-9+/]{100,}={0,2}/g, '[binary]')
    // Some providers (Auphonic) put HTML links in error text; a card showing
    // `<a href="...">Add Credits</a>` reads as gibberish. Keep the link TEXT.
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 180 ? cleaned.slice(0, 180) + '…' : cleaned
}
