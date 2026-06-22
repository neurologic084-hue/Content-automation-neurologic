import { createClient } from '@/lib/supabase/server'
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

const STATUS_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  pending_review: { bg: '#FEF3C7', text: '#D97706', dot: '#F59E0B' },
  needs_revision: { bg: '#EEF2FF', text: '#6366F1', dot: '#6366F1' },
  approved: { bg: '#DCFCE7', text: '#16A34A', dot: '#22C55E' },
  rejected: { bg: '#FEE2E2', text: '#DC2626', dot: '#EF4444' },
}

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Needs review',
  needs_revision: 'Revision requested',
  approved: 'Approved',
  rejected: 'Rejected',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default async function ReviewPage() {
  const supabase = await createClient()

  const { data: scripts } = await supabase
    .from('scripts')
    .select(`
      id, hook, status, mood_tag, created_at,
      idea:ideas(confirmed_lane, raw_idea)
    `)
    .in('status', ['pending_review', 'needs_revision'])
    .order('created_at', { ascending: false })

  const { data: recentApproved } = await supabase
    .from('scripts')
    .select(`
      id, hook, status, mood_tag, approved_at,
      idea:ideas(confirmed_lane)
    `)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(5)

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">
      <div className="mb-6 sm:mb-8 animate-fadeInUp" style={{ animationDelay: '0ms' }}>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
          Review queue
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          Approve, revise, or reject generated scripts.
        </p>
      </div>

      {/* Pending scripts */}
      {scripts && scripts.length > 0 ? (
        <div className="space-y-3 mb-10">
          {scripts.map((script, i) => {
            const idea = Array.isArray(script.idea) ? script.idea[0] : script.idea
            const lane = idea?.confirmed_lane as string | undefined
            const laneColors = lane ? LANE_COLOR[lane] : { bg: '#F4F3F0', text: '#71717A' }
            const statusColors = STATUS_COLOR[script.status] ?? STATUS_COLOR.pending_review

            return (
              <Link
                key={script.id}
                href={`/review/${script.id}`}
                className="animate-fadeInUp flex items-start gap-4 bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#FF4F17] hover:shadow-sm transition-all duration-150 group hover-lift"
                style={{ animationDelay: `${60 + i * 55}ms` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                      style={{ background: statusColors.bg, color: statusColors.text }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: statusColors.dot }}
                      />
                      {STATUS_LABEL[script.status]}
                    </span>
                    {lane && (
                      <span
                        className="text-xs font-medium px-2.5 py-1 rounded-full"
                        style={{ background: laneColors.bg, color: laneColors.text }}
                      >
                        {LANE_LABEL[lane]}
                      </span>
                    )}
                  </div>

                  <p className="text-sm font-medium text-[#18181B] line-clamp-2 leading-relaxed mb-1">
                    "{script.hook}"
                  </p>

                  <div className="flex items-center gap-3 text-xs text-[#A1A1AA]">
                    {script.mood_tag && <span>{script.mood_tag}</span>}
                    <span>{formatDate(script.created_at)}</span>
                  </div>
                </div>

                <svg className="flex-shrink-0 text-[#A1A1AA] group-hover:text-[#FF4F17] group-hover:translate-x-0.5 transition-all mt-1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-14 bg-white border border-[#E4E4E0] border-dashed rounded-2xl mb-10">
          <div className="w-12 h-12 rounded-2xl bg-[#DCFCE7] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <p className="font-medium text-[#18181B] mb-1">All clear</p>
          <p className="text-sm text-[#A1A1AA]">No scripts waiting for review.</p>
        </div>
      )}

      {/* Recently approved */}
      {recentApproved && recentApproved.length > 0 && (
        <div className="animate-fadeInUp" style={{ animationDelay: '220ms' }}>
          <h2 className="font-semibold text-[#18181B] mb-4" style={{ fontFamily: 'var(--font-jakarta)' }}>
            Recently approved
          </h2>
          <div className="space-y-2">
            {recentApproved.map((script, i) => {
              const idea = Array.isArray(script.idea) ? script.idea[0] : script.idea
              const lane = idea?.confirmed_lane as string | undefined
              const laneColors = lane ? LANE_COLOR[lane] : { bg: '#F4F3F0', text: '#71717A' }

              return (
                <Link
                  key={script.id}
                  href={`/review/${script.id}`}
                  className="animate-fadeInUp flex items-center gap-3 bg-white border border-[#E4E4E0] rounded-xl px-4 py-3 hover:border-[#22C55E] transition-all duration-150 group hover-lift"
                  style={{ animationDelay: `${260 + i * 40}ms` }}
                >
                  <div className="w-2 h-2 rounded-full bg-[#22C55E] flex-shrink-0" />
                  <p className="flex-1 text-sm text-[#18181B] truncate">"{script.hook}"</p>
                  {lane && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ background: laneColors.bg, color: laneColors.text }}
                    >
                      {LANE_LABEL[lane]}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
