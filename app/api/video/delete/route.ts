import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { deleteJobStorage, deleteStoragePrefixes } from '@/lib/storage'

/** Deletes a video job along with its stored files (R2 + local renders dir).
 *  Replaces the client-side row delete, which left every uploaded video
 *  orphaned in the bucket forever. */
export async function POST(req: NextRequest) {
  const { jobId } = await req.json() as { jobId?: string }
  if (!jobId || !/^[a-zA-Z0-9-]+$/.test(jobId)) {
    return NextResponse.json({ error: 'Missing or invalid jobId.' }, { status: 400 })
  }

  const supabase = await createClient()

  // A scheduled/in-flight publish may still need its finished render URL at
  // posting time. Keep the finished files for those; the compressed source
  // and working files are safe to drop either way.
  const { data: pendingPublishes } = await supabase
    .from('publish_jobs')
    .select('id')
    .eq('video_job_id', jobId)
    .in('status', ['pending', 'publishing', 'scheduled'])

  // .select() returns the rows actually removed — if none were (job doesn't
  // exist, or the caller isn't allowed to delete it), don't touch storage.
  // Otherwise this route would let anyone wipe R2 files for arbitrary job ids.
  const { data: deletedRows, error } = await supabase
    .from('video_jobs')
    .delete()
    .eq('id', jobId)
    .select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!deletedRows?.length) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  if (pendingPublishes?.length) {
    console.log(`[video-delete] job ${jobId} has ${pendingPublishes.length} pending publish(es) — keeping finished renders in R2`)
    void deleteStoragePrefixes([`${jobId}/`])
  } else {
    void deleteJobStorage(jobId)
  }

  try {
    fs.rmSync(path.join(process.cwd(), 'public', 'renders', jobId), { recursive: true, force: true })
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true })
}
