'use client'

import { useEffect, useRef, useState } from 'react'

// A picker whose whole job is answering "which video is this?": a real preview
// of the one you are about to post, then the other videos with a thumbnail,
// the line they open with, the date, and where each has already been posted.

export type PickerVariant = {
  id: string
  name?: string
  status: string
  download_url: string | null
  preview_url?: string | null
}

export type PickerJob = {
  id: string
  created_at: string
  selected_variant: string | null
  variants: PickerVariant[]
  script: { hook: string } | null
}

export type PlatformMeta = { label: string; color: string; icon: React.ReactNode }

type Props = {
  jobs: PickerJob[]
  selectedJobId: string | null
  pickedVariantId: string | null
  onPickJob: (job: PickerJob) => void
  onPickVariant: (job: PickerJob, variantId: string) => void
  /** Platforms this exact version has already gone out (or is scheduled) to. */
  postedOn: (jobId: string, variantId: string) => string[]
  platformMeta: (platform: string) => PlatformMeta
}

// Experimental variants are hidden everywhere else; one old job still carries one.
const isPublishable = (v: PickerVariant) => v.status === 'ready' && !!v.download_url && !/\(test\)/i.test(v.name ?? '')
const readyOf = (job: PickerJob) => job.variants.filter(isPublishable)
const thumbSrc = (v: PickerVariant | undefined) => {
  const url = v?.preview_url || v?.download_url
  return url ? `${url.split('#')[0]}#t=0.5` : null
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function VideoPicker({ jobs, selectedJobId, pickedVariantId, onPickJob, onPickVariant, postedOn, platformMeta }: Props) {
  const selectedJob = jobs.find(j => j.id === selectedJobId) ?? null
  const ready = selectedJob ? readyOf(selectedJob) : []
  const activeId = pickedVariantId ?? selectedJob?.selected_variant ?? null
  const active = ready.find(v => v.id === activeId) ?? null
  const others = jobs.filter(j => j.id !== selectedJobId && readyOf(j).length > 0)

  return (
    <div className="space-y-4">
      {selectedJob && active && (
        <section aria-label="Video you are publishing" className="rounded-2xl border p-3.5 sm:p-4" style={{ borderColor: '#FFCAB8', background: '#FFF8F5' }}>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#FF4F17]">You are publishing this</p>
          <div className="flex gap-3.5">
            <video
              key={active.id}
              src={active.download_url ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="aspect-[9/16] w-[104px] flex-shrink-0 rounded-xl bg-black object-cover sm:w-[120px]"
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-4 text-sm font-semibold leading-snug text-[#18181B]">{selectedJob.script?.hook ?? 'Untitled video'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-[#FF4F17] px-2.5 py-1 text-[11px] font-semibold text-white">{active.name ?? active.id}</span>
                <span className="text-[11px] text-[#A1A1AA]">edited {shortDate(selectedJob.created_at)}</span>
              </div>
              <PostedLine platforms={postedOn(selectedJob.id, active.id)} platformMeta={platformMeta} className="mt-2.5" />
            </div>
          </div>

          {ready.length > 1 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold text-[#71717A]">Versions of this video</p>
              <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
                {ready.map(v => {
                  const on = v.id === active.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onPickVariant(selectedJob, v.id)}
                      aria-pressed={on}
                      className="w-[84px] flex-shrink-0 snap-start cursor-pointer text-left"
                    >
                      <Thumb
                        src={thumbSrc(v)}
                        className="w-[84px] rounded-lg"
                        ring={on}
                      >
                        {postedOn(selectedJob.id, v.id).length > 0 && (
                          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#22C55E] text-white" title="Already posted">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                          </span>
                        )}
                      </Thumb>
                      <p className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-tight" style={{ color: on ? '#FF4F17' : '#18181B' }}>{v.name ?? v.id}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {others.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#A1A1AA]">
            {selectedJob ? 'Or choose a different video' : 'Choose a video'}
          </p>
          <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-0.5">
            {others.map(job => {
              const vs = readyOf(job)
              const lead = vs.find(v => v.id === job.selected_variant) ?? vs[0]
              const posted = [...new Set(vs.flatMap(v => postedOn(job.id, v.id)))]
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => onPickJob(job)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[#E4E4E0] bg-[#FAFAFA] p-2.5 text-left transition-colors hover:border-[#FFCAB8] hover:bg-[#FFF8F5]"
                  >
                    <Thumb src={thumbSrc(lead)} className="w-11 flex-shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#18181B]">{job.script?.hook ?? 'Untitled video'}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#A1A1AA]">
                        <span>{vs.length} version{vs.length === 1 ? '' : 's'}</span>
                        <span aria-hidden="true">·</span>
                        <span>{shortDate(job.created_at)}</span>
                        {posted.length > 0 && <PostedLine platforms={posted} platformMeta={platformMeta} compact />}
                      </span>
                    </span>
                    <svg className="flex-shrink-0 text-[#D4D4D0]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** "Posted to" with each platform's own colour, so it reads at a glance. */
function PostedLine({ platforms, platformMeta, className = '', compact = false }: {
  platforms: string[]
  platformMeta: (p: string) => PlatformMeta
  className?: string
  compact?: boolean
}) {
  if (!platforms.length) {
    return compact ? null : <p className={`text-[11px] text-[#A1A1AA] ${className}`}>Not posted anywhere yet</p>
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className={`text-[11px] ${compact ? 'text-[#16A34A]' : 'text-[#71717A]'}`}>{compact ? 'Posted:' : 'Already posted to'}</span>
      {platforms.map(p => {
        const m = platformMeta(p)
        return (
          <span key={p} title={m.label} className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-white" style={{ background: m.color }}>
            <span className="flex scale-[0.62] items-center justify-center">{m.icon}</span>
          </span>
        )
      })}
    </span>
  )
}

/** 9:16 thumbnail that only fetches its video once it scrolls near the screen. */
function Thumb({ src, className = '', ring = false, children }: { src: string | null; className?: string; ring?: boolean; children?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === 'undefined') { const t = setTimeout(() => setNear(true), 0); return () => clearTimeout(t) }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setNear(true); io.disconnect() }
    }, { rootMargin: '160px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={box}
      className={`relative aspect-[9/16] overflow-hidden bg-[#F0EFED] ${className}`}
      style={ring ? { outline: '2px solid #FF4F17', outlineOffset: 1 } : undefined}
    >
      {near && src ? (
        <video src={src} preload="metadata" muted playsInline tabIndex={-1} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[#C4C0BB]" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </div>
      )}
      {children}
    </div>
  )
}
