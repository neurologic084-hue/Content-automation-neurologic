const BASE_URL = 'https://backend.blotato.com/v2'
// Reads fail fast; the post itself gets longer because a timeout there leaves
// it unknown whether Blotato accepted it.
const READ_TIMEOUT_MS = 15_000
const POST_TIMEOUT_MS = 60_000

function headers() {
  return {
    'blotato-api-key': process.env.BLOTATO_API_KEY!,
    'Content-Type': 'application/json',
  }
}

export interface BlatoAccount {
  id: string
  platform: string
  fullname: string
  username: string
  // Facebook only: the connected Page. Blotato's accounts list does NOT include
  // it — getAccounts() fills it in from the account's /subaccounts endpoint.
  pageId?: string
  pageName?: string
  // Set by /api/publish/accounts when the account's latest post failed because
  // its connection needs renewing in Blotato.
  needsReconnect?: boolean
  lastIssue?: string | null
  // Pass-through for any other platform-specific fields Blotato returns
  [key: string]: unknown
}

export interface BlatoPostOptions {
  accountId: string
  platform: string
  text: string
  mediaUrls: string[]
  scheduledAt?: string
  // YouTube-specific: extracted from the caption title (before the |)
  youtubeTitle?: string
  // Facebook-specific: the connected Page's ID
  pageId?: string
  // TikTok-specific: visibility override (defaults to public). SELF_ONLY is
  // useful for end-to-end tests — the post is visible only to the account owner.
  tiktokPrivacy?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'
  // Status-poll timing. Tests only; production uses the defaults.
  poll?: { firstWaitMs?: number; intervalMs?: number; attempts?: number }
}

export interface BlatoPostResult {
  postId: string | null
  // 'processing' = Blotato accepted it but has not confirmed a result yet.
  // Never reported as published: a nonexistent id also reads "in-progress",
  // so only a real "published" answer counts (lib/publish-reconcile.ts keeps
  // checking until one arrives).
  status: 'published' | 'scheduled' | 'failed' | 'processing'
  error?: string
  /** Link to the live post, once the platform has one. */
  url?: string
}

export async function getAccounts(): Promise<BlatoAccount[]> {
  const res = await fetch(`${BASE_URL}/users/me/accounts`, {
    headers: headers(),
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Blotato accounts fetch failed (${res.status}): ${err}`)
  }
  const data = await res.json()
  // API returns { items: [...] } — pass through the full raw object so any
  // platform-specific fields survive to the publish call
  const raw: BlatoAccount[] = Array.isArray(data) ? data : (data.items ?? data.accounts ?? data.data ?? [])
  return Promise.all(raw.map(async acc => {
    if (acc.platform.toLowerCase() !== 'facebook' || acc.pageId) return acc
    const page = await getFacebookPage(acc.id).catch(() => null)
    return page ? { ...acc, pageId: page.id, pageName: page.name } : acc
  }))
}

// A Facebook post targets a Page, and Blotato's Page id is NOT the account id —
// it lives on /accounts/{id}/subaccounts (e.g. account 37730 → page
// 918552121656299). Sending the account id as pageId is what produced
// "422 Page / subaccount not found" on every Facebook publish.
async function getFacebookPage(accountId: string): Promise<{ id: string; name?: string } | null> {
  const res = await fetch(`${BASE_URL}/users/me/accounts/${encodeURIComponent(accountId)}/subaccounts`, {
    headers: headers(),
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Blotato subaccounts fetch failed (${res.status})`)
  const data = await res.json()
  const items: { id?: string | number; name?: string }[] = Array.isArray(data) ? data : (data.items ?? [])
  const page = items.find(p => p.id != null)
  return page ? { id: String(page.id), name: page.name } : null
}

// Largest video each platform takes through Blotato (help.blotato.com, media
// requirements; YouTube is the Starter-plan upload limit). TikTok documents none.
const MAX_VIDEO_MB: Record<string, number> = { instagram: 300, facebook: 512, youtube: 400 }

/** A plain sentence when this video is too big for the platform, else null. Checked BEFORE sending, so she gets advice instead of an obscure rejection. */
export function videoTooLargeMessage(platform: string, bytes: number | null): string | null {
  const limit = MAX_VIDEO_MB[platform.toLowerCase()]
  if (!limit || !bytes || bytes <= limit * 1024 * 1024) return null
  const mb = Math.round(bytes / (1024 * 1024))
  return `This version is ${mb} MB and ${platformName(platform)} takes up to ${limit} MB. Choose a different version of this video (the other styles are usually smaller) and publish again. Your other platforms are not affected.`
}

const PLATFORM_NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' }
const platformName = (platform: string) => PLATFORM_NAMES[platform.toLowerCase()] ?? platform.charAt(0).toUpperCase() + platform.slice(1)

// Turns Blotato's own wording (their error list: help.blotato.com/support/errors)
// into one plain sentence and, where she can fix it, what to do. Anything we do
// not recognise passes through so nothing is hidden.
export function friendlyBlotatoMessage(message: string, platform: string): string {
  const name = platformName(platform)
  const m = message.trim()
  if (/maximum number of \d+ posts for the last 24 hours/i.test(m)) {
    return `${name} has reached its limit of posts for the last 24 hours. Try again tomorrow, or schedule this one for later.`
  }
  if (/could not refresh tiktok access_token/i.test(m)) {
    return 'TikTok is having trouble connecting right now. Wait 15 to 30 minutes and publish again; if it keeps failing, reconnect TikTok in Blotato.'
  }
  if (/subaccount not found|reconnect|not connected|token.*(expired|invalid)|has expired|invalid_grant|not authorized|requires reconnect|error code 5002|wrong page id|manage_posts|account .* not found/i.test(m)) {
    return `${name} needs reconnecting in Blotato (my.blotato.com → Accounts), then publish again. Blotato said: ${m.slice(0, 200)}`
  }
  if (/could not fetch the media|could not upload media|failed to read media|unsupported media|media conversion failed/i.test(m)) {
    return `${name} could not load the video file. Wait a minute and publish again; if it keeps happening, tell your team. Blotato said: ${m.slice(0, 200)}`
  }
  return m
}

// Blotato error bodies are JSON like {"message":"..."}; show the sentence, not
// the JSON.
function describePublishError(status: number, body: string, platform: string): string {
  let message = body.trim()
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
    const m = parsed.message ?? parsed.error
    if (typeof m === 'string' && m.trim()) message = m.trim()
  } catch {
    // not JSON — keep the raw text
  }
  const friendly = friendlyBlotatoMessage(message, platform)
  return friendly !== message ? friendly : `Blotato rejected the post (${status}): ${message.slice(0, 300)}`
}

export async function publishPost(opts: BlatoPostOptions): Promise<BlatoPostResult> {
  const platform = opts.platform.toLowerCase()

  // Build the platform-specific target object
  let target: Record<string, unknown>

  if (platform === 'facebook') {
    // Blotato requires the Page's own id. Resolve it here too, so a publish
    // from a tab loaded before getAccounts() carried pageId still works.
    let pageId = opts.pageId
    if (!pageId) {
      try {
        pageId = (await getFacebookPage(opts.accountId))?.id
      } catch (e) {
        return { postId: null, status: 'failed', error: `Could not look up the Facebook Page in Blotato: ${(e as Error).message}` }
      }
    }
    if (!pageId) {
      return {
        postId: null,
        status: 'failed',
        error: 'No Facebook Page is linked to this account in Blotato. Reconnect Facebook at my.blotato.com and pick a Page, then publish again.',
      }
    }
    // Facebook only accepts video as a Reel now; say so instead of relying on the default.
    target = { targetType: 'facebook', pageId, mediaType: 'reel' }
  } else if (platform === 'youtube') {
    // Title comes from the caption before the | separator
    const title = (opts.youtubeTitle ?? opts.text.split('|')[0]).trim().slice(0, 100)
    target = {
      targetType: 'youtube',
      title,
      privacyStatus: 'public',
      shouldNotifySubscribers: false,
    }
  } else if (platform === 'tiktok') {
    // TikTok requires ALL of these fields — omitting any of them makes Blotato
    // reject the post. Values follow TikTok's content-posting API rules:
    // the creator publishes real talking-head footage, so no branded-content,
    // brand-organic, or AI-generated flags apply.
    target = {
      targetType: 'tiktok',
      privacyLevel: opts.tiktokPrivacy ?? 'PUBLIC_TO_EVERYONE',
      disabledComments: false,
      disabledDuet: false,
      disabledStitch: false,
      isBrandedContent: false,
      isYourBrand: false,
      isAiGenerated: false,
    }
  } else if (platform === 'instagram') {
    target = { targetType: 'instagram', mediaType: 'reel' }
  } else {
    target = { targetType: opts.platform }
  }

  // YouTube description is everything after the |; other platforms use the full text
  const text = platform === 'youtube' && opts.text.includes('|')
    ? opts.text.split('|').slice(1).join('|').trim()
    : opts.text

  const body = {
    post: {
      accountId: opts.accountId,
      target,
      content: {
        text,
        mediaUrls: opts.mediaUrls,
        platform: opts.platform,
      },
    },
    // scheduledTime must be a ROOT-LEVEL field, sibling of "post" — nesting it inside
    // "post" causes Blotato to silently ignore it and publish immediately.
    ...(opts.scheduledAt ? { scheduledTime: opts.scheduledAt } : {}),
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/posts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })
  } catch (e) {
    const timedOut = (e as Error).name === 'TimeoutError'
    return {
      postId: null,
      status: 'failed',
      error: timedOut
        ? 'Blotato did not answer in time. The post may still go out, so check my.blotato.com before publishing again to avoid posting it twice.'
        : `Could not reach Blotato: ${(e as Error).message}`,
    }
  }

  if (!res.ok) {
    const err = await res.text()
    return { postId: null, status: 'failed', error: describePublishError(res.status, err, platform) }
  }

  const data = await res.json()
  const postSubmissionId: string | null = data.postSubmissionId ?? null

  // Scheduled posts can't be confirmed now   the scheduled time is in the future.
  // Acceptance here just means Blotato successfully queued it.
  if (opts.scheduledAt) {
    return { postId: postSubmissionId, status: 'scheduled' }
  }

  if (!postSubmissionId) {
    return { postId: null, status: 'published' }
  }

  // Blotato processes the post asynchronously after accepting it: ask for the
  // real outcome instead of assuming success because the request was accepted.
  const outcome = await pollPostStatus(postSubmissionId, platform, opts.poll)
  if (outcome.status === 'failed') {
    return { postId: postSubmissionId, status: 'failed', error: outcome.error ?? 'Blotato reported a failure.' }
  }
  if (outcome.status === 'published') {
    return { postId: postSubmissionId, status: 'published', ...(outcome.url ? { url: outcome.url } : {}) }
  }
  // Still in progress after the window: report that, honestly. The caller keeps
  // checking (lib/publish-reconcile.ts) and the page updates when it resolves.
  return { postId: postSubmissionId, status: 'processing' }
}

export type PostCheck = { status: 'published' | 'scheduled' | 'failed' | 'in-progress'; url?: string; error?: string }

/** One look at a post's state. null = could not ask (network, rate limit, 5xx): try again later. */
export async function checkPostStatus(postSubmissionId: string, platform = ''): Promise<PostCheck | null> {
  try {
    const res = await fetch(`${BASE_URL}/posts/${encodeURIComponent(postSubmissionId)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return null // 429 / 5xx: not an answer
    const data = await res.json() as { status?: string; publicUrl?: unknown; errorMessage?: unknown; error?: unknown }
    if (data.status === 'published') return { status: 'published', url: typeof data.publicUrl === 'string' ? data.publicUrl : undefined }
    if (data.status === 'failed') {
      // The documented field is `errorMessage`; `error` was never populated, so
      // every failure used to read as the generic fallback.
      const raw = [data.errorMessage, data.error].find((x): x is string => typeof x === 'string' && !!x.trim())
      return { status: 'failed', error: raw ? friendlyBlotatoMessage(raw, platform || 'this platform') : undefined }
    }
    if (data.status === 'scheduled') return { status: 'scheduled' }
    return { status: 'in-progress' }
  } catch {
    return null
  }
}

// Blotato's own guidance: wait at least 10s between status requests (and the
// status endpoint allows 60 a minute). Four platforms polling every 3s was
// ~80 a minute. First look at 6s (a fast post is done by then), then every 10s
// for about a minute; anything slower is picked up by the reconciler.
const POLL_DEFAULTS = { firstWaitMs: 6_000, intervalMs: 10_000, attempts: 7 }

async function pollPostStatus(
  postSubmissionId: string,
  platform: string,
  timing: Partial<typeof POLL_DEFAULTS> = {},
): Promise<{ status: 'published' | 'failed' | 'in-progress'; error?: string; url?: string }> {
  const { firstWaitMs, intervalMs, attempts } = { ...POLL_DEFAULTS, ...timing }
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? firstWaitMs : intervalMs))
    const check = await checkPostStatus(postSubmissionId, platform)
    if (check?.status === 'published') return { status: 'published', url: check.url }
    if (check?.status === 'failed') return { status: 'failed', error: check.error }
  }
  return { status: 'in-progress' }
}
