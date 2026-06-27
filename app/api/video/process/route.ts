import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { VARIANT_DEFINITIONS, extractDriveFileId, verifyDriveFile } from '@/lib/video-pipeline'

export async function POST(req: NextRequest) {
  const { scriptId, driveUrl, brollDriveUrl } = await req.json()

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

  return NextResponse.json({ jobId: job.id })
}
