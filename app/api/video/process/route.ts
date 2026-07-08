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
  const { scriptId, driveUrl, musicMode, customBroll } = await req.json()
  const resolvedMusicMode: MusicMode = MUSIC_MODES.includes(musicMode) ? musicMode : DEFAULT_MUSIC_MODE

  if (!scriptId || !driveUrl) {
    return NextResponse.json({ error: 'Missing scriptId or driveUrl.' }, { status: 400 })
  }

  // Optional creator-supplied B-roll: Drive share links, resolved to direct
  // download form. Invalid lines are rejected up front, not at render time.
  const customBrollEntries: { url: string }[] = []
  if (Array.isArray(customBroll)) {
    for (const raw of customBroll.slice(0, 12)) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      const link = raw.trim()
      const brollFileId = extractDriveFileId(link)
      if (brollFileId) {
        customBrollEntries.push({ url: `https://drive.google.com/uc?export=download&id=${brollFileId}` })
      } else if (/^https?:\/\//.test(link) && !link.includes('drive.google.com')) {
        customBrollEntries.push({ url: link })
      } else {
        return NextResponse.json(
          { error: `Invalid B-roll link: "${link.slice(0, 60)}". Use Google Drive share links (one per line).` },
          { status: 400 }
        )
      }
    }
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
      ...(customBrollEntries.length ? { custom_broll: customBrollEntries } : {}),
    })
    .select('id')
    .single()

  // Graceful degradation: if the custom_broll column migration hasn't run yet,
  // retry without it so job creation never breaks — the clips just won't be
  // used until the migration lands.
  let jobRow = job
  if ((error?.message ?? '').includes('custom_broll') && customBrollEntries.length) {
    console.warn('[video-process] custom_broll column missing — run supabase/migration-custom-broll.sql; creating job without it')
    const retry = await supabase
      .from('video_jobs')
      .insert({ script_id: scriptId, source_drive_url: confirmedVideoUrl, status: 'processing', variants })
      .select('id')
      .single()
    jobRow = retry.data
    if (retry.error || !jobRow) {
      return NextResponse.json({ error: retry.error?.message ?? 'Could not start job.' }, { status: 500 })
    }
  } else if (error || !job) {
    return NextResponse.json({ error: error?.message ?? 'Could not start job.' }, { status: 500 })
  }

  // Download + compress + upload the footage as a background pipeline task —
  // in-process on a long-lived server, in a Sandbox VM on Vercel. Progress
  // and success/failure land on the variants via the task itself.
  // source_drive_url stays the original Drive link — Submagic-bound variants
  // resolve the actual fetchable URL via getSubmagicSourceUrl (the R2-hosted
  // compressed copy), not this field directly.
  console.log(`[video-process] preparing source for job=${jobRow!.id}`)
  await dispatchPipelineTask({ task: 'prepare-source', jobId: jobRow!.id, sourceUrl: confirmedVideoUrl })

  return NextResponse.json({ jobId: jobRow!.id })
}
