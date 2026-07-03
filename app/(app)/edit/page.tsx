import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { CountUp } from '@/components/count-up'
import { EditScriptList } from '@/components/edit-script-list'

export default async function EditPage() {
  const supabase = await createClient()

  const { data: scripts } = await supabase
    .from('scripts')
    .select('id, hook, mood_tag, approved_at')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })

  const jobsByScript: Record<string, { id: string; status: string; selected_variant: string | null }> = {}
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
          Add footage to your approved scripts and generate edited variants per video.
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
          <div key={s.label} className="bg-white border border-[#E4E4E0] rounded-2xl p-4 hover-lift">
            <p className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              <CountUp value={s.value} />
            </p>
            <p className="text-xs text-[#A1A1AA] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Script list — filterable by stage, paged so it never scrolls forever */}
      {scripts && scripts.length > 0 ? (
        <div className="animate-fadeInUp" style={{ animationDelay: '80ms' }}>
          <EditScriptList scripts={scripts} jobsByScript={jobsByScript} />
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
            className="shine-sweep inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold transition-all hover-lift"
            style={{ background: 'linear-gradient(120deg, #FF5C26 0%, #FF4F17 45%, #F03D05 100%)', boxShadow: '0 4px 14px rgba(255,79,23,0.25)' }}
          >
            Go to Review
          </Link>
        </div>
      )}
    </div>
  )
}
