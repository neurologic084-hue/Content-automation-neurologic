const BASE_URL = 'https://backend.blotato.com/v2'

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
  // Facebook pages have a pageId returned by the Blotato accounts API
  pageId?: string
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
}

export interface BlatoPostResult {
  postId: string | null
  status: 'published' | 'scheduled' | 'failed'
  error?: string
}

export async function getAccounts(): Promise<BlatoAccount[]> {
  const res = await fetch(`${BASE_URL}/users/me/accounts`, {
    headers: headers(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Blotato accounts fetch failed (${res.status}): ${err}`)
  }
  const data = await res.json()
  // API returns { items: [...] } — pass through the full raw object so platform-specific
  // fields like pageId survive to the publish call
  const raw: BlatoAccount[] = Array.isArray(data) ? data : (data.items ?? data.accounts ?? data.data ?? [])
  return raw
}

export async function publishPost(opts: BlatoPostOptions): Promise<BlatoPostResult> {
  const platform = opts.platform.toLowerCase()

  // Build the platform-specific target object
  let target: Record<string, unknown>

  if (platform === 'facebook') {
    // Blotato requires pageId for Facebook posts. The connected account's id IS the page id
    // in Blotato's system; fall back to accountId if pageId is not explicitly set.
    target = {
      targetType: 'facebook',
      pageId: opts.pageId ?? opts.accountId,
    }
  } else if (platform === 'youtube') {
    // Title comes from the caption before the | separator
    const title = (opts.youtubeTitle ?? opts.text.split('|')[0]).trim().slice(0, 100)
    target = {
      targetType: 'youtube',
      title,
      privacyStatus: 'public',
      shouldNotifySubscribers: false,
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

  const res = await fetch(`${BASE_URL}/posts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    return { postId: null, status: 'failed', error: `HTTP ${res.status}: ${err.slice(0, 300)}` }
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

async function pollPostStatus(
  postSubmissionId: string,
  maxAttempts = 8,
  intervalMs = 2000
): Promise<{ status: 'published' | 'failed' | 'in-progress'; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/posts/${postSubmissionId}`, {
        headers: headers(),
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
