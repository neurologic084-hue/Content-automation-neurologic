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
}

export interface BlatoPostOptions {
  accountId: string
  platform: string
  text: string
  mediaUrls: string[]
  scheduledAt?: string  // ISO 8601   omit for immediate publish
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
  // API returns { items: [...] }
  const raw: BlatoAccount[] = Array.isArray(data) ? data : (data.items ?? data.accounts ?? data.data ?? [])
  return raw
}

export async function publishPost(opts: BlatoPostOptions): Promise<BlatoPostResult> {
  const body = {
    post: {
      accountId: opts.accountId,
      target: { targetType: opts.platform },
      content: {
        text: opts.text,
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
