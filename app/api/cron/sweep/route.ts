import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sweepStaleVariants } from '@/lib/stale-sweep'
import type { VideoVariant } from '@/lib/video-pipeline'

// Scheduled watchdog for stuck jobs (see vercel.json `crons`). The status
// route runs the same sweep, but only while a browser is polling — this route
// covers the closed-tab case so a dead render can't sit 'processing' forever.
//
// Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is set; without the env var the route stays open (it's
// idempotent and read-mostly, but set the secret in production anyway).

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data: jobs, error } = await db
    .from('video_jobs')
    .select('id, created_at, variants')
    .eq('status', 'processing')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let swept = 0
  for (const job of jobs ?? []) {
    swept += await sweepStaleVariants(db, job.id, (job.variants ?? []) as VideoVariant[], job.created_at)
  }

  if (swept > 0) console.warn(`[cron-sweep] failed ${swept} stuck variant(s) across ${jobs?.length ?? 0} processing job(s)`)
  return NextResponse.json({ checked: jobs?.length ?? 0, swept })
}
