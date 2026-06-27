import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const MOOD_COLOR: Record<string, string> = {
  calm: '#6366F1',
  energetic: '#FF4F17',
  empathetic: '#EC4899',
  educational: '#0EA5E9',
  bold: '#EF4444',
  'story-driven': '#F59E0B',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function EditPage() {
  const supabase = await createClient()

  const { data: scripts } = await supabase
    .from('scripts')
    .select('id, hook, mood_tag, approved_at')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })

  let jobsByScript: Record<string, { id: string; status: string; selected_variant: string | null }> = {}
  const { data: jobs } = await supabase
    .from('video_jobs')
    .select('id, script_id, status, selected_variant')
  if (jobs) {
    for (const j of jobs) jobsByScript[j.script_id] = j
  }

  const total = scripts?.length ?? 0
  const withFootage = Object.keys(jobsByScript).length
  const complete = Object.values(jobsByScript).filter(j => j.status === 'complete').length
  const selected = Object.values(jobsByScript).filter(j => j.selected_variant).length

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl w-full mx-auto">

      {/* Header */}
      <div className="mb-6 animate-fadeInUp" style={{ animationDelay: '0ms' }}>
        <div className="flex items-center gap-2.5 mb-1">
          <h1
            className="text-2xl font-bold text-[#18181B]"
            style={{ fontFamily: 'var(--font-jakarta)' }}
          >
            Video Studio
          </h1>
          <span
            className="text-[10px] font-bold px-2.5 py-1 rounded-full tracking-widest uppercase"
            style={{ background: '#EEF2FF', color: '#6366F1' }}
          >
            Phase 2
          </span>
        </div>
        <p className="text-sm text-[#71717A]">
          Add footage to your approved scripts and generate 3 edited variants per video.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 animate-fadeInUp" style={{ animationDelay: '40ms' }}>
        {[
          { label: 'Approved scripts', value: total },
          { label: 'With footage', value: withFootage },
          { label: 'Variants ready', value: complete },
          { label: 'Variant selected', value: selected },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#E4E4E0] rounded-2xl p-4">
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              {s.value}
            </p>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Script list */}
      {scripts && scripts.length > 0 ? (
        <div className="space-y-3">
          {scripts.map((script, i) => {
            const job = jobsByScript[script.id]
            const moodColor = script.mood_tag ? MOOD_COLOR[script.mood_tag] : '#A1A1AA'

            let statusBadge = { label: 'No footage', bg: '#F4F3F0', color: '#A1A1AA' }
            if (job?.selected_variant) {
              statusBadge = { label: 'Variant selected', bg: '#DCFCE7', color: '#16A34A' }
            } else if (job?.status === 'complete') {
              statusBadge = { label: '3 variants ready', bg: '#FFF3EF', color: '#FF4F17' }
            } else if (job?.status === 'processing') {
              statusBadge = { label: 'Processing...', bg: '#FEF3C7', color: '#D97706' }
            }

            return (
              <div
                key={script.id}
                className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#D0CCC8] hover:shadow-sm transition-all duration-150 hover-lift"
                style={{ animationDelay: `${80 + i * 40}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                        style={{ background: statusBadge.bg, color: statusBadge.color }}
                      >
                        {statusBadge.label}
                      </span>
                      {script.mood_tag && (
                        <span
                          className="text-[11px] px-2.5 py-1 rounded-full"
                          style={{ background: `${moodColor}15`, color: moodColor }}
                        >
                          {script.mood_tag}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-[#18181B] leading-snug mb-1">
                      &ldquo;{script.hook}&rdquo;
                    </p>
                    {script.approved_at && (
                      <p className="text-xs text-[#A1A1AA]">Approved {formatDate(script.approved_at)}</p>
                    )}
                  </div>

                  <Link
                    href={`/edit/${script.id}`}
                    className="flex-shrink-0 h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center"
                    style={{
                      background: job?.selected_variant ? '#DCFCE7' : job ? '#FFF3EF' : '#F4F3F0',
                      color: job?.selected_variant ? '#15803D' : job ? '#FF4F17' : '#71717A',
                    }}
                  >
                    {job?.selected_variant ? 'View' : job ? 'View variants' : 'Add footage'}
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div
          className="text-center py-16 bg-white border border-[#E4E4E0] border-dashed rounded-2xl animate-fadeInUp"
          style={{ animationDelay: '80ms' }}
        >
          <div className="w-12 h-12 rounded-2xl bg-[#F4F3F0] flex items-center justify-center mx-auto mb-3">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.87v6.26a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
            </svg>
          </div>
          <p className="font-medium text-[#18181B] mb-1">No approved scripts yet</p>
          <p className="text-sm text-[#A1A1AA] mb-4">Approve scripts in Review before adding footage.</p>
          <Link
            href="/review"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF4F17] text-white text-sm font-semibold hover:bg-[#E84410] transition-all"
          >
            Go to Review
          </Link>
        </div>
      )}
    </div>
  )
}
