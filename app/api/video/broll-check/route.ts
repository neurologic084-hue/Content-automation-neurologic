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

// Reachability alone is not enough: a PDF answers 200 exactly like a video,
// and "Video is accessible ✓" on a PDF was observed in production. So the
// probe also answers WHAT responded, from the content-type and the file's
// first bytes — every real container announces itself there (mp4/mov carry an
// 'ftyp' atom, webm starts with EBML, AVI with RIFF) and so does everything
// that isn't a video (%PDF, PNG/JPEG magic, zip). Drive's virus-scan
// interstitial for large files answers text/html for perfectly good videos,
// so HTML falls back to the filename in the page title; when nothing is
// recognisable either way the verdict is 'unknown' and the link passes — a
// false "not a video" on real footage is worse than letting prep's own
// converter catch an oddball later.
type DriveProbe = { reachable: boolean; verdict: 'video' | 'not-video' | 'unknown'; kind?: string }

// First bytes of a response WITHOUT trusting Range support: Drive's uc
// endpoint sometimes ignores Range and streams the whole file, so read
// stream chunks up to a small cap and cancel.
async function firstBytes(res: Response, cap = 4096): Promise<Buffer> {
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const parts: Uint8Array[] = []
  let got = 0
  try {
    while (got < cap) {
      const { value, done } = await reader.read()
      if (done) break
      parts.push(value)
      got += value.byteLength
    }
  } finally {
    try { await reader.cancel() } catch { /* already done */ }
  }
  return Buffer.concat(parts).subarray(0, cap)
}

const NON_VIDEO_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|png|jpe?g|gif|heic|webp|zip|rar|mp3|wav|m4a|aac)$/i

async function probeDriveFile(url: string): Promise<DriveProbe> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-4095', 'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/126 Safari/537.36' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok && res.status !== 206) return { reachable: false, verdict: 'unknown' }
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    const head = await firstBytes(res)
    const ascii = head.toString('latin1')

    if (ct.startsWith('video/')) return { reachable: true, verdict: 'video' }

    // Definitive non-video answers, by header then by magic bytes.
    if (ct.includes('application/pdf') || ascii.startsWith('%PDF')) return { reachable: true, verdict: 'not-video', kind: 'a PDF' }
    if (ct.startsWith('image/') || ascii.startsWith('\x89PNG') || ascii.startsWith('\xFF\xD8\xFF') || ascii.startsWith('GIF8')) {
      return { reachable: true, verdict: 'not-video', kind: 'an image' }
    }
    if (ct.startsWith('audio/') || ascii.startsWith('ID3')) return { reachable: true, verdict: 'not-video', kind: 'an audio file' }
    if (ct.includes('msword') || ct.includes('officedocument') || ascii.startsWith('PK\x03\x04')) {
      return { reachable: true, verdict: 'not-video', kind: 'a document' }
    }
    if (ct.startsWith('text/plain')) return { reachable: true, verdict: 'not-video', kind: 'a text file' }

    // Video containers by signature: ISO-BMFF atoms (mp4/mov), EBML (webm/
    // mkv), RIFF AVI. Checked on bytes because Drive often answers
    // application/octet-stream for real videos.
    const atom = ascii.slice(4, 8)
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(atom)) return { reachable: true, verdict: 'video' }
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { reachable: true, verdict: 'video' }
    if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ') return { reachable: true, verdict: 'video' }

    // Drive's interstitial (large files): HTML with the real filename in the
    // title — judge by its extension when present.
    if (ct.includes('text/html') || /^\s*<!doctype|^\s*<html/i.test(ascii)) {
      const title = ascii.match(/<title>([^<]*?)(?:\s+-\s+Google Drive)?<\/title>/i)?.[1] ?? ''
      if (NON_VIDEO_EXT.test(title)) return { reachable: true, verdict: 'not-video', kind: `a ${title.split('.').pop()?.toLowerCase()} file` }
      if (VIDEO_EXT.test(title)) return { reachable: true, verdict: 'video' }
      return { reachable: true, verdict: 'unknown' }
    }

    return { reachable: true, verdict: 'unknown' }
  } catch {
    return { reachable: false, verdict: 'unknown' }
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
    const probe = await probeDriveFile(driveDownload(fileId))
    if (!probe.reachable) {
      return NextResponse.json({
        ok: false,
        error: 'That video is not accessible. Set sharing to "Anyone with the link" and try again.',
      }, { status: 400 })
    }
    if (probe.verdict === 'not-video') {
      return NextResponse.json({
        ok: false,
        error: `That link is ${probe.kind ?? 'not a video'} — the footage must be a video file (mp4 or mov). Share the video itself and paste its link.`,
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

  // Prove they can actually be fetched AND are actually videos — a folder can
  // list files the sharing settings still block, and a pasted file link can be
  // anything. Checked in parallel so 12 clips stay quick.
  const probes = await Promise.all(found.map(f => probeDriveFile(driveDownload(f.id))))
  const usable = probes.filter(p => p.reachable && p.verdict !== 'not-video').length
  if (!usable) {
    const allNonVideo = probes.every(p => p.verdict === 'not-video')
    return NextResponse.json({
      clips: 0,
      error: allNonVideo
        ? 'None of those files are videos — B-roll must be video clips (mp4, mov, m4v...).'
        : 'Those clips are not accessible. Set the folder to "Anyone with the link" and try again.',
    }, { status: 400 })
  }

  return NextResponse.json({
    clips: usable,
    // Honest partial result: some clips are unreachable/not videos but the
    // render can still use the rest, so this is a warning rather than a hard
    // failure.
    ...(usable < found.length
      ? { warning: `${found.length - usable} of ${found.length} files are not accessible or not videos and will be skipped.` }
      : {}),
  })
}
