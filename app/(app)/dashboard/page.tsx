import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { TourModal } from '@/components/tour-modal'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [ideasRes, pendingRes, approvedRes, brandRes] = await Promise.all([
    supabase.from('ideas').select('id', { count: 'exact', head: true }),
    supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('brand_settings').select('creator_name').single(),
  ])

  const totalIdeas = ideasRes.count ?? 0
  const pendingReview = pendingRes.count ?? 0
  const totalApproved = approvedRes.count ?? 0
  const brandName = brandRes.data?.creator_name ?? null
  const hasSettings = !!(brandName && brandName.trim().length > 0)

  const { data: recentScripts } = await supabase
    .from('scripts')
    .select(`id, hook, status, mood_tag, created_at, idea:ideas(confirmed_lane, raw_idea)`)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(4)

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

  // Steps for getting started — guide stays until ALL 3 are done
  const step1Done = hasSettings
  const step2Done = totalIdeas > 0
  const step3Done = totalApproved > 0
  const showGettingStarted = !step1Done || !step2Done || !step3Done

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl w-full mx-auto space-y-4 sm:space-y-5">
      <TourModal />

      {/* ── Hero banner ── */}
      <div className="animate-fadeInUp" style={{ animationDelay: '0ms' }}>
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0D0D0D 0%, #1C0A00 60%, #0D0D0D 100%)' }}
      >
        {/* Glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: -80, left: -40,
            width: 360, height: 360,
            background: 'radial-gradient(circle, rgba(255,79,23,0.15) 0%, transparent 70%)',
          }}
        />
        {/* Film-strip sprockets */}
        <div className="absolute right-0 top-0 bottom-0 w-8 flex flex-col justify-around items-center py-4 pointer-events-none opacity-20">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ width: 14, height: 10, background: 'rgba(255,255,255,0.6)', borderRadius: 2, flexShrink: 0 }} />
          ))}
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)' }}
            >
              <svg width="13" height="12" viewBox="0 0 18 16" fill="none">
                <path d="M9 1 L17 15 L1 15 Z" fill="white" />
                <path d="M9 1 L13.5 9 L4.5 9 Z" fill="white" fillOpacity="0.25" />
              </svg>
            </div>
            <span className="text-white/50 text-xs font-semibold tracking-widest uppercase">Olympus</span>
          </div>

          <p className="text-white/40 text-sm mb-0.5">Good to see you,</p>
          <h1
            className="text-white font-extrabold mb-5"
            style={{ fontSize: 26, fontFamily: 'var(--font-jakarta)', letterSpacing: '-0.5px' }}
          >
            {hasSettings ? brandName : 'Creator'}
          </h1>

          {/* Inline stats */}
          <div className="flex items-center gap-6">
            {[
              { value: totalIdeas, label: 'Ideas generated' },
              { value: pendingReview, label: 'Awaiting review' },
              { value: totalApproved, label: 'Approved' },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-white font-bold text-xl" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  {s.value}
                </p>
                <p className="text-white/40 text-xs">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* ── Getting started (until all 3 steps done) ── */}
      {showGettingStarted && (
        <div className="animate-fadeInUp" style={{ animationDelay: '80ms' }}>
        <div className="bg-white border border-[#E4E4E0] rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-[#F0F0EE]">
            <h2 className="font-bold text-[#18181B] text-base" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Getting started
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">Complete these steps to activate your script engine.</p>
          </div>
          <div className="divide-y divide-[#F0F0EE]">
            {/* Step 1 */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-4">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: step1Done ? '#DCFCE7' : '#FF4F17', color: step1Done ? '#16A34A' : 'white' }}
              >
                {step1Done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : '1'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: step1Done ? '#A1A1AA' : '#18181B', textDecoration: step1Done ? 'line-through' : 'none' }}>Set up your brand voice</p>
                <p className="text-xs text-[#A1A1AA]">Add your identity, tone, and audience transformation</p>
              </div>
              {!step1Done && (
                <Link
                  href="/settings"
                  className="flex-shrink-0 px-4 py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
                  style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.3)' }}
                >
                  Set up →
                </Link>
              )}
            </div>
            {/* Step 2 */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-4" style={{ opacity: step1Done ? 1 : 0.4 }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: step2Done ? '#DCFCE7' : '#F4F3F0', color: step2Done ? '#16A34A' : '#A1A1AA' }}
              >
                {step2Done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : '2'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: step2Done ? '#A1A1AA' : '#18181B', textDecoration: step2Done ? 'line-through' : 'none' }}>Create your first idea</p>
                <p className="text-xs text-[#A1A1AA]">Type anything — AI picks the audience and writes the script</p>
              </div>
              {step1Done && !step2Done && (
                <Link
                  href="/ideas/new"
                  className="flex-shrink-0 px-4 py-1.5 rounded-xl text-xs font-semibold text-white transition-all"
                  style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.3)' }}
                >
                  Create →
                </Link>
              )}
            </div>
            {/* Step 3 */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-4" style={{ opacity: step2Done ? 1 : 0.4 }}>
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: step3Done ? '#DCFCE7' : '#F4F3F0', color: step3Done ? '#16A34A' : '#A1A1AA' }}
              >
                {step3Done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : '3'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: step3Done ? '#A1A1AA' : '#18181B', textDecoration: step3Done ? 'line-through' : 'none' }}>Review & approve your first script</p>
                <p className="text-xs text-[#A1A1AA]">Read, edit if needed, approve — it trains your voice forever</p>
              </div>
              {step2Done && pendingReview > 0 && (
                <Link
                  href="/review"
                  className="flex-shrink-0 px-4 py-1.5 rounded-xl text-xs font-semibold border border-[#E4E4E0] text-[#71717A] hover:bg-[#F4F3F0] transition-all"
                >
                  Review →
                </Link>
              )}
            </div>
          </div>
        </div>
        </div>
      )}


      {/* ── New idea CTA ── */}
      {step1Done ? (
        <Link
          href="/ideas/new"
          className="animate-fadeInUp flex items-center gap-4 rounded-2xl p-5 hover:opacity-90 active:scale-[0.99] transition-all duration-150 group hover-lift"
          style={{ background: '#FF4F17', boxShadow: '0 8px 24px rgba(255,79,23,0.25)', animationDelay: '160ms' }}
        >
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-base text-white" style={{ fontFamily: 'var(--font-jakarta)' }}>
              New content idea
            </p>
            <p className="text-white/70 text-sm mt-0.5">Type anything — AI picks the audience and writes the script</p>
          </div>
          <svg className="ml-auto flex-shrink-0 opacity-70 group-hover:translate-x-1 transition-transform" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </Link>
      ) : (
        <div
          className="flex items-center gap-4 rounded-2xl p-5"
          style={{ background: '#F4F3F0', border: '1.5px dashed #D4D4D0' }}
        >
          <div className="w-10 h-10 rounded-xl bg-[#E8E8E4] flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-base text-[#A1A1AA]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              New content idea
            </p>
            <p className="text-[#C4C4C0] text-sm mt-0.5">
              Complete your brand voice setup first →{' '}
              <Link href="/settings" className="underline text-[#FF4F17]">Settings</Link>
            </p>
          </div>
        </div>
      )}

      {/* ── Pending review ── */}
      {recentScripts && recentScripts.length > 0 && (
        <div className="animate-fadeInUp" style={{ animationDelay: '240ms' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Ready to review
              {pendingReview > 0 && (
                <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#FF4F17' }}>
                  {pendingReview}
                </span>
              )}
            </h2>
            <Link href="/review" className="text-sm text-[#FF4F17] hover:underline font-medium">
              See all
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentScripts.map((script, i) => {
              const idea = Array.isArray(script.idea) ? script.idea[0] : script.idea
              const lane = idea?.confirmed_lane as string | undefined
              const colors = lane ? LANE_COLOR[lane] : { bg: '#F4F3F0', text: '#71717A' }
              return (
                <Link
                  key={script.id}
                  href={`/review/${script.id}`}
                  className="animate-fadeInUp flex items-start gap-4 bg-white border border-[#E4E4E0] rounded-2xl p-4 hover:border-[#FF4F17] hover:shadow-sm transition-all duration-150 group hover-lift"
                  style={{ animationDelay: `${280 + i * 50}ms` }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#18181B] line-clamp-2 leading-relaxed">
                      &ldquo;{script.hook}&rdquo;
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {lane && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: colors.bg, color: colors.text }}>
                          {LANE_LABEL[lane] ?? lane}
                        </span>
                      )}
                      {script.mood_tag && <span className="text-xs text-[#A1A1AA]">{script.mood_tag}</span>}
                    </div>
                  </div>
                  <svg className="flex-shrink-0 text-[#A1A1AA] group-hover:text-[#FF4F17] group-hover:translate-x-0.5 transition-all mt-1" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Upcoming features ── */}
      <div className="animate-fadeInUp" style={{ animationDelay: '320ms' }}>
        <p className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-3">What's coming next</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Video editing */}
          <Link
            href="/edit"
            className="bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#6366F1] hover:shadow-sm transition-all duration-150 group hover-lift"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#EEF2FF' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3L14.5 4z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-[#18181B] mb-1" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  Video Editing
                </p>
                <ul className="space-y-0.5">
                  {['AI-assisted cuts & pacing', 'Auto-captions & subtitles', 'B-roll & music suggestions', 'One-click export'].map((f) => (
                    <li key={f} className="text-xs text-[#71717A] flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#C4C4C0] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#6366F1] group-hover:gap-2.5 transition-all">
              Coming soon
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>

          {/* Publishing */}
          <Link
            href="/publish"
            className="bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#FF4F17] hover:shadow-sm transition-all duration-150 group hover-lift"
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FFF3EF' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2L15 22 11 13 2 9l20-7z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-bold text-sm text-[#18181B] mb-2" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  Multi-Platform Publishing
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.5" cy="6.5" r="1.5" fill="white" stroke="none" />
                    </svg>
                  </div>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#010101' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.27 8.27 0 0 0 4.84 1.55V6.79a4.85 4.85 0 0 1-1.07-.1z" />
                    </svg>
                  </div>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#FF0000' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                      <path d="M10 15l5.19-3L10 9v6z" />
                      <path d="M21.56 7.17a2.76 2.76 0 0 0-1.94-1.95C17.88 4.78 12 4.78 12 4.78s-5.88 0-7.62.44A2.76 2.76 0 0 0 2.44 7.17C2 8.91 2 12 2 12s0 3.09.44 4.83a2.76 2.76 0 0 0 1.94 1.95C6.12 19.22 12 19.22 12 19.22s5.88 0 7.62-.44a2.76 2.76 0 0 0 1.94-1.95C22 15.09 22 12 22 12s0-3.09-.44-4.83z" />
                    </svg>
                  </div>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#0077B5' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                      <rect x="2" y="9" width="4" height="12" />
                      <circle cx="4" cy="4" r="2" />
                    </svg>
                  </div>
                </div>
                <ul className="space-y-0.5">
                  {['Schedule across all platforms', 'Publish with one click', 'Analytics per platform'].map((f) => (
                    <li key={f} className="text-xs text-[#71717A] flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#C4C4C0] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#FF4F17] group-hover:gap-2.5 transition-all">
              Coming soon
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>
        </div>
      </div>

      {/* Empty state */}
      {hasSettings && totalIdeas === 0 && (recentScripts?.length ?? 0) === 0 && (
        <div className="text-center py-10 bg-white border border-dashed border-[#E4E4E0] rounded-2xl">
          <div className="w-12 h-12 rounded-2xl bg-[#FFF3EF] flex items-center justify-center mx-auto mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
          <p className="font-medium text-[#18181B] mb-1">No ideas yet</p>
          <p className="text-sm text-[#A1A1AA]">Tap "New content idea" above to generate your first script.</p>
        </div>
      )}

    </div>
  )
}
