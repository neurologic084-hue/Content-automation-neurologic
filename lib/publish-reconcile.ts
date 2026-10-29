// Keeps our record of a post honest after the publish request has returned.
//
// Blotato accepts a post immediately and finishes it in the background (a Reel
// can take minutes), and a scheduled post only runs later. Two things used to
// go unrecorded: a post still "in-progress" when we stopped looking was reported
// as published, and a scheduled post stayed "scheduled" forever. This looks
// again, fills in the link, and turns a late failure into a failure.

import type { SupabaseClient } from '@supabase/supabase-js'
import { checkPostStatus, type PostCheck } from './blotato'

export type PostEntry = {
  accountId?: string
  platform: string
  postId: string | null
  status: string
  error?: string | null
  url?: string | null
  caption?: string
  [key: string]: unknown
}

const GIVE_UP_AFTER_MS = 30 * 60 * 1000

/** One publish record's status from its platforms' states. */
export function rollUpPublishStatus(statuses: string[], scheduled: boolean): 'failed' | 'partial' | 'publishing' | 'scheduled' | 'published' {
  if (!statuses.length || statuses.every(s => s === 'failed')) return 'failed'
  if (statuses.some(s => s === 'failed')) return 'partial'
  if (statuses.some(s => s === 'processing')) return 'publishing'
  if (scheduled || statuses.some(s => s === 'scheduled')) return 'scheduled'
  return 'published'
}

type Row = {
  id: string
  created_at: string
  published_at: string | null
  scheduled_at: string | null
  platform_posts: PostEntry[] | null
}

/** Re-checks every post that is still unresolved. Returns how many records changed. */
export async function reconcilePublishJobs(
  db: SupabaseClient,
  check: (id: string, platform: string) => Promise<PostCheck | null> = checkPostStatus,
  now = Date.now(),
): Promise<{ looked: number; updated: number }> {
  const since = new Date(now - 7 * 24 * 3600 * 1000).toISOString()
  const { data } = await db
    .from('publish_jobs')
    .select('id, created_at, published_at, scheduled_at, platform_posts')
    .in('status', ['publishing', 'partial', 'scheduled', 'published'])
    .gt('created_at', since)
  let looked = 0
  let updated = 0

  for (const row of (data ?? []) as Row[]) {
    const posts = row.platform_posts ?? []
    const dueScheduled = !!row.scheduled_at && new Date(row.scheduled_at).getTime() < now - 2 * 60 * 1000
    const needs = (p: PostEntry) => !!p.postId && (p.status === 'processing' || (p.status === 'scheduled' && dueScheduled))
    if (!posts.some(needs)) continue

    let changed = false
    const next: PostEntry[] = []
    for (const p of posts) {
      if (!needs(p)) { next.push(p); continue }
      looked++
      const r = await check(p.postId!, p.platform)
      if (r?.status === 'published') {
        next.push({ ...p, status: 'published', error: null, ...(r.url ? { url: r.url } : {}) }); changed = true
      } else if (r?.status === 'failed') {
        next.push({ ...p, status: 'failed', error: r.error ?? 'Blotato reported a failure.', url: null }); changed = true
      } else if (p.status === 'processing' && now - new Date(row.published_at ?? row.created_at).getTime() > GIVE_UP_AFTER_MS) {
        // Blotato answers "in-progress" for ids it does not know too, so waiting
        // forever would leave a spinner for a post that never existed.
        next.push({
          ...p,
          status: 'failed',
          error: 'Blotato has not confirmed this post after 30 minutes. Check my.blotato.com before publishing it again, so it does not post twice.',
        }); changed = true
      } else {
        next.push(p) // still going (or could not ask): look again next time
      }
    }
    if (!changed) continue
    const status = rollUpPublishStatus(next.map(p => p.status), !!row.scheduled_at && !dueScheduled)
    const { error } = await db.from('publish_jobs').update({ platform_posts: next, status }).eq('id', row.id)
    if (!error) updated++
  }
  return { looked, updated }
}
