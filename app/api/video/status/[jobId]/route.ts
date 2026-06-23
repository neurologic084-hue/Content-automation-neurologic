import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pollSubmagicJob } from '@/lib/video-pipeline'
import type { VideoVariant } from '@/lib/video-pipeline'

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
    }
  }

  const allDone = variants.every((v) => v.status === 'ready' || v.status === 'failed')
  const newStatus = allDone ? 'complete' : 'processing'

  await supabase
    .from('video_jobs')
    .update({ variants, ...(allDone ? { status: 'complete' } : {}) })
    .eq('id', jobId)

  return NextResponse.json({ ...job, status: newStatus, variants })
}
