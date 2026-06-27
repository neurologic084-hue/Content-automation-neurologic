import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { startSingleVariant } from '@/lib/motion-renderer'
import { submitSubmagicJob, pollSubmagicJob } from '@/lib/video-pipeline'
import type { VideoVariant } from '@/lib/video-pipeline'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

async function pollSubmagicUntilDone(jobId: string, variantId: string, projectId: string) {
  const db = supabaseAdmin()
  const INTERVAL_MS = 8_000
  const MAX_ATTEMPTS = 75  // ~10 minutes

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    const result = await pollSubmagicJob(projectId).catch(() => null)
    if (!result || result.status === 'processing') continue

    const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    if (!job?.variants) return

    const variants = (job.variants as VideoVariant[]).map(v => {
      if (v.id !== variantId) return v
      if (result.status === 'ready') {
        return { ...v, status: 'ready', download_url: result.downloadUrl, preview_url: result.previewUrl, error: null, progress: null }
      }
      return { ...v, status: 'failed', error: result.error ?? 'Submagic failed', progress: null }
    })

    const allDone = variants.every(v => v.status === 'ready' || v.status === 'failed')
    await db.from('video_jobs').update({ variants, ...(allDone ? { status: 'complete' } : {}) }).eq('id', jobId)
    return
  }

  // Timeout
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  if (!job?.variants) return
  const variants = (job.variants as VideoVariant[]).map(v =>
    v.id === variantId ? { ...v, status: 'failed', error: 'Submagic timed out after 10 minutes', progress: null } : v
  )
  await db.from('video_jobs').update({ variants }).eq('id', jobId)
}

export async function POST(req: NextRequest) {
  const { jobId, variantId } = await req.json()

  if (!jobId || !variantId) {
    return NextResponse.json({ error: 'Missing jobId or variantId.' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const variant = (job.variants ?? []).find((v: VideoVariant) => v.id === variantId)
  if (!variant) {
    return NextResponse.json({ error: 'Variant not found.' }, { status: 400 })
  }

  const variants: VideoVariant[] = (job.variants ?? []).map((v: VideoVariant) =>
    v.id === variantId
      ? { ...v, status: 'processing', external_id: null, preview_url: null, download_url: null, error: null }
      : v
  )
  await supabase.from('video_jobs').update({ variants, status: 'processing' }).eq('id', jobId)

  if (variant.tool === 'hyperframe') {
    const { data: scriptRow } = await supabase
      .from('scripts')
      .select('hook, cta, mood_tag')
      .eq('id', job.script_id)
      .single()

    startSingleVariant(
      jobId,
      variantId,
      job.source_drive_url,
      scriptRow?.hook ?? '',
      scriptRow?.cta ?? '',
      variant.zapcapTemplateIndex as 1 | 2 | undefined,
      variant.zapcapBrollPercent as number | undefined,
      variant.descriptBroll as boolean | undefined,
      variant.descriptCaptions as boolean | undefined,
      variant.brollDriveUrl as string | undefined,
    )

    return NextResponse.json({ ok: true })
  }

  if (variant.tool === 'submagic') {
    const preset = variant.submagicPreset ?? {}
    try {
      const projectId = await submitSubmagicJob(job.source_drive_url, {
        title: `${variantId}-${jobId.slice(0, 8)}`,
        aiEditTemplate: preset.aiEditTemplate,
      })

      // Save external_id immediately
      const withExternal = (job.variants as VideoVariant[]).map((v: VideoVariant) =>
        v.id === variantId ? { ...v, status: 'processing', external_id: projectId } : v
      )
      await supabase.from('video_jobs').update({ variants: withExternal }).eq('id', jobId)

      // Fire-and-forget poll loop
      pollSubmagicUntilDone(jobId, variantId, projectId).catch(e =>
        console.error('[start-variant] Submagic poll error:', e)
      )

      return NextResponse.json({ ok: true })
    } catch (e) {
      const failed = (job.variants as VideoVariant[]).map((v: VideoVariant) =>
        v.id === variantId ? { ...v, status: 'failed', error: (e as Error).message } : v
      )
      await supabase.from('video_jobs').update({ variants: failed }).eq('id', jobId)
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unsupported tool.' }, { status: 400 })
}
