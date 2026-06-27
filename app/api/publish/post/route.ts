import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishPost } from '@/lib/blotato'

/** Convert a relative path like /renders/xxx/file.mp4 into an absolute URL.
 *  Blotato requires a publicly accessible https:// URL. */
function toAbsoluteUrl(url: string, req: NextRequest): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url

  // Try the configured public URL first (set in env for production)
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (base) return `${base}${url.startsWith('/') ? url : `/${url}`}`

  // Fall back to reconstructing from the request's origin headers
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}${url.startsWith('/') ? url : `/${url}`}`
}

export async function POST(req: NextRequest) {
  if (!process.env.BLOTATO_API_KEY) {
    return NextResponse.json({ error: 'BLOTATO_API_KEY not configured.' }, { status: 503 })
  }

  const { scriptId, videoJobId, variantId, downloadUrl, captions, accounts, scheduledAt } =
    await req.json() as {
      scriptId?: string | null
      videoJobId?: string | null
      variantId?: string | null
      downloadUrl: string
      captions: Record<string, string>
      // accounts now carries the full BlatoAccount shape so pageId travels here
      accounts: { id: string; platform: string; pageId?: string; [key: string]: unknown }[]
      scheduledAt?: string
    }

  if (!downloadUrl || !captions || !accounts?.length) {
    return NextResponse.json({ error: 'Missing downloadUrl, captions, or accounts.' }, { status: 400 })
  }

  // Ensure the media URL is absolute — Blotato rejects relative paths
  const absoluteUrl = toAbsoluteUrl(downloadUrl, req)

  const fallbackCaption = Object.values(captions).find(c => c?.trim()) ?? ''

  const supabase = await createClient()

  const { data: job, error: jobErr } = await supabase
    .from('publish_jobs')
    .insert({
      script_id: scriptId ?? null,
      video_job_id: videoJobId ?? null,
      variant_id: variantId ?? null,
      download_url: absoluteUrl,
      caption: fallbackCaption,
      account_ids: accounts.map(a => a.id),
      platform_posts: [],
      status: 'publishing',
      scheduled_at: scheduledAt ?? null,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'Could not create publish job.' }, { status: 500 })
  }

  const results = await Promise.allSettled(
    accounts.map(acc => {
      const platform = acc.platform.toLowerCase()
      const captionText = captions[platform] ?? fallbackCaption

      // For YouTube, extract the title (before |) and pass it separately
      let youtubeTitle: string | undefined
      if (platform === 'youtube' && captionText.includes('|')) {
        youtubeTitle = captionText.split('|')[0].trim().slice(0, 60)
      }

      return publishPost({
        accountId: acc.id,
        platform: acc.platform,
        text: captionText,
        mediaUrls: [absoluteUrl],
        scheduledAt,
        youtubeTitle,
        pageId: acc.pageId,
      })
    })
  )

  const platformPosts = accounts.map((acc, i) => {
    const r = results[i]
    if (r.status === 'fulfilled') {
      return { accountId: acc.id, platform: acc.platform, postId: r.value.postId, status: r.value.status, error: r.value.error ?? null }
    }
    return { accountId: acc.id, platform: acc.platform, postId: null, status: 'failed', error: (r.reason as Error).message }
  })

  const allFailed = platformPosts.every(p => p.status === 'failed')
  const anyFailed = platformPosts.some(p => p.status === 'failed')
  const finalStatus = allFailed ? 'failed' : anyFailed ? 'partial' : (scheduledAt ? 'scheduled' : 'published')

  await supabase
    .from('publish_jobs')
    .update({ platform_posts: platformPosts, status: finalStatus, published_at: scheduledAt ? null : new Date().toISOString() })
    .eq('id', job.id)

  return NextResponse.json({ publishJobId: job.id, status: finalStatus, platformPosts })
}
