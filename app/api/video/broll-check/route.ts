import { NextRequest, NextResponse } from 'next/server'
import { extractDriveFileId, extractDriveFolderId, listDriveFolderVideos } from '@/lib/video-pipeline'

// Validates B-roll links BEFORE a job is created, so "Confirm" can tell the
// creator what we actually found — "12 clips" or a specific reason it failed.
//
// Without this, a mistyped or unshared folder was only discovered minutes into
// prep, and the render quietly went ahead with no B-roll at all. Same expansion
// rules as the job-creation route so what Confirm reports is what a render gets.
const MAX_CUSTOM_BROLL = 12

export async function POST(req: NextRequest) {
  const { links } = await req.json()
  if (!Array.isArray(links) || !links.length) {
    return NextResponse.json({ clips: 0, error: 'Paste a Google Drive folder link first.' }, { status: 400 })
  }

  const found: string[] = []
  for (const raw of links.slice(0, MAX_CUSTOM_BROLL)) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    if (found.length >= MAX_CUSTOM_BROLL) break
    const link = raw.trim()
    const folderId = extractDriveFolderId(link)
    const fileId = folderId ? null : extractDriveFileId(link)

    if (folderId) {
      try {
        const files = await listDriveFolderVideos(folderId)
        if (!files.length) {
          return NextResponse.json({
            clips: 0,
            error: 'That folder looks empty, or it is not shared. Set it to "Anyone with the link" and put your clips inside.',
          }, { status: 400 })
        }
        for (const f of files.slice(0, MAX_CUSTOM_BROLL - found.length)) found.push(f.id)
      } catch (e) {
        return NextResponse.json({ clips: 0, error: `Could not read that folder: ${(e as Error).message}` }, { status: 400 })
      }
    } else if (fileId) {
      found.push(fileId)
    } else if (/^https?:\/\//.test(link) && !link.includes('drive.google.com')) {
      found.push(link)
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
  return NextResponse.json({ clips: found.length })
}
