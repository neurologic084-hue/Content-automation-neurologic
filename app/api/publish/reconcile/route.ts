import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcilePublishJobs } from '@/lib/publish-reconcile'

// The Publish page calls this while any post is still "posting" or a scheduled
// one has come due, so the page learns the real outcome without a reload.
// Runs as the signed-in user (RLS limits it to her own records).
export const dynamic = 'force-dynamic'

export async function POST() {
  if (!process.env.BLOTATO_API_KEY) return NextResponse.json({ error: 'BLOTATO_API_KEY not configured.' }, { status: 503 })
  const supabase = await createClient()
  const result = await reconcilePublishJobs(supabase)
  return NextResponse.json(result)
}
