'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { BlatoAccount } from '@/lib/blotato'
import type { VideoVariant } from '@/lib/video-pipeline'

// ── Platform config ───────────────────────────────────────────────────────────

const PLATFORMS: Record<string, {
  label: string
  color: string
  softLimit: number
  maxLimit: number
  hint: string
  icon: React.ReactNode
}> = {
  instagram: {
    label: 'Instagram',
    color: '#E1306C',
    softLimit: 125,
    maxLimit: 280,
    hint: 'Hook in first 125 chars (before "more"). End with a save or share CTA.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  facebook: {
    label: 'Facebook',
    color: '#1877F2',
    softLimit: 150,
    maxLimit: 300,
    hint: 'Warm and relatable. End with a share CTA.',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
    ),
  },
  tiktok: {
    label: 'TikTok',
    color: '#010101',
    softLimit: 100,
    maxLimit: 140,
    hint: '140 chars max. POV/curiosity hook, no hashtags.',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.27 8.27 0 0 0 4.84 1.55V6.79a4.85 4.85 0 0 1-1.07-.1z" />
      </svg>
    ),
  },
  youtube: {
    label: 'YouTube',
    color: '#FF0000',
    softLimit: 60,
    maxLimit: 200,
    hint: 'Format: Title | description. Title (before |) is your search anchor, keep it under 60 chars. No hashtags.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 15l5.19-3L10 9v6z" />
        <path d="M21.56 7.17a2.76 2.76 0 0 0-1.94-1.95C17.88 4.78 12 4.78 12 4.78s-5.88 0-7.62.44A2.76 2.76 0 0 0 2.44 7.17C2 8.91 2 12 2 12s0 3.09.44 4.83a2.76 2.76 0 0 0 1.94 1.95C6.12 19.22 12 19.22 12 19.22s5.88 0 7.62-.44a2.76 2.76 0 0 0 1.94-1.95C22 15.09 22 12 22 12s0-3.09-.44-4.83z" />
      </svg>
    ),
  },
}

const ALLOWED_PLATFORMS = new Set(['instagram', 'facebook', 'tiktok', 'youtube'])

function getPlatformMeta(platform: string) {
  return PLATFORMS[platform.toLowerCase()] ?? {
    label: platform,
    color: '#6366F1',
    softLimit: 300,
    maxLimit: 2200,
    hint: '',
    icon: null,
  }
}

// ── Drive URL helpers ─────────────────────────────────────────────────────────

function parseDriveFileId(url: string): string | null {
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (m1) return m1[1]
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (m2) return m2[1]
  return null
}

function driveToDownloadUrl(url: string): string | null {
  const id = parseDriveFileId(url)
  if (!id) return null
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoJobRow {
  id: string
  script_id: string
  selected_variant: string
  variants: VideoVariant[]
  created_at: string
  script: {
    hook: string
    body: string
    cta: string
  } | null
}

// ── Caption card ──────────────────────────────────────────────────────────────

function CaptionCard({
  platform,
  value,
  onChange,
  script,
}: {
  platform: string
  value: string
  onChange: (v: string) => void
  script: { hook: string; body: string; cta: string } | null
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState('')

  const meta = getPlatformMeta(platform)
  const isYouTube = platform.toLowerCase() === 'youtube'
  const len = value.length
  const overMax = len > meta.maxLimit
  const nearMax = len > meta.maxLimit * 0.85

  // YouTube: parse title vs description at the pipe
  const pipeIdx = isYouTube ? value.indexOf('|') : -1
  const ytTitle = pipeIdx >= 0 ? value.slice(0, pipeIdx).trim() : (isYouTube ? value : '')
  const ytTitleLen = ytTitle.length
  const ytTitleOver = ytTitleLen > 60

  async function handleRewrite() {
    if (!feedback.trim()) return
    setRewriting(true)
    setRewriteError('')
    try {
      const res = await fetch('/api/publish/captions/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, currentCaption: value, feedback: feedback.trim(), script }),
      })
      const data = await res.json()
      if (!res.ok) { setRewriteError(data.error ?? 'Rewrite failed'); return }
      if (data.caption) {
        onChange(data.caption)
        setFeedback('')
        setShowFeedback(false)
      }
    } catch (e) {
      setRewriteError((e as Error).message)
    } finally {
      setRewriting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[#E4E4E0] overflow-hidden transition-colors">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: meta.color + '12', borderBottom: '1px solid ' + meta.color + '22' }}
      >
        <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: meta.color, color: 'white' }}>
          {meta.icon}
        </span>
        <span className="text-sm font-semibold flex-1" style={{ color: meta.color }}>
          {meta.label}
        </span>
        {isYouTube ? (
          <div className="flex items-center gap-3 text-[11px] font-medium tabular-nums">
            <span style={{ color: ytTitleOver ? '#EF4444' : '#A1A1AA' }}>
              Title {ytTitleLen}/60
            </span>
            <span style={{ color: overMax ? '#EF4444' : nearMax ? '#F59E0B' : '#A1A1AA' }}>
              Total {len}/{meta.maxLimit}
            </span>
          </div>
        ) : (
          <span className="text-[11px] font-medium tabular-nums"
            style={{ color: overMax ? '#EF4444' : nearMax ? '#F59E0B' : '#A1A1AA' }}>
            {len}/{meta.maxLimit}
          </span>
        )}
      </div>

      {/* Textarea */}
      <textarea
        value={value}
        onChange={e => onChange(e.target.value.slice(0, meta.maxLimit))}
        placeholder={`${meta.label} caption…`}
        rows={4}
        className="w-full px-4 py-3 text-sm leading-relaxed outline-none resize-none bg-white"
        style={{ color: '#18181B' }}
      />

      {/* YouTube: live split preview */}
      {isYouTube && value.trim() && (
        <div className="mx-4 mb-3 rounded-xl overflow-hidden" style={{ border: '1px solid #FFE4D6' }}>
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ background: '#FFF3EF', color: '#FF4F17' }}>
            Shorts preview
          </div>
          <div className="px-3 py-2.5 bg-white space-y-1.5">
            <div>
              <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-0.5">Title</p>
              <p className="text-sm font-semibold text-[#18181B] leading-snug" style={{ fontFamily: 'var(--font-jakarta)' }}>
                {pipeIdx >= 0 ? value.slice(0, pipeIdx).trim() : value.trim()}
              </p>
              {ytTitleOver && (
                <p className="text-[11px] text-[#EF4444] mt-0.5">
                  {ytTitleLen - 60} chars over limit. Shorten what comes before the |.
                </p>
              )}
            </div>
            {pipeIdx >= 0 && value.slice(pipeIdx + 1).trim() && (
              <div style={{ borderTop: '1px solid #F4F3F0', paddingTop: 8 }}>
                <p className="text-[10px] font-semibold text-[#A1A1AA] uppercase tracking-wider mb-0.5">Description</p>
                <p className="text-xs text-[#71717A] leading-relaxed">
                  {value.slice(pipeIdx + 1).trim()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {meta.hint && (
        <p className="px-4 pb-2.5 text-[11px]" style={{ color: '#A1A1AA' }}>{meta.hint}</p>
      )}

      {/* Rewrite with feedback */}
      <div style={{ borderTop: '1px solid #F0EFED' }}>
        {showFeedback ? (
          <div className="px-4 py-3 space-y-2">
            <textarea
              autoFocus
              placeholder="What to change? e.g. make it shorter, more casual, lead with the sleep angle..."
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-[#E4E4E0] text-xs text-[#18181B] placeholder:text-[#A1A1AA] outline-none resize-none bg-[#FAFAF9] focus:border-[#FF4F17] transition-colors"
            />
            {rewriteError && (
              <p className="text-[11px] text-[#EF4444]">{rewriteError}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRewrite}
                disabled={rewriting || !feedback.trim()}
                className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                style={{ background: '#FF4F17' }}
              >
                {rewriting ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Rewriting...
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" />
                    </svg>
                    Rewrite
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setShowFeedback(false); setFeedback(''); setRewriteError('') }}
                className="h-8 px-3 rounded-xl text-xs text-[#71717A] hover:text-[#18181B] transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowFeedback(true)}
            className="w-full flex items-center gap-1.5 px-4 py-2.5 text-[11px] text-[#A1A1AA] hover:text-[#71717A] hover:bg-[#FAFAF9] transition-colors cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" />
            </svg>
            Rewrite with feedback
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

function PublishForm() {
  const searchParams = useSearchParams()
  const prefillUrl = searchParams.get('url') ?? ''
  const paramJobId = searchParams.get('jobId') ?? null

  // Accounts
  const [accounts, setAccounts] = useState<BlatoAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Video jobs
  const [jobs, setJobs] = useState<VideoJobRow[]>([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  // Video source
  const [videoUrl, setVideoUrl] = useState(prefillUrl)
  const [driveInput, setDriveInput] = useState('')
  const [driveResolved, setDriveResolved] = useState<string | null>(null)
  const [driveError, setDriveError] = useState<string | null>(null)
  const [videoSource, setVideoSource] = useState<'job' | 'drive'>(prefillUrl ? 'drive' : 'job')

  // Captions (per platform key)
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const [generatingCaptions, setGeneratingCaptions] = useState(false)
  const [captionError, setCaptionError] = useState<string | null>(null)

  // Track whether we've already auto-generated for the param job so it only fires once
  const autoGenFired = useRef(false)

  // Schedule
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')  // datetime-local value
  const [dayTaken, setDayTaken] = useState(false)
  const [checkingDay, setCheckingDay] = useState(false)

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    status: string
    platformPosts: { platform: string; status: string; error?: string | null }[]
  } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    setAccountsError(null)
    try {
      const res = await fetch('/api/publish/accounts')
      const data = await res.json()
      if (!res.ok) { setAccountsError(data.error ?? 'Failed to load accounts.'); return }
      const filtered = (data.accounts as BlatoAccount[]).filter(
        a => ALLOWED_PLATFORMS.has(a.platform.toLowerCase())
      )
      setAccounts(filtered)
      setSelectedIds(new Set(filtered.map(a => a.id)))
    } catch {
      setAccountsError('Could not reach Blotato.')
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true)
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('video_jobs')
        .select('id, script_id, selected_variant, variants, created_at, scripts(hook, body, cta)')
        .eq('status', 'complete')
        .not('selected_variant', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20)

      setJobs(
        (data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          script: Array.isArray(row.scripts) ? row.scripts[0] : row.scripts,
        })) as VideoJobRow[]
      )
    } finally {
      setLoadingJobs(false)
    }
  }, [])

  useEffect(() => {
    loadAccounts()
    loadJobs()
  }, [loadAccounts, loadJobs])

  // Auto-select the job from ?jobId param once the list is ready
  useEffect(() => {
    if (!paramJobId || loadingJobs || jobs.length === 0) return
    const job = jobs.find(j => j.id === paramJobId)
    if (job) pickJob(job)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramJobId, loadingJobs, jobs])

  // Auto-generate captions once the param job is selected and accounts are ready.
  // Uses accounts.length + loadingAccounts as deps (both state, defined above);
  // canGenerate is checked inside the callback after all derived values are computed.
  useEffect(() => {
    if (!paramJobId || autoGenFired.current) return
    if (selectedJobId !== paramJobId) return
    if (loadingAccounts || accounts.length === 0) return
    if (!canGenerate) return
    autoGenFired.current = true
    generateCaptions()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId, accounts.length, loadingAccounts])

  // Check if the chosen schedule day already has a post
  useEffect(() => {
    if (scheduleMode !== 'later' || !scheduledAt) { setDayTaken(false); return }
    let cancelled = false
    setCheckingDay(true)
    const supabase = createClient()
    const d = new Date(scheduledAt)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0).toISOString()
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString()
    supabase
      .from('publish_jobs')
      .select('id')
      .gte('scheduled_at', dayStart)
      .lte('scheduled_at', dayEnd)
      .in('status', ['scheduled', 'publishing'])
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) {
          setDayTaken(!!(data && data.length > 0))
          setCheckingDay(false)
        }
      })
    return () => { cancelled = true }
  }, [scheduledAt, scheduleMode])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const selectedJob = jobs.find(j => j.id === selectedJobId) ?? null
  const selectedVariant = selectedJob
    ? (selectedJob.variants ?? []).find(v => v.id === selectedJob.selected_variant) ?? null
    : null

  const selectedAccounts = accounts.filter(a => selectedIds.has(a.id))
  const selectedPlatforms = (Object.keys(PLATFORMS) as string[]).filter(p =>
    selectedAccounts.some(a => a.platform.toLowerCase() === p)
  )

  const hasScript = !!(selectedJob?.script?.hook)
  const canGenerate = hasScript && selectedPlatforms.length > 0
  const captionsFilled = selectedPlatforms.length > 0 &&
    selectedPlatforms.every(p => (captions[p] ?? '').trim().length > 0)
  const canPublish = !!videoUrl.trim() && captionsFilled && selectedIds.size > 0 && !loadingAccounts && !dayTaken

  // ── Handlers ────────────────────────────────────────────────────────────────

  function pickJob(job: VideoJobRow) {
    setSelectedJobId(job.id)
    setVideoSource('job')
    const variant = (job.variants ?? []).find(v => v.id === job.selected_variant)
    if (variant?.download_url) setVideoUrl(variant.download_url)
  }

  function switchSource(src: 'job' | 'drive') {
    setVideoSource(src)
    if (src === 'job') {
      setVideoUrl(selectedVariant?.download_url ?? '')
    } else {
      setVideoUrl(driveResolved ?? '')
    }
  }

  function handleDriveInput(raw: string) {
    setDriveInput(raw)
    setDriveError(null)
    if (!raw.trim()) {
      setDriveResolved(null)
      setVideoUrl('')
      return
    }
    if (!raw.includes('drive.google.com') && !raw.includes('docs.google.com')) {
      setDriveError('Paste a Google Drive share link (drive.google.com/…)')
      setDriveResolved(null)
      setVideoUrl('')
      return
    }
    const resolved = driveToDownloadUrl(raw)
    if (!resolved) {
      setDriveError("Couldn't find a file ID in this link. Try sharing the file directly.")
      setDriveResolved(null)
      setVideoUrl('')
      return
    }
    setDriveResolved(resolved)
    setVideoUrl(resolved)
    setSelectedJobId(null)
  }

  async function generateCaptions() {
    if (!canGenerate) return
    setGeneratingCaptions(true)
    setCaptionError(null)
    const s = selectedJob!.script!
    try {
      const res = await fetch('/api/publish/captions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hook: s.hook, body: s.body, cta: s.cta, platforms: selectedPlatforms }),
      })
      const data = await res.json()
      if (!res.ok) { setCaptionError(data.error ?? 'Generation failed'); return }
      setCaptions(prev => ({ ...prev, ...data.captions }))
    } catch (e) {
      setCaptionError((e as Error).message)
    } finally {
      setGeneratingCaptions(false)
    }
  }

  function toggleAccount(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    if (!canPublish) return
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)

    const res = await fetch('/api/publish/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptId: selectedJob?.script_id ?? null,
        videoJobId: selectedJob?.id ?? null,
        variantId: selectedJob?.selected_variant ?? null,
        downloadUrl: videoUrl.trim(),
        captions,
        accounts: selectedAccounts.map(a => ({ id: a.id, platform: a.platform, pageId: a.pageId })),
        scheduledAt: scheduleMode === 'later' && scheduledAt
          ? new Date(scheduledAt).toISOString()
          : undefined,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setSubmitError(data.error ?? 'Publish failed.'); return }
    setResult(data)
  }

  const noKey = accountsError?.includes('BLOTATO_API_KEY')
  const allPublished = result?.status === 'published' || result?.status === 'scheduled'

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 max-w-2xl w-full mx-auto">

      {/* Header */}
      <div className="mb-7">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#71717A] transition-colors mb-4">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>Publish</h1>
        <p className="mt-1 text-sm text-[#71717A]">Post to all connected platforms at once.</p>
      </div>

      {/* Selected video banner   shown when coming from the edit page */}
      {selectedJob && paramJobId && (
        <div className="bg-[#FFF4F1] border border-[#FFCAB8] rounded-2xl px-5 py-4 mb-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#FF4F17] flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-[#FF4F17] uppercase tracking-widest mb-0.5">Ready to publish</p>
            <p className="text-sm font-semibold text-[#18181B] leading-snug truncate">
              &ldquo;{selectedJob.script?.hook ?? 'Untitled'}&rdquo;
            </p>
            <p className="text-[11px] text-[#71717A] mt-0.5">
              {(() => {
                const v = (selectedJob.variants ?? []).find(v => v.id === selectedJob.selected_variant)
                return v?.name ?? 'Edited'
              })()}
              {generatingCaptions && (
                <span className="ml-2 text-[#FF4F17]">Generating captions…</span>
              )}
            </p>
          </div>
        </div>
      )}

      {noKey && (
        <div className="bg-[#FFF7ED] border border-[#FED7AA] rounded-2xl p-5 mb-6">
          <p className="font-semibold text-sm text-[#C2410C] mb-1">Blotato not configured</p>
          <p className="text-xs text-[#9A3412]">
            Add <code className="bg-[#FEE2E2] px-1 py-0.5 rounded text-[#B91C1C]">BLOTATO_API_KEY</code> to <code>.env.local</code> and restart.
          </p>
        </div>
      )}

      <form onSubmit={handlePublish} className="space-y-4">

        {/* ── 1. Platforms ── */}
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-5 h-5 rounded-full bg-[#FF4F17] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
            <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest">Choose platforms</p>
          </div>
          {loadingAccounts ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin" />
              <span className="text-xs text-[#A1A1AA]">Loading accounts…</span>
            </div>
          ) : accountsError && !noKey ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-[#EF4444]">{accountsError}</p>
              <button type="button" onClick={loadAccounts} className="text-xs text-[#FF4F17] underline">Retry</button>
            </div>
          ) : accounts.length === 0 && !accountsError ? (
            <p className="text-xs text-[#A1A1AA]">
              No supported accounts connected.{' '}
              <a href="https://app.blotato.com" target="_blank" rel="noopener noreferrer" className="text-[#FF4F17] underline">
                Connect at app.blotato.com →
              </a>
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {accounts.map(acc => {
                const meta = getPlatformMeta(acc.platform)
                const selected = selectedIds.has(acc.id)
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => toggleAccount(acc.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-sm font-medium"
                    style={{
                      background: selected ? meta.color : '#F9F9F8',
                      borderColor: selected ? meta.color : '#E4E4E0',
                      color: selected ? 'white' : '#18181B',
                    }}
                  >
                    <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: selected ? 'rgba(255,255,255,0.2)' : meta.color, color: 'white' }}>
                      {meta.icon}
                    </span>
                    <span>{acc.fullname || acc.username || meta.label}</span>
                    {selected
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    }
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ── 2. Video ── */}
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-5 h-5 rounded-full bg-[#FF4F17] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
            <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest">Pick your video</p>
          </div>

          {/* Source toggle */}
          <div className="flex gap-1 p-1 bg-[#F4F3F0] rounded-xl mb-4 w-fit">
            {(['job', 'drive'] as const).map(src => (
              <button
                key={src}
                type="button"
                onClick={() => switchSource(src)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: videoSource === src ? 'white' : 'transparent',
                  color: videoSource === src ? '#18181B' : '#71717A',
                  boxShadow: videoSource === src ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {src === 'job' ? 'From library' : 'Google Drive'}
              </button>
            ))}
          </div>

          {/* Library tab */}
          {videoSource === 'job' && (
            loadingJobs ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin" />
                <span className="text-xs text-[#A1A1AA]">Loading videos…</span>
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-[#71717A] mb-2">No completed videos yet.</p>
                <Link href="/edit" className="text-xs text-[#FF4F17] underline">Go to Video Studio →</Link>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {jobs.map(job => {
                  const variant = (job.variants ?? []).find(v => v.id === job.selected_variant)
                  const isSelected = selectedJobId === job.id
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => pickJob(job)}
                      className="w-full text-left rounded-xl border px-4 py-3 transition-all"
                      style={{
                        borderColor: isSelected ? '#FF4F17' : '#E4E4E0',
                        background: isSelected ? '#FFF4F1' : '#FAFAFA',
                        outline: isSelected ? '1.5px solid #FF4F17' : 'none',
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#18181B] truncate">
                            {job.script?.hook ?? 'Untitled video'}
                          </p>
                          <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                            {variant?.name ?? 'Edited'} · {new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        {isSelected && (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {/* Drive tab */}
          {videoSource === 'drive' && (
            <div>
              <input
                type="url"
                placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
                value={driveInput}
                onChange={e => handleDriveInput(e.target.value)}
                className="w-full h-11 px-4 rounded-xl border text-sm outline-none transition-colors"
                style={{
                  borderColor: driveError ? '#FCA5A5' : driveResolved ? '#6EE7B7' : '#E4E4E0',
                  background: '#FAFAFA',
                }}
              />

              {driveError && (
                <p className="mt-2 text-xs text-[#EF4444] flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                  </svg>
                  {driveError}
                </p>
              )}

              {driveResolved && !driveError && (
                <p className="mt-2 text-xs text-[#059669] flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  Drive link detected   file must be shared as &ldquo;Anyone with the link&rdquo;
                </p>
              )}

              <div className="mt-3 bg-[#F0F9FF] border border-[#BAE6FD] rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-[#0369A1] mb-1">How to share from Google Drive</p>
                <ol className="text-xs text-[#0369A1] space-y-0.5 list-decimal list-inside">
                  <li>Right-click the file → <strong>Share</strong></li>
                  <li>Change access to <strong>&ldquo;Anyone with the link&rdquo;</strong></li>
                  <li>Copy the link and paste above</li>
                </ol>
                <p className="text-[11px] text-[#7DD3FC] mt-1.5">If the file is private, publishing will fail.</p>
              </div>
            </div>
          )}
        </div>

        {/* ── 3. Captions ── */}
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-5 h-5 rounded-full bg-[#FF4F17] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest">Captions</p>
            </div>
            <button
              type="button"
              onClick={generateCaptions}
              disabled={!canGenerate || generatingCaptions}
              title={!canGenerate ? 'Select a video from your library first' : undefined}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: canGenerate ? '#FF4F17' : '#F4F3F0',
                color: canGenerate ? 'white' : '#A1A1AA',
                cursor: canGenerate ? 'pointer' : 'not-allowed',
              }}
            >
              {generatingCaptions ? (
                <>
                  <div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a10 10 0 1 0 10 10" /><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
                  </svg>
                  Generate with AI
                </>
              )}
            </button>
          </div>

          {captionError && (
            <div className="mb-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-4 py-3">
              <p className="text-xs text-[#DC2626]">{captionError}</p>
            </div>
          )}

          {!canGenerate && selectedPlatforms.length > 0 && (
            <p className="text-[11px] text-[#A1A1AA] mb-3">
              Select a video from your library to auto-generate captions, or write them below.
            </p>
          )}

          {selectedPlatforms.length === 0 ? (
            <p className="text-xs text-[#A1A1AA]">Select at least one platform above.</p>
          ) : (
            <div className="space-y-3">
              {selectedPlatforms.map(platform => (
                <CaptionCard
                  key={platform}
                  platform={platform}
                  value={captions[platform] ?? ''}
                  onChange={v => setCaptions(prev => ({ ...prev, [platform]: v }))}
                  script={selectedJob?.script ?? null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Submit error */}
        {submitError && (
          <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-2xl px-5 py-3.5">
            <p className="text-sm font-medium text-[#DC2626]">{submitError}</p>
            {(submitError.toLowerCase().includes('drive') || submitError.toLowerCase().includes('download') || submitError.toLowerCase().includes('403')) && (
              <p className="text-xs text-[#DC2626] mt-1 opacity-80">
                Check that your Google Drive file is shared as &ldquo;Anyone with the link.&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={`rounded-2xl px-5 py-4 border ${allPublished ? 'bg-[#F0FDF4] border-[#BBF7D0]' : 'bg-[#FFFBEB] border-[#FDE68A]'}`}>
            <p className={`text-sm font-semibold mb-3 ${allPublished ? 'text-[#15803D]' : 'text-[#92400E]'}`}>
              {result.status === 'published' && 'Published ✓'}
              {result.status === 'scheduled' && 'Scheduled ✓'}
              {result.status === 'partial' && 'Partially published   some platforms failed'}
              {result.status === 'failed' && 'Publish failed'}
            </p>
            <div className="space-y-1.5">
              {result.platformPosts.map((p, i) => {
                const meta = getPlatformMeta(p.platform)
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: meta.color, color: 'white' }}>{meta.icon}</span>
                    <span className="font-medium text-[#18181B]">{meta.label}</span>
                    {p.status === 'published' || p.status === 'scheduled'
                      ? <span className="text-[#16A34A]">✓ {p.status}</span>
                      : <span className="text-[#DC2626]">✗ {p.error ?? 'failed'}</span>
                    }
                  </div>
                )
              })}
            </div>
            {allPublished && (
              <div className="mt-4 flex items-center gap-4 flex-wrap">
                <button type="button"
                  onClick={() => { setResult(null); setSelectedJobId(null); setVideoUrl(''); setDriveInput(''); setDriveResolved(null); setCaptions({}); setScheduleMode('now'); setScheduledAt('') }}
                  className="text-xs text-[#16A34A] underline">
                  Publish another
                </button>
                <a
                  href="https://my.blotato.com/queue/schedules"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#71717A] underline flex items-center gap-1"
                >
                  View Blotato calendar
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── 4. When ── */}
        {!result && (
          <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-5 h-5 rounded-full bg-[#FF4F17] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">4</span>
              <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest">When to post</p>
            </div>
            <div className="flex gap-1 p-1 bg-[#F4F3F0] rounded-xl w-fit mb-4">
              {(['now', 'later'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScheduleMode(m)}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: scheduleMode === m ? 'white' : 'transparent',
                    color: scheduleMode === m ? '#18181B' : '#71717A',
                    boxShadow: scheduleMode === m ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}
                >
                  {m === 'now' ? 'Publish now' : 'Schedule'}
                </button>
              ))}
            </div>

            {scheduleMode === 'later' && (
              <div>
                <div className="flex items-center gap-3">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    required={scheduleMode === 'later'}
                    className="h-11 px-4 rounded-xl border text-sm outline-none bg-[#FAFAFA] transition-colors"
                    style={{
                      colorScheme: 'light',
                      borderColor: dayTaken ? '#FCA5A5' : '#E4E4E0',
                    }}
                    onFocus={e => { if (!dayTaken) e.currentTarget.style.borderColor = '#FF4F17' }}
                    onBlur={e => { e.currentTarget.style.borderColor = dayTaken ? '#FCA5A5' : '#E4E4E0' }}
                  />
                  {checkingDay && (
                    <div className="w-4 h-4 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin" />
                  )}
                  {scheduledAt && !checkingDay && !dayTaken && (
                    <span className="text-xs text-[#059669] flex items-center gap-1">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      Day free
                    </span>
                  )}
                </div>

                {dayTaken && (
                  <div className="mt-2 flex items-start gap-2 bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                    </svg>
                    <div>
                      <p className="text-xs font-semibold text-[#DC2626]">This day already has a post scheduled.</p>
                      <p className="text-[11px] text-[#DC2626] opacity-80 mt-0.5">Pick a different day to keep one post per day.</p>
                    </div>
                  </div>
                )}

                {scheduledAt && !dayTaken && (
                  <p className="mt-2 text-xs text-[#71717A]">
                    Scheduled for {new Date(scheduledAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
                <p className="mt-3 text-[11px] text-[#A1A1AA]">
                  One post per day keeps your reach consistent.{' '}
                  <a
                    href="https://my.blotato.com/queue/schedules"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#FF4F17] underline"
                  >
                    View Blotato calendar →
                  </a>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Submit */}
        {!result && (
          <button
            type="submit"
            disabled={submitting || !canPublish || (scheduleMode === 'later' && !scheduledAt)}
            className="w-full h-12 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity flex items-center justify-center gap-2"
            style={{ background: '#FF4F17', boxShadow: '0 4px 14px rgba(255,79,23,0.25)', cursor: canPublish ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                {scheduleMode === 'later' ? 'Scheduling…' : 'Publishing…'}
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                {scheduleMode === 'later' ? 'Schedule' : 'Publish'} to {selectedIds.size} platform{selectedIds.size !== 1 ? 's' : ''}
              </>
            )}
          </button>
        )}

      </form>
    </div>
  )
}

export default function PublishPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-[#A1A1AA]">Loading…</div>}>
      <PublishForm />
    </Suspense>
  )
}
