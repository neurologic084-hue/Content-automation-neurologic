import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { VARIANT_DEFINITIONS, DEFAULT_MUSIC_MODE, extractDriveFileId, verifyDriveFile } from '@/lib/video-pipeline'
import type { MusicMode, VideoVariant } from '@/lib/video-pipeline'
import { dispatchPipelineTask } from '@/lib/sandbox-tasks'
import { rendersDir } from '@/lib/paths'
import { deleteJobStorage } from '@/lib/storage'

const MUSIC_MODES: MusicMode[] = ['smart', 'off']

export async function POST(req: NextRequest) {
  const { scriptId, driveUrl, musicMode } = await req.json()
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

  // Delete any existing job for this script — including its files in R2 and
  // on local disk, which otherwise linger as unreachable orphans.
  const { data: oldJobs } = await supabase.from('video_jobs').select('id').eq('script_id', scriptId)
  await supabase.from('video_jobs').delete().eq('script_id', scriptId)
  for (const old of oldJobs ?? []) {
    void deleteJobStorage(old.id)
    try {
      fs.rmSync(rendersDir(old.id), { recursive: true, force: true })
    } catch { /* best-effort */ }
  }

  const variants = VARIANT_DEFINITIONS.filter((def) => !def.hidden).map((def) => ({
    ...def,
    status: 'pending',
    external_id: null,
    preview_url: null,
    download_url: null,
    duration_seconds: null,
    error: null,
    progress: { step: 5, total: 100, label: 'Preparing footage' },
    music_mode: resolvedMusicMode,
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

  // Download + compress + upload the footage as a background pipeline task —
  // in-process on a long-lived server, in a Sandbox VM on Vercel. Progress
  // and success/failure land on the variants via the task itself.
  // source_drive_url stays the original Drive link — Submagic-bound variants
  // resolve the actual fetchable URL via getSubmagicSourceUrl (the R2-hosted
  // compressed copy), not this field directly.
  console.log(`[video-process] preparing source for job=${job.id}`)
  await dispatchPipelineTask({ task: 'prepare-source', jobId: job.id, sourceUrl: confirmedVideoUrl })

  return NextResponse.json({ jobId: job.id })
}
