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
      ...(opts.scheduledAt ? { scheduledTime: opts.scheduledAt } : {}),
    },
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
  const postId = data.id ?? data.postId ?? null
  const scheduled = !!opts.scheduledAt
  return { postId, status: scheduled ? 'scheduled' : 'published' }
}
