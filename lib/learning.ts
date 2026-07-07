import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceLane } from '@/lib/types'

export interface FewShotScript {
  hook: string
  body: string
  cta: string
}

export interface LearningContext {
  /** Approved scripts ranked by relevance to this generation (lane + format first). */
  fewShots: FewShotScript[]
  /** Recent revision feedback the creator gave — recurring dislikes to avoid. */
  lessons: string[]
  /** Recent hooks across all scripts — openings the new script must not repeat. */
  recentHooks: string[]
}

interface ScoredScript extends FewShotScript {
  score: number
}

/** Pull everything the engine has learned from past posts, ranked for THIS
 *  generation. Recency alone buries the creator's best-matching examples, so
 *  approved scripts are scored: same lane + same format beat lane-only, which
 *  beats format-only, which beats plain recency. Revision notes become explicit
 *  "don't do this again" lessons, and recent hooks become a no-repeat list. */
export async function getLearningContext(
  supabase: SupabaseClient,
  opts: { lane?: AudienceLane | null; scriptFormat?: string | null; profileSlot?: number } = {}
): Promise<LearningContext> {
  // Scope every learning signal to one profile — Profile 1's voice must never
  // bleed into Profile 2's scripts and vice versa.
  const slot = opts.profileSlot ?? 1

  const [approvedRes, revisedRes, hooksRes, publishedRes] = await Promise.all([
    supabase
      .from('scripts')
      .select('id, hook, body, cta, is_few_shot, filming_plan, idea:ideas(confirmed_lane)')
      .eq('status', 'approved')
      .eq('profile_slot', slot)
      .order('approved_at', { ascending: false })
      .limit(40),
    supabase
      .from('scripts')
      .select('revision_notes')
      .eq('profile_slot', slot)
      .not('revision_notes', 'is', null)
      .neq('revision_notes', '')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('scripts')
      .select('hook')
      .eq('profile_slot', slot)
      .in('status', ['approved', 'pending_review'])
      .order('created_at', { ascending: false })
      .limit(20),
    // Scripts that actually went OUT — the strongest signal there is. A
    // script the creator approved, rendered, AND published survived every
    // quality gate, so it outranks merely-approved examples.
    supabase
      .from('publish_jobs')
      .select('script_id')
      .in('status', ['published', 'partial', 'scheduled'])
      .eq('profile_slot', slot)
      .not('script_id', 'is', null)
      .limit(100),
  ])

  const publishedScriptIds = new Set(
    (publishedRes.data ?? []).map(r => r.script_id as string)
  )

  // ── Rank approved scripts by relevance ──────────────────────────────────
  const scored: ScoredScript[] = (approvedRes.data ?? []).map((s, i) => {
    const idea = Array.isArray(s.idea) ? s.idea[0] : s.idea
    const sameLane = !!opts.lane && idea?.confirmed_lane === opts.lane
    const format = (s.filming_plan as { script_format?: string } | null)?.script_format
    const sameFormat = !!opts.scriptFormat && format === opts.scriptFormat

    let score = 0
    if (sameLane && sameFormat) score += 6
    else if (sameLane) score += 4
    else if (sameFormat) score += 2
    // Published beats the manual few-shot flag: it's the realest endorsement.
    if (publishedScriptIds.has(s.id as string)) score += 3
    if (s.is_few_shot) score += 1
    // Recency tiebreak: earlier in the (already newest-first) list ranks higher
    score += (40 - i) / 100

    return { hook: s.hook, body: s.body, cta: s.cta, score }
  })

  const fewShots = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ hook, body, cta }) => ({ hook, body, cta }))

  // ── Distill revision feedback into distinct lessons ─────────────────────
  const seen = new Set<string>()
  const lessons: string[] = []
  for (const row of revisedRes.data ?? []) {
    const note = (row.revision_notes as string).trim()
    const key = note.toLowerCase().slice(0, 60)
    if (note && !seen.has(key)) {
      seen.add(key)
      lessons.push(note)
    }
    if (lessons.length >= 8) break
  }

  const recentHooks = (hooksRes.data ?? []).map(r => r.hook as string).filter(Boolean)

  return { fewShots, lessons, recentHooks }
}

/** Format the lessons + no-repeat sections for injection into a prompt.
 *  Returns '' when there is nothing learned yet. */
export function formatLearningSections(ctx: Pick<LearningContext, 'lessons' | 'recentHooks'>): string {
  const parts: string[] = []

  if (ctx.lessons.length > 0) {
    parts.push(`PAST FEEDBACK FROM THE CREATOR — LESSONS TO APPLY:
The creator asked for these changes on earlier scripts. Treat them as standing preferences — do not repeat the mistakes they describe:
${ctx.lessons.map(l => `• ${l}`).join('\n')}`)
  }

  if (ctx.recentHooks.length > 0) {
    parts.push(`RECENT HOOKS — DO NOT REPEAT:
These openings were already used. The new hook must take a clearly different angle and structure — not a rewording of any of these:
${ctx.recentHooks.map(h => `• ${h}`).join('\n')}`)
  }

  return parts.join('\n\n')
}
