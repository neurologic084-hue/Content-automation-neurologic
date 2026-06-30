import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { publishPost } from '@/lib/blotato'
import { PLATFORM_CAPS } from '@/lib/caption-platforms'
import { uploadToStorage } from '@/lib/storage'

/** If the URL is a local /renders/... path, upload it to Supabase Storage
 *  and return the public URL. Otherwise return as-is. */
async function resolveMediaUrl(url: string): Promise<string> {
  if (!url.startsWith('/renders/')) return url

  // /renders/<jobId>/<fileName>
  const parts = url.replace(/^\/renders\//, '').split('/')
  const jobId = parts[0]
  const fileName = parts[1]
  if (!jobId || !fileName) return url

  const localPath = path.join(process.cwd(), 'public', 'renders', jobId, fileName)
  return uploadToStorage(localPath, fileName, jobId)
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

  const fallbackCaption = Object.values(captions).find(c => c?.trim()) ?? ''

  const supabase = await createClient()

  // CC-BY attribution: if this variant used a library track that legally requires
  // a credit, append it to every caption so the license is satisfied on the post.
  // Without this, a CC-BY track on a public post is copyright infringement.
  let musicCredit: string | null = null
  if (videoJobId && variantId) {
    const { data: vj } = await supabase.from('video_jobs').select('variants').eq('id', videoJobId).single()
    const variant = (vj?.variants as { id: string; music_attribution?: string | null }[] | undefined)
      ?.find(v => v.id === variantId)
    musicCredit = variant?.music_attribution ?? null
  }
  // Append the credit, but respect each platform's caption cap. The credit is a
  // legal requirement, so if the combined text would overflow (TikTok's 140 is
  // the tight one), we trim the CAPTION to make room and keep the credit intact
  // rather than dropping it.
  const withCredit = (text: string, platform: string): string => {
    if (!musicCredit || text.includes(musicCredit)) return text
    const sep = '\n\n'
    const cap = (PLATFORM_CAPS as Record<string, { max: number }>)[platform]?.max
    const full = `${text}${sep}${musicCredit}`
    if (!cap || full.length <= cap) return full
    const room = cap - sep.length - musicCredit.length
    // If the credit alone won't fit the cap, post the credit by itself (legal
    // requirement wins over caption copy); otherwise trim the caption to fit.
    return room <= 0 ? musicCredit.slice(0, cap) : `${text.slice(0, room).trimEnd()}${sep}${musicCredit}`
  }

  // Insert the job row first, before the upload, so a failed upload still leaves a
  // traceable record instead of vanishing with just a transient error response.
  const { data: job, error: jobErr } = await supabase
    .from('publish_jobs')
    .insert({
      script_id: scriptId ?? null,
      video_job_id: videoJobId ?? null,
      variant_id: variantId ?? null,
      download_url: downloadUrl,
      caption: fallbackCaption,
      account_ids: accounts.map(a => a.id),
      platform_posts: [],
      status: 'pending',
      scheduled_at: scheduledAt ?? null,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    return NextResponse.json({ error: jobErr?.message ?? 'Could not create publish job.' }, { status: 500 })
  }

  // Upload to Supabase Storage if it's a local file, otherwise use URL as-is
  let absoluteUrl: string
  try {
    absoluteUrl = await resolveMediaUrl(downloadUrl)
  } catch (err) {
    await supabase.from('publish_jobs').update({ status: 'failed' }).eq('id', job.id)
    return NextResponse.json({ error: `Failed to upload video to storage: ${String(err)}` }, { status: 500 })
  }

  await supabase.from('publish_jobs').update({ download_url: absoluteUrl, status: 'publishing' }).eq('id', job.id)

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
        text: withCredit(captionText, platform),
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
