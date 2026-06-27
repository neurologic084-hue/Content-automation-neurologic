import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishPost } from '@/lib/blotato'

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
      accounts: { id: string; platform: string }[]
      scheduledAt?: string
    }

  if (!downloadUrl || !captions || !accounts?.length) {
    return NextResponse.json({ error: 'Missing downloadUrl, captions, or accounts.' }, { status: 400 })
  }

  // Use first non-empty caption as fallback if a platform key is missing
  const fallbackCaption = Object.values(captions).find(c => c?.trim()) ?? ''

  const supabase = await createClient()

  // Create publish job row
  const { data: job, error: jobErr } = await supabase
    .from('publish_jobs')
    .insert({
      script_id: scriptId ?? null,
      video_job_id: videoJobId ?? null,
      variant_id: variantId ?? null,
      download_url: downloadUrl,
      caption: fallbackCaption,
      account_ids: accounts.map((a: { id: string }) => a.id),
      platform_posts: [],
      status: 'publishing',
      scheduled_at: scheduledAt ?? null,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'Could not create publish job.' }, { status: 500 })
  }

  // Fire posts to all selected accounts
  const results = await Promise.allSettled(
    accounts.map((acc: { id: string; platform: string }) =>
      publishPost({
        accountId: acc.id,
        platform: acc.platform,
        text: captions[acc.platform.toLowerCase()] ?? fallbackCaption,
        mediaUrls: [downloadUrl],
        scheduledAt,
      })
    )
  )

  const platformPosts = accounts.map((acc: { id: string; platform: string }, i: number) => {
    const r = results[i]
    if (r.status === 'fulfilled') {
      return { accountId: acc.id, platform: acc.platform, postId: r.value.postId, status: r.value.status, error: r.value.error ?? null }
    }
    return { accountId: acc.id, platform: acc.platform, postId: null, status: 'failed', error: (r.reason as Error).message }
  })

  const allFailed = platformPosts.every((p: { status: string }) => p.status === 'failed')
  const anyFailed = platformPosts.some((p: { status: string }) => p.status === 'failed')
  const finalStatus = allFailed ? 'failed' : anyFailed ? 'partial' : (scheduledAt ? 'scheduled' : 'published')

  await supabase
    .from('publish_jobs')
    .update({ platform_posts: platformPosts, status: finalStatus, published_at: scheduledAt ? null : new Date().toISOString() })
    .eq('id', job.id)

  return NextResponse.json({ publishJobId: job.id, status: finalStatus, platformPosts })
}
