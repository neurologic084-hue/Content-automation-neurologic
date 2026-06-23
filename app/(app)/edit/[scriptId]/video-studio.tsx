'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  const [jobId, setJobId] = useState<string | null>(existingJobId)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'processing' | 'complete' | 'error'>(
    existingJobId ? 'processing' : 'idle'
  )
  const [variants, setVariants] = useState<VideoVariant[]>([])
  const [readyCount, setReadyCount] = useState(0)
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
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
      // silent — will retry
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus('submitting')

    const res = await fetch('/api/video/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptId: script.id, driveUrl }),
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
    router.refresh()
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setJobId(null)
    setStatus('idle')
    setVariants([])
    setReadyCount(0)
    setSelectedVariant(null)
    setDriveUrl('')
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

          <div className="bg-[#F9F9F8] rounded-xl p-4 mb-4 text-xs text-[#71717A] space-y-1.5">
            <p className="font-semibold text-[#18181B]">How to get your Google Drive link:</p>
            <p>1. Upload your video to Google Drive</p>
            <p>2. Right-click the file &rarr; Share &rarr; Anyone with the link</p>
            <p>3. Copy link and paste below</p>
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

          {error && <p className="text-xs text-[#EF4444] mb-3">{error}</p>}

          <button
            type="submit"
            disabled={!driveUrl.trim()}
            className="w-full h-11 rounded-xl text-sm font-semibold text-white cursor-pointer disabled:opacity-40 transition-opacity"
            style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
          >
            Generate 10 variants
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
                <span className="text-xs text-[#A1A1AA]">{readyCount} / {variants.length || 10} ready</span>
              </div>
              <div className="h-2 bg-[#F0EFED] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(readyCount / 10) * 100}%`, background: '#FF4F17' }}
                />
              </div>
              <p className="text-xs text-[#A1A1AA] mt-2">
                Each variant is being processed in parallel across Submagic and Hyperframe
              </p>
            </div>
          )}

          {status === 'complete' && (
            <div className="flex items-center gap-3 bg-[#DCFCE7] border border-[#BBF7D0] rounded-2xl px-5 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <p className="text-sm font-semibold text-[#15803D]">All 10 variants ready. Pick one to publish.</p>
            </div>
          )}

          {/* Variants grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(variants.length ? variants : Array.from({ length: 10 })).map((variant, i) => {
              const v = variant as VideoVariant | undefined
              const isReady = v?.status === 'ready'
              const isSelected = selectedVariant === v?.id
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
                  {/* Thumbnail / status area */}
                  <div
                    className="w-full rounded-xl mb-3 flex items-center justify-center"
                    style={{
                      height: 100,
                      background:
                        v?.status === 'failed'
                          ? '#FEF2F2'
                          : isReady
                          ? isSelected
                            ? '#FFF3EF'
                            : '#F4F3F0'
                          : '#F9F9F8',
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
                    ) : isReady ? (
                      v?.preview_url && !v.preview_url.startsWith('placeholder') ? (
                        <a
                          href={v.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-col items-center gap-1.5 group"
                          onClick={e => e.stopPropagation()}
                        >
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isSelected ? '#FF4F17' : '#A1A1AA'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                            <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
                            <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill={isSelected ? '#FF4F17' : '#A1A1AA'} stroke="none" />
                          </svg>
                          <span className="text-[10px] text-[#A1A1AA] group-hover:text-[#FF4F17]">Preview</span>
                        </a>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={isSelected ? '#FF4F17' : '#A1A1AA'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
                          <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill={isSelected ? '#FF4F17' : '#A1A1AA'} stroke="none" />
                        </svg>
                      )
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-[#D4D4D0] border-t-transparent animate-spin" />
                    )}
                  </div>

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

                  {v?.status === 'failed' ? (
                    <div className="w-full h-9 rounded-xl flex items-center justify-center bg-[#FEF2F2]">
                      <span className="text-xs text-[#EF4444] font-medium">Failed</span>
                    </div>
                  ) : isReady ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSelectVariant(v!.id)}
                        disabled={saving}
                        className="flex-1 h-9 rounded-xl text-xs font-semibold cursor-pointer transition-all disabled:opacity-40"
                        style={{
                          background: isSelected ? '#FF4F17' : '#F4F3F0',
                          color: isSelected ? 'white' : '#18181B',
                        }}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                      {v?.download_url && !v.download_url.startsWith('placeholder') && (
                        <a
                          href={v.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                          style={{ background: '#F4F3F0', color: '#71717A' }}
                          title="Download"
                          onClick={e => e.stopPropagation()}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </a>
                      )}
                    </div>
                  ) : (
                    <div
                      className="w-full h-9 rounded-xl flex items-center justify-center"
                      style={{ background: '#F4F3F0' }}
                    >
                      <span className="text-xs text-[#C4C4C0]">Processing...</span>
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
                Variant saved — ready for publish in Phase 3
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
