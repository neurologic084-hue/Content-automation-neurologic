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

// True when a failure is worth a SILENT automatic requeue rather than a card:
// nothing about THIS video caused it — a box under momentary pressure, an
// upstream fetch that flaked, a rate/hourly window. The classifier is the gate
// for lib/stale-sweep.ts autoRequeueVariant, so keep it conservative: a string
// added here means "retrying without telling anyone is the right response".
// Real product errors (validation, bad links, empty accounts, broken keys)
// must never match — silently retrying those just delays the honest card.
export function isTransientRenderError(raw: unknown): boolean {
  const low = (raw instanceof Error ? raw.message : String(raw ?? '')).toLowerCase()
  if (!low) return false
  // An empty account is not transient, whatever else the message says.
  if (CREDIT_SIGNS.some(s => low.includes(s))) return false
  return [
    // machine pressure (the compositor/OOM family)
    'resource temporarily unavailable', 'eagain', 'cannot allocate', 'out of memory', 'enomem', 'compositor error',
    // network flakes
    'econnreset', 'etimedout', 'socket hang up', 'fetch failed', 'bad record mac', 'network error',
    // upstream fetch/download blips (incl. Submagic failing to pull our file —
    // both at submit ("provided video url") and mid-render ("stalled in
    // download phase", the chunk renderer waiting on a throttled asset))
    'could not download the provided video url', 'download failed: http', 'could not download the footage',
    'stalled in download',
    // rate / hourly windows
    'rate limit', 'too many requests', 'hourly', 'upload limit',
    // killed mid-work
    'timed out', 'server restarted',
  ].some(s => low.includes(s))
}

// Submagic's per-plan hourly upload window: retrying in seconds only burns
// budget — the requeue must wait for the window to reset.
export function isSubmagicHourlyCap(raw: unknown): boolean {
  const low = (raw instanceof Error ? raw.message : String(raw ?? '')).toLowerCase()
  return low.includes('upload limit') || (low.includes('hourly') && low.includes('limit'))
}

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

  // ffmpeg's build banner is not an error, but it is what stderr's tail holds
  // when the process was killed rather than failing with a message. It reached
  // a client's variant card once; a card must never show it again.
  if (/--enable-lib|--enable-gpl|configuration:\s*--/.test(low)) {
    return 'The video tool was cut off mid-job (usually a timeout on a very large file, or the machine running out of memory). Please retry this variant.'
  }

  // ffmpeg encoder/stream-init prose ("Error initializing output stream 0:0 —
  // Error while opening encoder … maybe incorrect parameters such as bit_rate,
  // rate, width or height | Conversion failed!") reached every card of a job
  // verbatim. Usual causes: odd source dimensions or unusual extra streams —
  // both now handled inside the compressor (even-dimension scale + a
  // conservative-mapping retry), so reaching this card at all means the file
  // is genuinely unusual.
  if (mentions('opening encoder', 'initializing output stream', 'conversion failed')) {
    return 'The footage could not be converted — something about the file (unusual dimensions, streams, or encoding) surprised the converter. Retry once; if it happens again, re-export the video from your camera roll or editor and upload that.'
  }

  // ── OpenRouter / Gemini (video analysis, cut plan, b-roll, graphics) ──────────
  if (mentions('openrouter', 'gemini')) {
    if (has(402) || mentions('insufficient', 'credit', 'payment required', 'quota', 'balance'))
      return 'The AI that plans your edit has run out of credits. Let your editor know — once topped up, press retry and it picks up where it stopped. (OpenRouter)'
    if (has(401) || has(403) || mentions('invalid api key', 'no auth', 'unauthorized'))
      return "The AI planner's account connection stopped working, so nothing can render until it is fixed. This one is for your editor — nothing to do from your side. (OpenRouter API key)"
    if (has(429) || mentions('rate limit', 'rate-limit', 'too many requests'))
      return 'AI service (OpenRouter) is rate-limited right now. Wait a minute, then retry.'
    return 'AI service (OpenRouter) had an error. Retry; if it persists, check your OpenRouter account.'
  }

  // ── Submagic (v1-v3 captions/styling) ────────────────────────────────────────
  // Submagic's own failureReason strings don't contain the word "submagic", so
  // its DISTINCTIVE phrases are matched too — otherwise they fell through to
  // the raw-text trim and upstream API prose landed on client cards verbatim
  // (observed: the hourly-limit and could-not-download reasons, 2026-07-22).
  if (mentions('submagic', 'provided video url', 'hourly video upload', 'hourly upload limit')) {
    if (mentions('upload limit', 'hourly'))
      return "The editing engine's hourly upload window stayed full through several automatic retries. Wait a bit, then retry this version — nothing is lost."
    if (mentions('provided video url', 'could not download'))
      return 'The editing engine could not fetch the footage even after automatic retries — usually temporary hosting congestion. Retry this version in a few minutes.'
    // Deliberately NARROW. This used to match the bare word 'limit', which
    // appears in plenty of unrelated Submagic errors ("rate limit", "limit of
    // 100 items", a field-length complaint) — so ordinary failures were
    // reported to the client as "your plan is finished" and sent them to a
    // billing page for no reason. Only claim a plan/usage problem when the
    // message actually says so.
    if (has(402) || mentions('upgrade your plan', 'plan limit', 'usage limit', 'requires a higher plan', 'exceeded your plan', 'out of credits', 'insufficient credits'))
      return "The caption engine's plan has hit its limit, so this version could not be made. Nothing is lost — let your editor know, and once the plan is topped up press retry. (Submagic plan limit)"
    if (has(401) || has(403) || mentions('unauthorized', 'api key', 'api-key', 'invalid key'))
      return "The caption engine's account connection stopped working, so these versions cannot render until it is fixed. This one is for your editor. (Submagic API key)"
    if (has(429) || mentions('rate limit', 'too many requests'))
      return 'Submagic is rate-limited right now. Wait a minute, then retry.'
    // Unknown Submagic failure: say what we actually know rather than
    // inventing a cause. The raw reason is already on the card via the caller.
    return 'The editing engine could not finish this version. This is usually temporary — press retry. If it keeps happening, the detail in the logs will say why.'
  }

  // ── ElevenLabs (transcription + voice isolation) ─────────────────────────────
  if (mentions('elevenlabs', 'eleven labs', 'scribe')) {
    // Quota FIRST: ElevenLabs answers an exhausted quota with HTTP 401, so the
    // auth branch below used to claim "key is invalid" while the key was
    // perfectly fine — a genuinely misleading message that cost real debugging
    // time. The body carries quota_exceeded / "credits remaining"; trust that
    // over the status code.
    if (mentions('quota', 'credits remaining', 'exceeds your quota', 'quota_exceeded'))
      return 'The transcription service has run out of credits. Let your editor know — the backup usually covers it, so retry this version. (ElevenLabs)'
    if (has(401) || has(403) || mentions('invalid api key', 'unauthorized', 'missing_permissions'))
      return "The transcription service's account connection stopped working. This one is for your editor — retry after it is fixed. (ElevenLabs API key)"
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
      return "The audio cleaner's account connection stopped working — your video continues on the backup cleaner. Worth mentioning to your editor. (Auphonic API key)"
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

  // ── Render machine under momentary pressure (compositor / OOM family) ────────
  // "Could not extract frame from compositor Error: Compositor error: Resource
  // temporarily unavailable | [http://localhost:3000/proxy?src=…" reached a
  // client card verbatim. It means the box was briefly overloaded — the
  // in-process requeue and the sweep's self-heal normally absorb it, so by the
  // time this maps to a card the retries are spent.
  if (mentions('compositor', 'resource temporarily unavailable', 'cannot allocate', 'enomem'))
    return 'The render machine was overloaded for a moment and had to stop this one. It recovers on its own — please retry this variant.'

  // ── Storage (R2) ─────────────────────────────────────────────────────────────
  if (mentions('could not upload', 'r2', 'bad record mac') || (mentions('storage') && mentions('fail')))
    return 'Storage upload failed (temporary network/R2 issue). Please retry this variant.'

  // ── Google Drive source ──────────────────────────────────────────────────────
  // Quota FIRST: Google throttles a file that has been downloaded repeatedly
  // ("too many users have viewed or downloaded this file"). Telling the client
  // to "confirm the link is shared" for that case sends them off to fix a link
  // that is perfectly fine — the honest answer is that it clears on its own,
  // and the system's own backup copy usually covers it on retry.
  if (mentions('drive') && mentions('too many users', 'download quota', 'quota for this file'))
    return 'Google Drive is temporarily limiting downloads of this file (it was fetched many times today). Retry in a little while — the system will use its own backup copy when it can, and Drive clears this on its own within a day.'
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
    return 'The audio cleaner has run out of credits. This did not stop your video — the backup cleaner handled it instead, though it removes less background noise. A top-up restores the better one; worth mentioning to your editor. (Auphonic)'
  if (low.includes('elevenlabs') || low.includes('eleven labs') || low.includes('scribe')) {
    // Same account, two very different jobs — say which one stopped, because
    // the consequences differ: sound effects self-synthesise and the render is
    // fine, transcription falls back to Whisper.
    if (low.includes('sound-generation') || low.includes('sound effect'))
      return 'The sound-effects service has run out of credits. This did not stop your video — the effects were built locally instead, which sounds a little simpler but works fine. A top-up restores the richer library; worth mentioning to your editor. (ElevenLabs)'
    return 'The transcription service has run out of credits. This did not stop your video — the backup transcriber handled it instead. A top-up restores the more accurate one; worth mentioning to your editor. (ElevenLabs)'
  }
  if (low.includes('openrouter') || low.includes('gemini') || low.includes('whisper'))
    return 'The AI that plans your edit has run out of credits — it decides the cuts, the B-roll and the captions, and it has no backup. Your footage is safe; let your editor know, and once the account is topped up press retry — it picks up right where it stopped. (OpenRouter)'
  if (low.includes('submagic'))
    return 'The caption engine\'s plan has hit its limit, so this version could not be made. Nothing is lost — let your editor know, and once the plan is topped up press retry. (Submagic plan limit)'
  if (low.includes('pexels'))
    return 'The stock-footage library has hit its hourly limit. It resets on the hour — retry this version then. (Pexels)'
  if (low.includes('vercel') || low.includes('sandbox'))
    return 'The rendering service hit its usage limit, so this version could not start. Let your editor know — once the cap is raised, press retry. (Vercel)'
  return 'One of the editing services has run out of credits, so this step could not finish. Nothing is lost — let your editor know, and after a top-up press retry to pick up where it stopped.'
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

/** The one place a person can actually go to fix this failure.
 *
 *  explainFailure names the cause in words; this turns that into a link the UI
 *  can render as a button. Kept separate so the message stays readable on its
 *  own (logs, Slack) and the UI decides how to present the action.
 *
 *  Returns null when there is nowhere useful to send someone — a transient
 *  render crash needs Retry, not a dashboard. */
export function failureAction(raw: unknown): { label: string; url: string } | null {
  const low = String(
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''),
  ).toLowerCase()

  const isCredit = CREDIT_SIGNS.some(s => low.includes(s)) || /\b40[23]\b/.test(low)

  if (low.includes('auphonic'))
    return { label: 'Top up Auphonic', url: 'https://auphonic.com/engine/accounts/credits/' }
  if (low.includes('elevenlabs') || low.includes('eleven labs') || low.includes('scribe'))
    return { label: 'Top up ElevenLabs', url: 'https://elevenlabs.io/app/subscription' }
  if (low.includes('openrouter'))
    return { label: 'Add OpenRouter credits', url: 'https://openrouter.ai/credits' }
  if (low.includes('submagic'))
    // App root, not a guessed deep link: Submagic is a single-page app, so
    // /settings/billing answers 200 even if that route does not exist and the
    // client would land on an in-app 404.
    return { label: 'Open Submagic', url: 'https://app.submagic.co' }
  if (low.includes('pexels'))
    return { label: 'Check Pexels API', url: 'https://www.pexels.com/api/' }
  if (low.includes('blotato'))
    return { label: 'Open Blotato', url: 'https://my.blotato.com/accounts' }
  if (low.includes('drive.google') || low.includes('google drive'))
    return { label: 'Open Google Drive', url: 'https://drive.google.com/drive/my-drive' }
  if (isCredit)
    return { label: 'Check billing', url: 'https://openrouter.ai/credits' }
  return null
}
