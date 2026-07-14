import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { VARIANT_DEFINITIONS, DEFAULT_MUSIC_MODE, extractDriveFileId, extractDriveFolderId, listDriveFolderVideos, verifyDriveFile } from '@/lib/video-pipeline'
import type { MusicMode, VideoVariant } from '@/lib/video-pipeline'
import { normalizeGradeMode } from '@/lib/color-grade'
import { normalizeBrollSetting } from '@/lib/broll'
import { dispatchPipelineTask } from '@/lib/sandbox-tasks'
import { rendersDir } from '@/lib/paths'
import { deleteJobStorage } from '@/lib/storage'

const MUSIC_MODES: MusicMode[] = ['smart', 'off']

export async function POST(req: NextRequest) {
  const { scriptId, driveUrl, musicMode, gradeMode, brollMode, brollPercent, customBroll } = await req.json()
  const resolvedMusicMode: MusicMode = MUSIC_MODES.includes(musicMode) ? musicMode : DEFAULT_MUSIC_MODE
  const resolvedGradeMode = normalizeGradeMode(gradeMode)
  const resolvedBroll = normalizeBrollSetting(brollMode, brollPercent)

  if (!scriptId || !driveUrl) {
    return NextResponse.json({ error: 'Missing scriptId or driveUrl.' }, { status: 400 })
  }

  // Optional creator-supplied B-roll: Drive share links (files OR a whole
  // folder), resolved to direct download form. A folder link expands to every
  // video inside it, so the creator maintains one Drive folder of B-roll and
  // pastes a single link. Invalid lines are rejected up front, not at render
  // time. Up to 24 clips are stored; at render time Gemini watches each one
  // and the best 12 for THIS script are used (selectBestClips in lib/broll).
  const MAX_CUSTOM_BROLL = 24
  const customBrollEntries: { url: string }[] = []
  if (Array.isArray(customBroll)) {
    for (const raw of customBroll.slice(0, MAX_CUSTOM_BROLL)) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      if (customBrollEntries.length >= MAX_CUSTOM_BROLL) break
      const link = raw.trim()
      const brollFolderId = extractDriveFolderId(link)
      const brollFileId = brollFolderId ? null : extractDriveFileId(link)
      if (brollFolderId) {
        try {
          const files = await listDriveFolderVideos(brollFolderId)
          if (!files.length) {
            return NextResponse.json(
              { error: 'That Drive folder looks empty (or not shared). Put your B-roll clips inside and share the folder as "Anyone with the link".' },
              { status: 400 }
            )
          }
          for (const f of files.slice(0, MAX_CUSTOM_BROLL - customBrollEntries.length)) {
            customBrollEntries.push({ url: `https://drive.google.com/uc?export=download&id=${f.id}` })
          }
          console.log(`[process] expanded B-roll folder ${brollFolderId} → ${files.length} clip(s)`)
        } catch (e) {
          return NextResponse.json(
            { error: `Could not read the B-roll folder: ${(e as Error).message}` },
            { status: 400 }
          )
        }
      } else if (brollFileId) {
        customBrollEntries.push({ url: `https://drive.google.com/uc?export=download&id=${brollFileId}` })
      } else if (/^https?:\/\//.test(link) && !link.includes('drive.google.com')) {
        customBrollEntries.push({ url: link })
      } else {
        return NextResponse.json(
          { error: `Invalid B-roll link: "${link.slice(0, 60)}". Paste a Google Drive folder link (or file links, one per line).` },
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
    grade_mode: resolvedGradeMode,
    broll_mode: resolvedBroll.mode,
    broll_percent: resolvedBroll.percent,
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
    // 23503 = FK violation (scriptId not in scripts), 22P02 = not a valid uuid.
    // Both mean "no such script" — say that instead of leaking raw Postgres.
    if (error?.code === '23503' || error?.code === '22P02') {
      return NextResponse.json({ error: 'Script not found. Refresh the page and try again.' }, { status: 404 })
    }
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
