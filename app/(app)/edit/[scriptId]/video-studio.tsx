'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { VideoVariant } from '@/lib/video-pipeline'

interface Script {
  id: string
  hook: string
  body: string
  cta: string
  mood_tag: string | null
}

interface Props {
  script: Script
  existingJobId: string | null
}

const TOOL_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  submagic:    { bg: '#EEF2FF', text: '#6366F1', label: 'Submagic' },
  hyperframe:  { bg: '#FFF3EF', text: '#FF4F17', label: 'Hyperframe' },
}

export function VideoStudio({ script, existingJobId }: Props) {
  const [driveUrl, setDriveUrl] = useState('')
  const [brollUrl, setBrollUrl] = useState('')
  const [jobId, setJobId] = useState<string | null>(existingJobId)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'processing' | 'complete' | 'error'>(
    existingJobId ? 'processing' : 'idle'
  )
  const [variants, setVariants] = useState<VideoVariant[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [startingVariants, setStartingVariants] = useState<Set<string>>(new Set())
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (jobId && (status === 'processing' || status === 'complete')) {
      startPolling(jobId)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobId])

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => pollStatus(id), 2500)
    pollStatus(id)
  }

  async function pollStatus(id: string) {
    try {
      const res = await fetch(`/api/video/status/${id}`)
      const data = await res.json()
      if (!res.ok) return

      setVariants(data.variants ?? [])
      const ready = (data.variants ?? []).filter((v: VideoVariant) => v.status === 'ready').length
      setReadyCount(ready)
      setSelectedVariant(data.selected_variant ?? null)

      if (data.status === 'complete') {
        setStatus('complete')
        if (pollRef.current) clearInterval(pollRef.current)
      }
    } catch {
      // silent   will retry
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus('submitting')

    const res = await fetch('/api/video/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId: script.id, driveUrl, ...(brollUrl.trim() ? { brollDriveUrl: brollUrl.trim() } : {}) }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.')
      setStatus('idle')
      return
    }

    setJobId(data.jobId)
    setStatus('processing')
    startPolling(data.jobId)
  }

  async function handleSelectVariant(variantId: string) {
    if (!jobId) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('video_jobs').update({ selected_variant: variantId }).eq('id', jobId)
    setSelectedVariant(variantId)
    setSaving(false)
    router.push(`/publish?jobId=${jobId}`)
  }

  async function handleStartVariant(variantId: string) {
    if (!jobId) return
    setStartingVariants(prev => new Set(prev).add(variantId))
    try {
      await fetch('/api/video/start-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, variantId }),
      })
      setStatus('processing')
      startPolling(jobId)
    } finally {
      setStartingVariants(prev => { const s = new Set(prev); s.delete(variantId); return s })
    }
  }

  async function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current)
    // Delete the job from Supabase so old variants don't reappear
    if (jobId) {
      const supabase = createClient()
      await supabase.from('video_jobs').delete().eq('id', jobId)
    }
    setJobId(null)
    setStatus('idle')
    setVariants([])
    setReadyCount(0)
    setSelectedVariant(null)
    setDriveUrl('')
    setBrollUrl('')
    setError(null)
  }

  return (
    <div className="space-y-6">

      {/* Script card */}
      <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
        <p className="text-[11px] font-bold text-[#A1A1AA] uppercase tracking-widest mb-3">Script</p>
        <p className="text-sm font-semibold text-[#18181B] leading-snug mb-3">
          &ldquo;{script.hook}&rdquo;
        </p>
        <p className="text-xs text-[#71717A] leading-relaxed whitespace-pre-line line-clamp-3">
          {script.body}
        </p>
        {script.mood_tag && (
          <span className="inline-block mt-3 text-[11px] px-2.5 py-1 rounded-full bg-[#F4F3F0] text-[#71717A]">
            {script.mood_tag}
          </span>
        )}
      </div>

      {/* Upload / processing / variants */}
      {status === 'idle' && (
        <form onSubmit={handleSubmit} className="bg-white border border-[#E4E4E0] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#F4F3F0' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
                <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="#71717A" stroke="none" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-[#18181B] text-sm" style={{ fontFamily: 'var(--font-jakarta)' }}>
                Add your footage
              </p>
              <p className="text-xs text-[#A1A1AA]">Upload to Google Drive and paste the share link</p>
            </div>
          </div>

          <div className="bg-[#F9F9F8] rounded-xl p-4 mb-4 text-xs text-[#71717A] space-y-2">
            <p className="font-semibold text-[#18181B]">How to share your video from Google Drive:</p>
            <ol className="space-y-1.5 list-none">
              <li className="flex gap-2"><span className="flex-shrink-0 font-semibold text-[#FF4F17]">1.</span><span>Upload your video file to Google Drive</span></li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-semibold text-[#FF4F17]">2.</span><span>Right-click the file &rarr; <strong className="text-[#18181B]">Share</strong></span></li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-semibold text-[#FF4F17]">3.</span><span>Under &ldquo;General access&rdquo; change to <strong className="text-[#18181B]">Anyone with the link</strong> and set role to <strong className="text-[#18181B]">Viewer</strong></span></li>
              <li className="flex gap-2"><span className="flex-shrink-0 font-semibold text-[#FF4F17]">4.</span><span>Click <strong className="text-[#18181B]">Copy link</strong> and paste below</span></li>
            </ol>
            <div className="mt-2 pt-2 border-t border-[#E8E7E4]">
              <p className="font-medium text-[#18181B] mb-1">Your link should look like:</p>
              <code className="block bg-white border border-[#E4E4E0] rounded-lg px-3 py-2 text-[10px] text-[#71717A] break-all">
                https://drive.google.com/file/d/FILE_ID/view?usp=sharing
              </code>
            </div>
            <div className="mt-1.5 flex gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">
              <svg className="flex-shrink-0 mt-0.5" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="text-[#92400E]">Large MOV files (&gt;100 MB) may hit a Google virus-scan warning and fail to download. Use H.264 MP4 when possible for best results.</span>
            </div>
          </div>

          <input
            type="url"
            placeholder="https://drive.google.com/file/d/..."
            value={driveUrl}
            onChange={e => setDriveUrl(e.target.value)}
            required
            className="w-full h-11 px-4 rounded-xl border border-[#E4E4E0] text-sm outline-none mb-3"
            style={{ background: '#FAFAFA' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#FF4F17' }}
            onBlur={e => { e.currentTarget.style.borderColor = '#E4E4E0' }}
          />

          <div className="mb-4">
            <p className="text-xs font-semibold text-[#71717A] mb-1.5">
              Custom B-roll <span className="font-normal text-[#A1A1AA]">(optional)   Drive file or folder link</span>
            </p>
            <input
              type="url"
              placeholder="https://drive.google.com/drive/folders/... or /file/d/..."
              value={brollUrl}
              onChange={e => setBrollUrl(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-[#E4E4E0] text-sm outline-none"
              style={{ background: '#FAFAFA' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#FF4F17' }}
              onBlur={e => { e.currentTarget.style.borderColor = '#E4E4E0' }}
            />
            <p className="text-[11px] text-[#A1A1AA] mt-1.5">Paste a single video file or a folder. Stock B-roll will be disabled when you provide your own.</p>
          </div>

          {error && <p className="text-xs text-[#EF4444] mb-3">{error}</p>}

          <button
            type="submit"
            disabled={!driveUrl.trim()}
            className="w-full h-11 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-40 transition-opacity"
            style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
          >
            Start HyperFrame edit
          </button>
        </form>
      )}

      {status === 'submitting' && (
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-8 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin mb-4" />
          <p className="font-semibold text-[#18181B] text-sm">Starting job...</p>
        </div>
      )}

      {(status === 'processing' || status === 'complete') && (
        <div className="space-y-4 animate-fadeIn">

          {/* Progress bar */}
          {status === 'processing' && (
            <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-[#18181B]">Generating variants</p>
                <span className="text-xs text-[#A1A1AA]">{readyCount} / {variants.filter(v => v.status !== 'pending').length || 3} ready</span>
              </div>
              <div className="h-2 bg-[#F0EFED] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(readyCount / Math.max(variants.filter(v => v.status !== 'pending').length, 3)) * 100}%`, background: '#FF4F17' }}
                />
              </div>
              <p className="text-xs text-[#A1A1AA] mt-2">
                Each variant is being processed in parallel by Submagic
              </p>
            </div>
          )}

          {status === 'complete' && (
            <div className="flex items-center gap-3 bg-[#DCFCE7] border border-[#BBF7D0] rounded-2xl px-5 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <p className="text-sm font-semibold text-[#15803D]">{readyCount} variant{readyCount !== 1 ? 's' : ''} ready. Pick one to publish.</p>
            </div>
          )}

          {/* Variants grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(variants.length ? variants : Array.from({ length: 1 })).map((variant, i) => {
              const v = variant as VideoVariant | undefined
              const isPending = v?.status === 'pending'
              const isReady = v?.status === 'ready'
              const isSelected = selectedVariant === v?.id
              const isStarting = v?.id ? startingVariants.has(v.id) : false
              const toolMeta = v ? TOOL_COLOR[v.tool] : null

              return (
                <div
                  key={v?.id ?? i}
                  className="bg-white border rounded-2xl p-4 transition-all duration-200"
                  style={{
                    borderColor: isSelected ? '#FF4F17' : '#E4E4E0',
                    outline: isSelected ? '1.5px solid #FF4F17' : 'none',
                  }}
                >
                  {/* Preview area */}
                  {isReady && v?.preview_url && !v.preview_url.startsWith('placeholder') ? (
                    <div className="w-full rounded-xl mb-3 overflow-hidden bg-black" style={{ height: 240 }}>
                      <video
                        src={v.preview_url}
                        autoPlay
                        muted
                        loop
                        playsInline
                        controls
                        preload="auto"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div
                      className="w-full rounded-xl mb-3 flex items-center justify-center"
                      style={{
                        height: isPending || isStarting || v?.status === 'failed' ? 100 : 130,
                        background: v?.status === 'failed' ? '#FEF2F2' : isPending ? '#F4F3F0' : '#F9F9F8',
                      }}
                    >
                      {v?.status === 'failed' ? (
                        <div className="flex flex-col items-center gap-1 px-3 text-center">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4M12 16h.01" />
                          </svg>
                          <span className="text-[10px] text-[#EF4444] leading-tight line-clamp-2">{v?.error ?? 'Failed'}</span>
                        </div>
                      ) : isPending ? (
                        <span className="text-[11px] text-[#C4C4C0]">Not started</span>
                      ) : isStarting ? (
                        <div className="w-5 h-5 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin" />
                      ) : (
                        <div className="flex flex-col items-center gap-3 w-full px-5">
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin flex-shrink-0" />
                              <span className="text-[11px] font-medium text-[#71717A]">
                                {v?.progress?.label ?? 'Starting...'}
                              </span>
                            </div>
                            <span className="text-[13px] font-bold tabular-nums" style={{ color: '#FF4F17' }}>
                              {v?.progress ? `${Math.round((v.progress.step / v.progress.total) * 100)}%` : '0%'}
                            </span>
                          </div>
                          <div className="w-full bg-[#E4E4E0] rounded-full overflow-hidden" style={{ height: 4 }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: v?.progress ? `${(v.progress.step / v.progress.total) * 100}%` : '0%',
                                background: '#FF4F17',
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-[#A1A1AA]">
                            {v?.progress ? `Step ${v.progress.step} of ${v.progress.total}` : 'Connecting to pipeline...'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-[#18181B]">{v?.name ?? `Variant ${i + 1}`}</p>
                    {toolMeta && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: toolMeta.bg, color: toolMeta.text }}
                      >
                        {toolMeta.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#A1A1AA] mb-3">{v?.description ?? ''}</p>

                  {isPending || v?.status === 'failed' ? (
                    <button
                      onClick={() => v?.id && handleStartVariant(v.id)}
                      disabled={isStarting || !v?.id}
                      className="w-full h-9 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-40"
                      style={{ background: v?.status === 'failed' ? '#FEF2F2' : '#F4F3F0', color: v?.status === 'failed' ? '#EF4444' : '#18181B' }}
                    >
                      {isStarting ? 'Starting...' : isPending ? 'Start now' : 'Retry'}
                    </button>
                  ) : isReady ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSelectVariant(v!.id)}
                          disabled={saving}
                          className="flex-1 h-9 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-40"
                          style={{ background: isSelected ? '#FF4F17' : '#F4F3F0', color: isSelected ? 'white' : '#18181B' }}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                        <button
                          onClick={() => v?.id && handleStartVariant(v.id)}
                          disabled={isStarting}
                          className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40"
                          style={{ background: '#F4F3F0', color: '#71717A' }}
                          title="Retry"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                            <path d="M3 3v5h5" />
                          </svg>
                        </button>
                        {v?.download_url && !v.download_url.startsWith('placeholder') && (
                          <a
                            href={v.download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                            style={{ background: '#F4F3F0', color: '#71717A' }}
                            title="Download"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          </a>
                        )}
                      </div>
                      {v?.download_url && !v.download_url.startsWith('placeholder') && (
                        <Link
                          href={`/publish?url=${encodeURIComponent(v.download_url)}&caption=${encodeURIComponent(script.hook)}`}
                          className="flex items-center justify-center gap-1.5 w-full h-9 rounded-xl text-xs font-semibold transition-all"
                          style={{ background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                          Publish this
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-9 rounded-xl flex items-center justify-center gap-2" style={{ background: '#F4F3F0' }}>
                      <div className="w-3 h-3 rounded-full border-2 border-[#FF4F17] border-t-transparent animate-spin" />
                      <span className="text-xs text-[#A1A1AA]">Processing</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleReset}
              className="h-9 px-4 rounded-xl text-xs font-medium cursor-pointer border"
              style={{ borderColor: '#E4E4E0', color: '#71717A' }}
            >
              Replace footage
            </button>
            {selectedVariant && (
              <div className="flex items-center gap-2 text-xs text-[#22C55E] font-medium">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Variant saved
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
