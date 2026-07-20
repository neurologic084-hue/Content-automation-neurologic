import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

// Storage meter for the settings page. R2 has no hard ceiling — it grows and
// bills per GB automatically, so nothing ever "fills up" and breaks. The quota
// here is a soft BUDGET (STORAGE_QUOTA_GB, default 25) so growth is a visible,
// deliberate choice rather than a silent line item: the card warns as the
// budget approaches, and the answer can be "delete old jobs" or "raise the
// number", both fine.
//
// Backups (backup/ prefix) are counted separately: they are deliberate copies,
// and lumping them in would double-count every video and trip the warning for
// the wrong reason.
export const dynamic = 'force-dynamic'

// The whole-bucket listing costs one request per 1000 objects (currently ~200
// total), but there is no reason to pay it per page load either.
let cache: { at: number; body: unknown } | null = null
const CACHE_MS = 5 * 60 * 1000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  if (cache && Date.now() - cache.at < CACHE_MS) return NextResponse.json(cache.body)

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })

  let live = 0
  let backups = 0
  let token: string | undefined
  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      ContinuationToken: token,
    }))
    for (const o of page.Contents ?? []) {
      if (o.Key?.startsWith('backup/')) backups += o.Size ?? 0
      else live += o.Size ?? 0
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  const quotaGb = Number(process.env.STORAGE_QUOTA_GB) || 25
  const usedGb = live / 1e9
  const body = {
    usedGb: Number(usedGb.toFixed(2)),
    backupGb: Number((backups / 1e9).toFixed(2)),
    quotaGb,
    leftGb: Number(Math.max(0, quotaGb - usedGb).toFixed(2)),
    // Warn inside the last GB of budget. Storage keeps working past it — R2
    // scales on its own — this is about noticing, not about breaking.
    warning: quotaGb - usedGb <= 1,
  }
  cache = { at: Date.now(), body }
  return NextResponse.json(body)
}
