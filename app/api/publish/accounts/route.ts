import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccounts } from '@/lib/blotato'
import type { PostEntry } from '@/lib/publish-reconcile'

export async function GET() {
  if (!process.env.BLOTATO_API_KEY) {
    return NextResponse.json({ error: 'BLOTATO_API_KEY not configured.' }, { status: 503 })
  }
  try {
    const accounts = await getAccounts()

    // Blotato has no "connection expired" field: the only signal is a post that
    // failed for that reason. So flag an account whose MOST RECENT attempt failed
    // that way, and the Publish page can say so before she tries again. A later
    // success clears it automatically (it is then no longer the latest result).
    let latest = new Map<string, PostEntry>()
    try {
      const supabase = await createClient()
      const { data: recent } = await supabase
        .from('publish_jobs')
        .select('platform_posts')
        .order('created_at', { ascending: false })
        .limit(30)
      for (const row of recent ?? []) {
        for (const p of (row.platform_posts ?? []) as PostEntry[]) {
          if (p.accountId && !latest.has(p.accountId)) latest.set(p.accountId, p)
        }
      }
    } catch {
      latest = new Map() // history is a nicety; never block loading the accounts
    }

    return NextResponse.json({
      accounts: accounts.map(a => {
        const last = latest.get(a.id)
        const broken = last?.status === 'failed' && /reconnect|expired|subaccount not found|not connected/i.test(last.error ?? '')
        return broken ? { ...a, needsReconnect: true, lastIssue: last!.error ?? null } : a
      }),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
