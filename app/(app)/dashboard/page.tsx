import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { TourModal } from '@/components/tour-modal'
import { TourTriggerButton } from '@/components/tour-trigger-button'
import { DashboardBg } from '@/components/dashboard-bg'
import { CountUp } from '@/components/count-up'
import { PipelineFlow } from '@/components/pipeline-flow'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Active profile first — every query below is scoped to its slot so
  // switching profiles swaps the entire workspace.
  const { data: activeBrand } = await supabase
    .from('brand_settings')
    .select('creator_name, profile_slot')
    .eq('is_active', true)
    .maybeSingle()
  const slot = activeBrand?.profile_slot ?? 1

  const [ideasRes, pendingRes, approvedRes, publishedCountRes] = await Promise.all([
    supabase.from('ideas').select('id', { count: 'exact', head: true }).eq('profile_slot', slot),
    supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('status', 'pending_review').eq('profile_slot', slot),
    supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('status', 'approved').eq('profile_slot', slot),
    supabase.from('publish_jobs').select('id', { count: 'exact', head: true }).in('status', ['published', 'partial', 'scheduled']).eq('profile_slot', slot),
  ])

  const totalIdeas = ideasRes.count ?? 0
  const pendingReview = pendingRes.count ?? 0
  const totalApproved = approvedRes.count ?? 0
  const totalPublished = publishedCountRes.count ?? 0
  const brandName = activeBrand?.creator_name ?? null
  const hasSettings = !!(brandName && brandName.trim().length > 0)

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Burning the midnight oil,' : hour < 12 ? 'Good morning,' : hour < 18 ? 'Good afternoon,' : 'Good evening,'

  const ACTIVITY_TTL_DAYS = 7
  const ttlCutoff = new Date(Date.now() - ACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // "Up next" intelligence: read the pipeline and surface the single best move.
  const [readyJobsRes, jobsScriptIdsRes, weekApprovedRes, weekPublishedRes] = await Promise.all([
    supabase.from('video_jobs').select('id', { count: 'exact', head: true }).eq('status', 'complete').is('selected_variant', null).eq('profile_slot', slot),
    supabase.from('video_jobs').select('script_id').eq('profile_slot', slot),
    supabase.from('scripts').select('id', { count: 'exact', head: true }).eq('status', 'approved').gte('approved_at', ttlCutoff).eq('profile_slot', slot),
    supabase.from('publish_jobs').select('id', { count: 'exact', head: true }).in('status', ['published', 'partial', 'scheduled']).gte('created_at', ttlCutoff).eq('profile_slot', slot),
  ])
  const variantsReady = readyJobsRes.count ?? 0
  const scriptIdsWithFootage = new Set((jobsScriptIdsRes.data ?? []).map(j => j.script_id))
  const weekApproved = weekApprovedRes.count ?? 0
  const weekPublished = weekPublishedRes.count ?? 0

  const { data: approvedIds } = await supabase.from('scripts').select('id').eq('status', 'approved').eq('profile_slot', slot)
  const approvedNoFootage = (approvedIds ?? []).filter(s => !scriptIdsWithFootage.has(s.id)).length

  type NextAction = { label: string; sublabel: string; href: string; color: string; bg: string }
  const nextAction: NextAction | null = !hasSettings
    ? null // getting-started card already handles this state
    : pendingReview > 0
    ? { label: `Review ${pendingReview} waiting script${pendingReview === 1 ? '' : 's'}`, sublabel: 'Approving trains your voice — every approval makes the next script better.', href: '/review', color: '#6366F1', bg: '#EEF2FF' }
    : variantsReady > 0
    ? { label: `Pick a winner — ${variantsReady} video${variantsReady === 1 ? ' has' : 's have'} variants ready`, sublabel: 'Choose the best edit and send it to Publish.', href: '/library', color: '#FF4F17', bg: '#FFF3EF' }
    : approvedNoFootage > 0
    ? { label: `${approvedNoFootage} approved script${approvedNoFootage === 1 ? '' : 's'} need${approvedNoFootage === 1 ? 's' : ''} footage`, sublabel: 'Film the script, upload to Drive, and the studio edits it for you.', href: '/library', color: '#F59E0B', bg: '#FEF3C7' }
    : { label: 'Generate fresh ideas', sublabel: 'The pipeline is clear — feed it 10 new AI ideas from your brand.', href: '/ideas/new', color: '#16A34A', bg: '#DCFCE7' }

  const { data: recentScripts } = await supabase
    .from('scripts')
    .select(`id, hook, status, mood_tag, created_at, idea:ideas(confirmed_lane, raw_idea)`)
    .eq('status', 'pending_review')
    .eq('profile_slot', slot)
    .order('created_at', { ascending: false })
    .limit(4)

  // Recent activity: approved scripts + recent publish jobs, both within TTL window
  const [approvedRes2, publishedRes] = await Promise.all([
    supabase
      .from('scripts')
      .select('id, hook, mood_tag, approved_at')
      .eq('status', 'approved')
      .eq('profile_slot', slot)
      .gte('approved_at', ttlCutoff)
      .order('approved_at', { ascending: false })
      .limit(5),
    supabase
      .from('publish_jobs')
      .select('id, status, platform_posts, published_at, scheduled_at, created_at')
      .in('status', ['published', 'scheduled', 'partial'])
      .eq('profile_slot', slot)
      .gte('created_at', ttlCutoff)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  type ActivityItem =
    | { kind: 'approved'; id: string; hook: string; mood_tag: string | null; at: string }
    | { kind: 'published'; id: string; status: string; platforms: string[]; at: string }

  const activityItems: ActivityItem[] = [
    ...(approvedRes2.data ?? []).map(s => ({
      kind: 'approved' as const,
      id: s.id,
      hook: s.hook,
      mood_tag: s.mood_tag,
      at: s.approved_at as string,
    })),
    ...(publishedRes.data ?? []).map(j => ({
      kind: 'published' as const,
      id: j.id,
      status: j.status,
      platforms: ((j.platform_posts ?? []) as { platform: string; status: string }[])
        .filter(p => p.status === 'published' || p.status === 'scheduled')
        .map(p => p.platform),
      at: (j.published_at ?? j.scheduled_at ?? j.created_at) as string,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 6)

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

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
    const days = Math.floor(hrs / 24)
    return days === 1 ? 'yesterday' : `${days} days ago`
  }

  const PLATFORM_META: Record<string, { label: string; bg: string }> = {
    instagram: { label: 'IG', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
    facebook:  { label: 'FB', bg: '#1877F2' },
    tiktok:    { label: 'TT', bg: '#010101' },
    youtube:   { label: 'YT', bg: '#FF0000' },
  }

  // Steps for getting started   guide stays until ALL 3 are done
  const step1Done = hasSettings
  const step2Done = totalIdeas > 0
  const step3Done = totalApproved > 0
  const showGettingStarted = !step1Done || !step2Done || !step3Done

  return (
    <div className="relative flex-1">
      <DashboardBg />
      <div className="relative z-10 p-4 sm:p-6 md:p-8 max-w-3xl w-full mx-auto space-y-4 sm:space-y-5">
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

          <p className="text-white/40 text-sm mb-0.5">{greeting}</p>
          <div className="flex items-center justify-between gap-3 mb-5">
            <h1
              className="font-extrabold"
              style={{
                fontSize: 26,
                fontFamily: 'var(--font-jakarta)',
                letterSpacing: '-0.5px',
                background: 'linear-gradient(100deg, #FFFFFF 30%, #FFB599 55%, #FFFFFF 80%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {hasSettings ? brandName : 'Creator'}
            </h1>
            <TourTriggerButton />
          </div>

          {/* Inline stats — count up on load */}
          <div className="flex items-center gap-6">
            {[
              { value: totalIdeas, label: 'Ideas generated' },
              { value: pendingReview, label: 'Awaiting review' },
              { value: totalApproved, label: 'Approved' },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-white font-bold text-xl" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  <CountUp value={s.value} />
                </p>
                <p className="text-white/40 text-xs">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Weekly momentum */}
          {(weekApproved > 0 || weekPublished > 0) && (
            <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-white/10">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              <p className="text-xs text-white/50">
                This week:{' '}
                {weekApproved > 0 && <span className="text-white/80 font-medium">{weekApproved} approved</span>}
                {weekApproved > 0 && weekPublished > 0 && ' · '}
                {weekPublished > 0 && <span className="text-white/80 font-medium">{weekPublished} published</span>}
              </p>
            </div>
          )}
        </div>
      </div>
      </div>

      {/* ── Up next — the single best move right now ── */}
      {nextAction && (
        <div className="animate-fadeInUp" style={{ animationDelay: '40ms' }}>
          <Link
            href={nextAction.href}
            className="flex items-center gap-4 bg-white border border-[#E4E4E0] rounded-2xl p-4 sm:p-5 hover:shadow-md transition-all duration-150 group hover-lift"
            style={{ borderLeft: `3px solid ${nextAction.color}` }}
          >
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: nextAction.bg }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={nextAction.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: nextAction.color }}>Up next</p>
              <p className="text-sm font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>{nextAction.label}</p>
              <p className="text-xs text-[#A1A1AA] mt-0.5 hidden sm:block">{nextAction.sublabel}</p>
            </div>
            <svg className="flex-shrink-0 text-[#A1A1AA] group-hover:translate-x-1 transition-transform" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: nextAction.color }}>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>
      )}

      {/* ── Pipeline — the system at a glance ── */}
      <div className="animate-fadeInUp" style={{ animationDelay: '60ms' }}>
        <PipelineFlow
          ideas={totalIdeas}
          pending={pendingReview}
          approved={totalApproved}
          published={totalPublished}
        />
      </div>

      {/* ── Getting started (until all 3 steps done) ── */}
      {showGettingStarted && (
        <div className="animate-fadeInUp" style={{ animationDelay: '80ms' }}>
        <div className="bg-white border border-[#E4E4E0] rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-4 border-b border-[#F0F0EE]">
            <h2 className="font-bold text-[#18181B] text-base" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Getting started
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-0.5">Complete these steps to activate your creator mode.</p>
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
                <p className="text-xs text-[#A1A1AA]">Type anything   AI picks the audience and writes the script</p>
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
                <p className="text-xs text-[#A1A1AA]">Read, edit if needed, approve   it trains your voice forever</p>
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
          className="animate-fadeInUp shine-sweep flex items-center gap-4 rounded-2xl p-5 active:scale-[0.99] transition-all duration-150 group hover-lift"
          style={{ background: 'linear-gradient(120deg, #FF5C26 0%, #FF4F17 45%, #F03D05 100%)', boxShadow: '0 8px 24px rgba(255,79,23,0.25)', animationDelay: '160ms' }}
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
            <p className="text-white/70 text-sm mt-0.5">Type anything   AI picks the audience and writes the script</p>
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

      {/* ── Recent activity ── */}
      {activityItems.length > 0 && (
        <div className="animate-fadeInUp" style={{ animationDelay: '290ms' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Recent activity
            </h2>
            <span className="text-[11px] text-[#A1A1AA] font-medium">Last 7 days</span>
          </div>
          <div className="bg-white border border-[#E4E4E0] rounded-2xl divide-y divide-[#F0F0EE] overflow-hidden">
            {activityItems.map((item) => (
              item.kind === 'approved' ? (
                <a key={item.id} href={`/edit/${item.id}`} className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-[#FAFAF9] transition-colors group">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#DCFCE7' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#18181B] line-clamp-1 font-medium">&ldquo;{item.hook}&rdquo;</p>
                    <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                      Script approved{item.mood_tag ? ` · ${item.mood_tag}` : ''} · {relativeTime(item.at)}
                    </p>
                  </div>
                  <svg className="flex-shrink-0 text-[#D4D4D0] group-hover:text-[#FF4F17] transition-colors" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </a>
              ) : (
                <div key={item.id} className="flex items-center gap-3.5 px-4 py-3.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: item.status === 'scheduled' ? '#EFF6FF' : '#FFF3EF' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={item.status === 'scheduled' ? '#2563EB' : '#FF4F17'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {item.status === 'scheduled'
                        ? <><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></>
                        : <><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></>
                      }
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {item.platforms.slice(0, 4).map(p => {
                        const meta = PLATFORM_META[p.toLowerCase()] ?? { label: p.slice(0,2).toUpperCase(), bg: '#A1A1AA' }
                        return (
                          <span key={p} className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded" style={{ background: meta.bg }}>
                            {meta.label}
                          </span>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-[#A1A1AA]">
                      {item.status === 'scheduled' ? 'Scheduled' : 'Published'} · {relativeTime(item.at)}
                    </p>
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* ── Feature shortcuts ── */}
      <div className="animate-fadeInUp" style={{ animationDelay: '320ms' }}>
        <p className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-3">Your full workflow</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Scripts hub */}
          <Link
            href="/library"
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
                  Scripts &amp; Studio
                </p>
                <ul className="space-y-0.5">
                  {['All approved scripts, organized by stage', 'Add footage — AI cuts, captions & music', 'Pick the best variant and publish'].map((f) => (
                    <li key={f} className="text-xs text-[#71717A] flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#C4C4C0] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#6366F1] group-hover:gap-2.5 transition-all">
              Open Scripts
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>

          {/* Publish */}
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
                  Publish
                </p>
                <div className="flex items-center gap-1.5 mb-2">
                  {[
                    { bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', label: 'IG' },
                    { bg: '#1877F2', label: 'FB' },
                    { bg: '#010101', label: 'TT' },
                    { bg: '#FF0000', label: 'YT' },
                  ].map(p => (
                    <span key={p.label} className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded-md" style={{ background: p.bg }}>
                      {p.label}
                    </span>
                  ))}
                </div>
                <ul className="space-y-0.5">
                  {['Pick your edited video from the library', 'AI writes platform-specific captions', 'Publish now or schedule for later'].map((f) => (
                    <li key={f} className="text-xs text-[#71717A] flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-[#C4C4C0] flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#FF4F17] group-hover:gap-2.5 transition-all">
              Open Publish
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
    </div>
  )
}
