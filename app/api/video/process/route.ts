import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { VARIANT_DEFINITIONS, DEFAULT_MUSIC_MODE, extractDriveFileId, verifyDriveFile } from '@/lib/video-pipeline'
import type { MusicMode, VideoVariant } from '@/lib/video-pipeline'
import { prepareJobSource } from '@/lib/motion-renderer'

const MUSIC_MODES: MusicMode[] = ['smart', 'off']

export async function POST(req: NextRequest) {
  const { scriptId, driveUrl, brollDriveUrl, musicMode } = await req.json()
  const resolvedMusicMode: MusicMode = MUSIC_MODES.includes(musicMode) ? musicMode : DEFAULT_MUSIC_MODE

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
  const check = verifyDriveFile(directVideoUrl)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 422 })
  }
  const confirmedVideoUrl = check.resolvedUrl

  const supabase = await createClient()

  // Delete any existing job for this script
  await supabase.from('video_jobs').delete().eq('script_id', scriptId)

  const variants = VARIANT_DEFINITIONS.map((def) => ({
    ...def,
    status: 'pending',
    external_id: null,
    preview_url: null,
    download_url: null,
    duration_seconds: null,
    error: null,
    progress: { step: 5, total: 100, label: 'Preparing footage' },
    music_mode: resolvedMusicMode,
    ...(brollDriveUrl ? { brollDriveUrl: brollDriveUrl as string } : {}),
  }))

  const { data: job, error } = await supabase
    .from('video_jobs')
    .insert({
      script_id: scriptId,
      source_drive_url: confirmedVideoUrl,
      status: 'processing',
      variants,
    })
    .select('id')
    .single()

  if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Could not start job.' }, { status: 500 })
  }

  let lastProgressWrite = 0
  const writePrepProgress = async (percent: number, label: string) => {
    const now = Date.now()
    if (percent < 100 && now - lastProgressWrite < 700) return
    lastProgressWrite = now

    const { data: currentJob } = await supabase
      .from('video_jobs')
      .select('variants')
      .eq('id', job.id)
      .single()

    const currentVariants = (currentJob?.variants ?? variants) as VideoVariant[]
    const nextVariants = currentVariants.map((v) => (
      v.status === 'pending'
        ? { ...v, progress: { step: Math.max(1, Math.min(100, Math.round(percent))), total: 100, label } }
        : v
    ))

    await supabase.from('video_jobs').update({ variants: nextVariants }).eq('id', job.id)
  }

  console.log(`[video-process] preparing source for job=${job.id}`)
  prepareJobSource(job.id, confirmedVideoUrl, writePrepProgress)
    .then(async (prepared) => {
      console.log(`[video-process] source prepared job=${job.id} local=${prepared.localPath}`)
      const { data: currentJob } = await supabase
        .from('video_jobs')
        .select('variants')
        .eq('id', job.id)
        .single()

      const currentVariants = (currentJob?.variants ?? variants) as VideoVariant[]
      const readyVariants = currentVariants.map((v) => (
        v.status === 'pending' ? { ...v, progress: null } : v
      ))

      // source_drive_url stays the original Drive link -- Submagic fetches
      // directly from it, no Storage round-trip.
      await supabase
        .from('video_jobs')
        .update({ variants: readyVariants })
        .eq('id', job.id)
    })
    .catch(async (e) => {
      console.error(`[video-process] source prep failed job=${job.id}:`, (e as Error).message)
      const failedVariants = variants.map((v) => ({
        ...v,
        status: 'failed' as const,
        progress: null,
        error: `Could not download footage from Google Drive: ${(e as Error).message}`,
      }))

      await supabase
        .from('video_jobs')
        .update({ variants: failedVariants, status: 'failed' })
        .eq('id', job.id)
    })

  return NextResponse.json({ jobId: job.id })
}
