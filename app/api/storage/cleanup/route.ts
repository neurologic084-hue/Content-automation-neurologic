import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import type { VideoVariant } from '@/lib/video-pipeline'

// Frees space WITHOUT losing anything the creator can see.
//
// A job keeps two kinds of file: the finished videos (finished/<jobId>/…) and
// the working files used to make them — the compressed source, the pre-cut,
// the cleaned audio, the staged B-roll. The working files are several times
// larger than the videos and are only needed while a job is being rendered.
// This deletes those, and only for jobs where nothing is still running.
//
// Deliberately conservative, because the cost of being wrong is a lost video:
//   - never touches finished/ (the videos themselves)
//   - never touches backup/
//   - never touches broll-cache/ (shared across jobs; deleting it would make
//     every future job re-download and re-analyse the same clips)
//   - skips any job with a variant still 'processing' or 'pending' — those
//     files are in use, or about to be
//
// The trade-off worth knowing: after cleanup, RETRYING a variant on an old job
// re-downloads and re-preps from the original Drive link instead of reusing
// stored files. Slower, and it costs the paid audio/transcription work again.
// That is why the button says what it does before doing it.
export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const { data: jobs } = await supabase.from('video_jobs').select('id, variants')

  const eligible = (jobs ?? []).filter(j => {
    const vs = (j.variants ?? []) as VideoVariant[]
    if (!vs.length) return false
    return !vs.some(v => v.status === 'processing' || v.status === 'pending')
  })
  if (!eligible.length) {
    return NextResponse.json({ freedGb: 0, jobs: 0, note: 'Every job still has work in progress — nothing safe to clear yet.' })
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  const Bucket = process.env.R2_BUCKET!

  let freed = 0
  let touched = 0
  for (const job of eligible) {
    const keys: { Key: string }[] = []
    let token: string | undefined
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: `${job.id}/`, ContinuationToken: token }))
      for (const o of page.Contents ?? []) {
        if (!o.Key) continue
        keys.push({ Key: o.Key })
        freed += o.Size ?? 0
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)

    if (!keys.length) continue
    touched++
    // DeleteObjects caps at 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000) } }))
    }
  }

  console.log(`[storage-cleanup] freed ${(freed / 1e9).toFixed(2)}GB across ${touched} finished job(s)`)
  return NextResponse.json({ freedGb: Number((freed / 1e9).toFixed(2)), jobs: touched })
}
