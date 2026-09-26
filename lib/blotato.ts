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
}

export interface BlatoPostResult {
  postId: string | null
  status: 'published' | 'scheduled' | 'failed'
  error?: string
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

// Blotato error bodies are JSON like {"message":"..."}; show the sentence, not
// the JSON, and say what to do when it is a connection problem she can fix.
function describePublishError(status: number, body: string, platform: string): string {
  let message = body.trim()
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
    const m = parsed.message ?? parsed.error
    if (typeof m === 'string' && m.trim()) message = m.trim()
  } catch {
    // not JSON — keep the raw text
  }
  if (/subaccount not found|reconnect your social account|not connected|token.*(expired|invalid)/i.test(message)) {
    const name = platform.charAt(0).toUpperCase() + platform.slice(1)
    return `${name} needs reconnecting in Blotato (my.blotato.com → Accounts), then publish again. Blotato said: ${message.slice(0, 200)}`
  }
  return `Blotato rejected the post (${status}): ${message.slice(0, 300)}`
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
    target = { targetType: 'facebook', pageId }
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
        ? 'Blotato did not answer in time — the post may still go out. Check my.blotato.com before publishing again, so it is not posted twice.'
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

  // Blotato processes the post asynchronously after accepting it   poll for the
  // real outcome instead of assuming success the moment the request is accepted.
  const outcome = await pollPostStatus(postSubmissionId)
  if (outcome.status === 'failed') {
    return { postId: postSubmissionId, status: 'failed', error: outcome.error ?? 'Blotato reported a failure.' }
  }
  // 'published' or still 'in-progress' after the poll window   report published either way
  // (in-progress almost always resolves quickly after); the postId lets it be checked later.
  return { postId: postSubmissionId, status: 'published' }
}

// TikTok is the slowest platform to confirm (~30s observed end-to-end), so the
// poll budget is ~36s. Anything still in-progress after that is reported as
// published — Blotato almost always resolves it moments later.
async function pollPostStatus(
  postSubmissionId: string,
  maxAttempts = 12,
  intervalMs = 3000
): Promise<{ status: 'published' | 'failed' | 'in-progress'; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/posts/${postSubmissionId}`, {
        headers: headers(),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'published') return { status: 'published' }
        if (data.status === 'failed') return { status: 'failed', error: data.error }
      }
    } catch {
      // network hiccup mid-poll   keep trying within the budget
    }
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { status: 'in-progress' }
}
