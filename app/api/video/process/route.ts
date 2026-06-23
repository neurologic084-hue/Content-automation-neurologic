import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  VARIANT_DEFINITIONS,
  extractDriveFileId,
  submitSubmagicJob,
  fetchBrollClips,
} from '@/lib/video-pipeline'
import { startMotionRender } from '@/lib/motion-renderer'

export async function POST(req: NextRequest) {
  const { scriptId, driveUrl } = await req.json()

  if (!scriptId || !driveUrl) {
    return NextResponse.json({ error: 'Missing scriptId or driveUrl.' }, { status: 400 })
  }

  const fileId = extractDriveFileId(driveUrl)
  if (!fileId) {
    return NextResponse.json(
      { error: 'Invalid Google Drive link. Share the file and paste the share link.' },
      { status: 400 }
    )
  }

  const directVideoUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

  const supabase = await createClient()

  // Load script for Pexels keywords and caption context
  const { data: script } = await supabase
    .from('scripts')
    .select('hook, cta, mood_tag')
    .eq('id', scriptId)
    .single()

  // Load clinic branding for branded variant
  const { data: brand } = await supabase.from('brand_settings').select('creator_name, tagline').maybeSingle()
  const clinicName: string = brand?.creator_name ?? 'Your Brand'
  const clinicTagline: string = brand?.tagline ?? 'Book your consultation today'

  // Cancel any existing job for this script
  await supabase.from('video_jobs').delete().eq('script_id', scriptId)

  // Submit all 3 Submagic jobs with full premium features
  const submagicDefs = VARIANT_DEFINITIONS.filter((d) => d.tool === 'submagic' && d.submagicPreset)
  const submagicResults = await Promise.allSettled(
    submagicDefs.map((def) =>
      submitSubmagicJob(directVideoUrl, {
        templateName: def.submagicPreset!.template,
        title: `${def.name} - ${scriptId.slice(0, 8)}`,
        magicBrolls: def.submagicPreset!.broll,
        magicBrollsPercentage: 40,
        magicZooms: def.submagicPreset!.zoom,
        hookTitle: def.submagicPreset!.hookTitle,
        removeSilencePace: def.submagicPreset!.silencePace,
        removeBadTakes: def.submagicPreset!.badTakes,
        cleanAudio: true,
      })
    )
  )

  // Fetch two Pexels B-roll sets in parallel
  const [brollMed, brollLife] = await Promise.all([
    fetchBrollClips('medical doctor clinic consultation', 5),
    fetchBrollClips(
      script?.mood_tag === 'energetic' || script?.mood_tag === 'bold'
        ? 'fitness wellness gym health'
        : 'skincare beauty spa wellness',
      5
    ),
  ])

  // Build variants array
  const variants = VARIANT_DEFINITIONS.map((def) => {
    if (def.tool === 'submagic') {
      const idx = submagicDefs.findIndex((d) => d.id === def.id)
      const result = submagicResults[idx]
      return {
        ...def,
        status: result.status === 'fulfilled' ? 'processing' : 'failed',
        external_id: result.status === 'fulfilled' ? result.value : null,
        preview_url: null,
        download_url: null,
        duration_seconds: null,
        error: result.status === 'rejected' ? String((result as PromiseRejectedResult).reason) : null,
      }
    }

    // HyperFrames variants — rendered in background
    return {
      ...def,
      status: 'processing',
      external_id: null,
      preview_url: null,
      download_url: null,
      duration_seconds: null,
      error: null,
    }
  })

  const { data: job, error } = await supabase
    .from('video_jobs')
    .insert({
      script_id: scriptId,
      source_drive_url: driveUrl,
      status: 'processing',
      variants,
    })
    .select('id')
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Could not start job.' }, { status: 500 })
  }

  // Fire-and-forget background rendering for HyperFrames variants
  const hookText = script?.hook ?? ''
  const ctaText  = script?.cta  ?? ''
  setImmediate(() => {
    startMotionRender(job.id, directVideoUrl, brollMed, brollLife, clinicName, clinicTagline, hookText, ctaText).catch(
      (e) => console.error('[process] motion render error:', e)
    )
  })

  return NextResponse.json({ jobId: job.id })
}
