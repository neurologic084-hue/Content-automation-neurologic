import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pollSubmagicJob } from '@/lib/video-pipeline'
import type { VideoVariant } from '@/lib/video-pipeline'
import fs from 'fs'
import path from 'path'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  if (job.status === 'complete') {
    return NextResponse.json(job)
  }

  const variants: VideoVariant[] = job.variants ?? []

  // Poll any Submagic variants that are still processing
  const submagicPending = variants.filter(
    (v) => v.tool === 'submagic' && v.status === 'processing' && v.external_id
  )

  let variantsChanged = false

  // Recovery: if a locally-rendered variant is still showing "processing" but
  // the output file exists on disk, the DB missed the markVariant write (race condition).
  // Trust the file and heal the DB state here.
  const rendersDir = path.join(process.cwd(), 'public', 'renders', jobId)
  for (const v of variants) {
    if (v.status === 'processing' && !v.tool) {
      const localFile = path.join(rendersDir, `${v.id}.mp4`)
      if (fs.existsSync(localFile)) {
        v.status = 'ready'
        v.download_url = `/renders/${jobId}/${v.id}.mp4`
        v.preview_url = `/renders/${jobId}/${v.id}.mp4`
        v.progress = null
        variantsChanged = true
      }
    }
  }

  if (submagicPending.length > 0) {
    const pollResults = await Promise.allSettled(
      submagicPending.map((v) => pollSubmagicJob(v.external_id!))
    )

    for (let i = 0; i < submagicPending.length; i++) {
      const variant = submagicPending[i]
      const result = pollResults[i]
      if (result.status !== 'fulfilled') continue

      const poll = result.value
      const target = variants.find((v) => v.id === variant.id)
      if (!target) continue

      target.status = poll.status
      target.preview_url = poll.previewUrl
      target.download_url = poll.downloadUrl
      target.error = poll.error
      variantsChanged = true
    }
  }

  const started = variants.filter((v) => v.status !== 'pending')
  const allDone = started.length > 0 && started.every((v) => v.status === 'ready' || v.status === 'failed')
  const newStatus = allDone ? 'complete' : 'processing'

  // Only write back to DB when Submagic variants changed or job is newly complete.
  // Writing on every poll causes a race: the stale read overwrites markVariant's "ready" write.
  if (variantsChanged || allDone) {
    await supabase
      .from('video_jobs')
      .update({ variants, ...(allDone ? { status: 'complete' } : {}) })
      .eq('id', jobId)
  }

  return NextResponse.json({ ...job, status: newStatus, variants })
}
