import { NextRequest, NextResponse } from 'next/server'
import { extractDriveFileId, extractDriveFolderId, listDriveFolderVideos } from '@/lib/video-pipeline'

// Validates Drive links BEFORE a job is created — both the creator's B-roll
// folder and the main footage link.
//
// Without this, a mistyped, unshared or non-video link was only discovered
// minutes into prep: the render then either failed outright or quietly shipped
// with no B-roll. Confirm answers three questions up front — is it a Drive
// link, is it actually reachable, and does it look like a video — so what the
// creator sees here is what a render will get.
const MAX_CUSTOM_BROLL = 12
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i

// Drive serves large files behind a confirm page, so a plain HEAD can answer
// text/html for a perfectly good video. Treat only a hard 4xx/5xx as "not
// accessible"; anything that responds is reachable.
async function isReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-64', 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36' },
      signal: AbortSignal.timeout(20_000),
    })
    return res.ok || res.status === 206
  } catch {
    return false
  }
}

const driveDownload = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`

export async function POST(req: NextRequest) {
  const { links, kind } = await req.json() as { links?: unknown; kind?: 'broll' | 'footage' }

  // ── Main footage: one link, must be a Drive FILE and must be reachable ──────
  if (kind === 'footage') {
    const link = Array.isArray(links) ? String(links[0] ?? '') : String(links ?? '')
    if (!link.trim()) {
      return NextResponse.json({ ok: false, error: 'Paste your Google Drive video link first.' }, { status: 400 })
    }
    if (extractDriveFolderId(link)) {
      return NextResponse.json({
        ok: false,
        error: 'That is a FOLDER link. For the footage, share the video file itself and paste its link.',
      }, { status: 400 })
    }
    const fileId = extractDriveFileId(link)
    if (!fileId) {
      return NextResponse.json({ ok: false, error: 'That does not look like a Google Drive file link.' }, { status: 400 })
    }
    if (!(await isReachable(driveDownload(fileId)))) {
      return NextResponse.json({
        ok: false,
        error: 'That video is not accessible. Set sharing to "Anyone with the link" and try again.',
      }, { status: 400 })
    }
    return NextResponse.json({ ok: true, clips: 1 })
  }

  // ── B-roll: a folder link (or file links), expanded then reachability-tested ─
  if (!Array.isArray(links) || !links.length) {
    return NextResponse.json({ clips: 0, error: 'Paste a Google Drive folder link first.' }, { status: 400 })
  }

  const found: { id: string; name?: string }[] = []
  for (const raw of links.slice(0, MAX_CUSTOM_BROLL)) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    if (found.length >= MAX_CUSTOM_BROLL) break
    const link = raw.trim()
    const folderId = extractDriveFolderId(link)
    const fileId = folderId ? null : extractDriveFileId(link)

    if (folderId) {
      try {
        const files = await listDriveFolderVideos(folderId)
        const videos = files.filter(f => VIDEO_EXT.test(f.name))
        if (!files.length) {
          return NextResponse.json({
            clips: 0,
            error: 'That folder looks empty, or it is not shared. Set it to "Anyone with the link" and put your clips inside.',
          }, { status: 400 })
        }
        if (!videos.length) {
          return NextResponse.json({
            clips: 0,
            error: `That folder has ${files.length} file(s) but no videos in it. B-roll must be video files (mp4, mov, m4v...).`,
          }, { status: 400 })
        }
        for (const f of videos.slice(0, MAX_CUSTOM_BROLL - found.length)) found.push({ id: f.id, name: f.name })
      } catch (e) {
        return NextResponse.json({ clips: 0, error: `Could not read that folder: ${(e as Error).message}` }, { status: 400 })
      }
    } else if (fileId) {
      found.push({ id: fileId })
    } else if (/^https?:\/\//.test(link)) {
      return NextResponse.json({
        clips: 0,
        error: 'Only Google Drive links are supported for B-roll.',
      }, { status: 400 })
    } else {
      return NextResponse.json({
        clips: 0,
        error: `That does not look like a Drive link: "${link.slice(0, 50)}"`,
      }, { status: 400 })
    }
  }

  if (!found.length) {
    return NextResponse.json({ clips: 0, error: 'No usable clips found in what you pasted.' }, { status: 400 })
  }

  // Prove they can actually be fetched — a folder can list files the sharing
  // settings still block. Checked in parallel so 12 clips stay quick.
  const reachable = await Promise.all(found.map(f => isReachable(driveDownload(f.id))))
  const okCount = reachable.filter(Boolean).length
  if (!okCount) {
    return NextResponse.json({
      clips: 0,
      error: 'Those clips are not accessible. Set the folder to "Anyone with the link" and try again.',
    }, { status: 400 })
  }

  return NextResponse.json({
    clips: okCount,
    // Honest partial result: some clips are unreachable but the render can
    // still use the rest, so this is a warning rather than a hard failure.
    ...(okCount < found.length
      ? { warning: `${found.length - okCount} of ${found.length} clips are not accessible and will be skipped.` }
      : {}),
  })
}
