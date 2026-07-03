import { createClient } from '@/lib/supabase/server'
import { getActiveSlot } from '@/lib/active-profile'
import Link from 'next/link'

const LANE_LABEL: Record<string, string> = {
  adhd_parents: 'ADHD Parents',
  sympathetic_overdrive: 'Sympathetic Overdrive',
  burnout_professionals: 'Burned-Out Pros',
}

const LANE_COLOR: Record<string, { bg: string; text: string }> = {
  adhd_parents: { bg: '#EEF2FF', text: '#6366F1' },
  sympathetic_overdrive: { bg: '#FFF3EF', text: '#FF4F17' },
  burnout_professionals: { bg: '#F4F3F0', text: '#71717A' },
}

const FORMAT_LABEL: Record<string, string> = {
  educational: 'Educational',
  tips_tricks: 'Tips',
  personal_story: 'Story',
  myth_busting: 'Myth bust',
  lead_magnet: 'Lead magnet',
}

function formatDate(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ScriptCard({
  script,
  delay,
  compact = false,
}: {
  script: any
  delay: number
  compact?: boolean
}) {
  const idea = Array.isArray(script.idea) ? script.idea[0] : script.idea
  const lane = idea?.confirmed_lane as string | undefined
  const laneColors = lane ? LANE_COLOR[lane] : { bg: '#F4F3F0', text: '#71717A' }
  const format = (script.filming_plan as any)?.script_format as string | undefined

  if (compact) {
    return (
      <Link
        href={`/review/${script.id}`}
        className="animate-fadeInUp flex items-center gap-3 bg-white border border-[#E4E4E0] rounded-xl px-4 py-3 hover:border-[#22C55E] transition-all group hover-lift"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="w-2 h-2 rounded-full bg-[#22C55E] flex-shrink-0" />
        <p className="flex-1 text-sm text-[#18181B] truncate">"{script.hook}"</p>
        {lane && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: laneColors.bg, color: laneColors.text }}>
            {LANE_LABEL[lane]}
          </span>
        )}
        <svg className="flex-shrink-0 text-[#C4C0BB] group-hover:text-[#22C55E] transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>
    )
  }

  return (
    <Link
      href={`/review/${script.id}`}
      className="animate-fadeInUp flex items-start gap-4 bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#FF4F17] hover:shadow-sm transition-all duration-150 group hover-lift"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex-1 min-w-0">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          {lane && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: laneColors.bg, color: laneColors.text }}>
              {LANE_LABEL[lane]}
            </span>
          )}
          {format && FORMAT_LABEL[format] && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[#F4F3F0] text-[#71717A]">
              {FORMAT_LABEL[format]}
            </span>
          )}
          {script.mood_tag && (
            <span className="text-xs text-[#A1A1AA]">{script.mood_tag}</span>
          )}
        </div>

        {/* Idea context */}
        {idea?.raw_idea && (
          <p className="text-xs text-[#A1A1AA] mb-1.5 truncate">Re: "{idea.raw_idea}"</p>
        )}

        {/* Hook */}
        <p className="text-sm font-medium text-[#18181B] line-clamp-2 leading-relaxed mb-2">
          "{script.hook}"
        </p>

        <p className="text-xs text-[#C4C0BB]">{formatDate(script.created_at)}</p>
      </div>

      <svg className="flex-shrink-0 text-[#A1A1AA] group-hover:text-[#FF4F17] group-hover:translate-x-0.5 transition-all mt-1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  )
}

function SectionHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-sm font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
        {label}
      </h2>
      <span
        className="text-xs font-bold px-2 py-0.5 rounded-full"
        style={{ background: color + '22', color }}
      >
        {count}
      </span>
    </div>
  )
}

export default async function ReviewPage() {
  const supabase = await createClient()
  const slot = await getActiveSlot(supabase)

  const { data: pending } = await supabase
    .from('scripts')
    .select('id, hook, status, mood_tag, created_at, filming_plan, idea:ideas(confirmed_lane, raw_idea)')
    .eq('status', 'pending_review')
    .eq('profile_slot', slot)
    .order('created_at', { ascending: false })

  const { data: needsRevision } = await supabase
    .from('scripts')
    .select('id, hook, status, mood_tag, created_at, filming_plan, idea:ideas(confirmed_lane, raw_idea)')
    .eq('status', 'needs_revision')
    .eq('profile_slot', slot)
    .order('created_at', { ascending: false })

  const { data: recentApproved } = await supabase
    .from('scripts')
    .select('id, hook, status, mood_tag, approved_at, created_at, idea:ideas(confirmed_lane)')
    .eq('status', 'approved')
    .eq('profile_slot', slot)
    .order('approved_at', { ascending: false })
    .limit(5)

  const pendingCount = pending?.length ?? 0
  const revisionCount = needsRevision?.length ?? 0
  const totalAction = pendingCount + revisionCount

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">

      {/* Header */}
      <div className="mb-6 animate-fadeInUp" style={{ animationDelay: '0ms' }}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
            Review queue
          </h1>
          {totalAction > 0 && (
            <span className="relative text-xs font-bold px-3 py-1.5 rounded-full bg-[#FFF3EF] text-[#FF4F17] flex items-center gap-1.5">
              <span className="relative flex w-1.5 h-1.5">
                <span className="pulse-ring absolute inline-flex h-full w-full rounded-full bg-[#FF4F17]" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#FF4F17]" />
              </span>
              {totalAction} need{totalAction === 1 ? 's' : ''} attention
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[#71717A]">
          Approve, revise, or reject generated scripts.
        </p>
      </div>

      {/* All clear */}
      {totalAction === 0 && (
        <div className="animate-fadeInUp text-center py-14 bg-white border border-[#E4E4E0] border-dashed rounded-2xl mb-8" style={{ animationDelay: '60ms' }}>
          <div className="w-12 h-12 rounded-2xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <p className="font-medium text-[#18181B] mb-1">All clear</p>
          <p className="text-sm text-[#A1A1AA]">No scripts waiting for review.</p>
        </div>
      )}

      {/* Needs review */}
      {pendingCount > 0 && (
        <div className="animate-fadeInUp mb-8" style={{ animationDelay: '60ms' }}>
          <SectionHeader label="Needs review" count={pendingCount} color="#D97706" />
          <div className="space-y-3">
            {pending!.map((script, i) => (
              <ScriptCard key={script.id} script={script} delay={80 + i * 50} />
            ))}
          </div>
        </div>
      )}

      {/* Needs revision */}
      {revisionCount > 0 && (
        <div className="animate-fadeInUp mb-8" style={{ animationDelay: `${80 + pendingCount * 50}ms` }}>
          <SectionHeader label="Revision requested" count={revisionCount} color="#6366F1" />
          <div className="space-y-3">
            {needsRevision!.map((script, i) => (
              <ScriptCard key={script.id} script={script} delay={100 + pendingCount * 50 + i * 50} />
            ))}
          </div>
        </div>
      )}

      {/* Recently approved */}
      {recentApproved && recentApproved.length > 0 && (
        <div className="animate-fadeInUp" style={{ animationDelay: `${120 + totalAction * 50}ms` }}>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-sm font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Recently approved
            </h2>
          </div>
          <div className="space-y-2">
            {recentApproved.map((script, i) => (
              <ScriptCard
                key={script.id}
                script={{ ...script, created_at: script.approved_at ?? script.created_at }}
                delay={140 + totalAction * 50 + i * 35}
                compact
              />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
