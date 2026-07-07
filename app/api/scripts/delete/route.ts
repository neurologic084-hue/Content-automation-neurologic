import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { createClient } from '@/lib/supabase/server'
import { deleteJobStorage, deleteStoragePrefixes } from '@/lib/storage'
import { rendersDir } from '@/lib/paths'

/** Deletes a script AND everything downstream of it: its video jobs (via the
 *  DB cascade) plus their stored files in R2 and on disk, and optionally the
 *  parent idea. One direction only — deleting an edit never touches the
 *  script; deleting the script always takes its edits with it. */
export async function POST(req: NextRequest) {
  const { scriptId, ideaId } = await req.json() as { scriptId?: string; ideaId?: string | null }
  if (!scriptId || !/^[a-zA-Z0-9-]+$/.test(scriptId)) {
    return NextResponse.json({ error: 'Missing or invalid scriptId.' }, { status: 400 })
  }

  const supabase = await createClient()

  // Collect the script's video jobs BEFORE the row delete — the DB cascade
  // will remove the rows, and after that nobody remembers which R2 folders
  // belonged to them (that's exactly how the bucket filled with orphans).
  const { data: jobs } = await supabase
    .from('video_jobs')
    .select('id')
    .eq('script_id', scriptId)
  const jobIds = (jobs ?? []).map(j => j.id as string)

  // A scheduled/in-flight publish may still need its finished render URL at
  // posting time — keep those finished files, drop only working files.
  const { data: pendingPublishes } = jobIds.length
    ? await supabase
        .from('publish_jobs')
        .select('video_job_id')
        .in('video_job_id', jobIds)
        .in('status', ['pending', 'publishing', 'scheduled'])
    : { data: [] as { video_job_id: string }[] }
  const keepFinished = new Set((pendingPublishes ?? []).map(p => p.video_job_id as string))

  // .select() returns the rows actually removed — if none were (script gone,
  // or the caller isn't allowed), don't touch storage.
  const { data: deletedRows, error } = await supabase
    .from('scripts')
    .delete()
    .eq('id', scriptId)
    .select('id')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!deletedRows?.length) {
    return NextResponse.json({ error: 'Script not found.' }, { status: 404 })
  }

  // Storage cleanup for every edit the cascade just removed.
  for (const jobId of jobIds) {
    if (keepFinished.has(jobId)) {
      console.log(`[script-delete] job ${jobId} has pending publish(es) — keeping finished renders in R2`)
      void deleteStoragePrefixes([`${jobId}/`])
    } else {
      void deleteJobStorage(jobId)
    }
    try {
      fs.rmSync(rendersDir(jobId), { recursive: true, force: true })
    } catch { /* best-effort */ }
  }

  // The idea is the script's parent, so it goes too when requested (matches
  // the library's existing behavior).
  if (ideaId && /^[a-zA-Z0-9-]+$/.test(ideaId)) {
    await supabase.from('ideas').delete().eq('id', ideaId)
  }

  return NextResponse.json({ ok: true, cleanedJobs: jobIds.length })
}
