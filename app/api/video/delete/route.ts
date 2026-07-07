import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { createClient } from '@/lib/supabase/server'
import { deleteJobStorage, deleteStoragePrefixes } from '@/lib/storage'
import { rendersDir } from '@/lib/paths'

/** Deletes video job(s) along with their stored files (R2 + local renders).
 *  Accepts either a single jobId or a scriptId (deletes every edit that
 *  script has). The script itself is NEVER touched here — deleting an edit
 *  must never take the script with it. */
export async function POST(req: NextRequest) {
  const { jobId, scriptId } = await req.json() as { jobId?: string; scriptId?: string }
  const SAFE = /^[a-zA-Z0-9-]+$/
  if ((!jobId || !SAFE.test(jobId)) && (!scriptId || !SAFE.test(scriptId))) {
    return NextResponse.json({ error: 'Missing or invalid jobId/scriptId.' }, { status: 400 })
  }

  const supabase = await createClient()

  // Resolve the target job ids (RLS scopes this to the caller's own rows).
  let jobIds: string[] = []
  if (jobId && SAFE.test(jobId)) {
    jobIds = [jobId]
  } else if (scriptId && SAFE.test(scriptId)) {
    const { data: jobs } = await supabase.from('video_jobs').select('id').eq('script_id', scriptId)
    jobIds = (jobs ?? []).map(j => j.id as string)
  }
  if (!jobIds.length) {
    return NextResponse.json({ ok: true, deleted: 0 })
  }

  // A scheduled/in-flight publish may still need its finished render URL at
  // posting time. Keep the finished files for those; the compressed source
  // and working files are safe to drop either way.
  const { data: pendingPublishes } = await supabase
    .from('publish_jobs')
    .select('video_job_id')
    .in('video_job_id', jobIds)
    .in('status', ['pending', 'publishing', 'scheduled'])
  const keepFinished = new Set((pendingPublishes ?? []).map(p => p.video_job_id as string))

  // .select() returns the rows actually removed — if none were (jobs don't
  // exist, or the caller isn't allowed to delete them), don't touch storage.
  // Otherwise this route would let anyone wipe R2 files for arbitrary ids.
  const { data: deletedRows, error } = await supabase
    .from('video_jobs')
    .delete()
    .in('id', jobIds)
    .select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  for (const id of (deletedRows ?? []).map(r => r.id as string)) {
    if (keepFinished.has(id)) {
      console.log(`[video-delete] job ${id} has pending publish(es) — keeping finished renders in R2`)
      void deleteStoragePrefixes([`${id}/`])
    } else {
      void deleteJobStorage(id)
    }
    try {
      fs.rmSync(rendersDir(id), { recursive: true, force: true })
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, deleted: deletedRows?.length ?? 0 })
}
