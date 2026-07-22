'use client'

import { useEffect, useRef, useState } from 'react'

// Filming teleprompter. Built for a PHONE first — that is the device propped up
// next to the camera, and it is the one with a screen that sleeps, a notch, and
// no keyboard. Everything here follows from that:
//
//   • a wake lock, so the screen does not sleep mid-take
//   • tap the script itself to start/pause — no hunting for a small button
//     while standing in frame
//   • controls sit at the BOTTOM, inside the safe area, within thumb reach
//   • text size is adjustable, because reading distance is not fixed
//
// No read-aloud: this is for reading from, and generated audio was an ongoing
// bill for something she does not need while filming.
interface Props {
  hook: string
  body: string
  cta: string
  onClose: () => void
}

const WPM_MIN = 70
const WPM_MAX = 200
const WPM_DEFAULT = 130   // unhurried spoken-video pace
const SIZE_MIN = 20
const SIZE_MAX = 56

export function Teleprompter({ hook, body, cta, onClose }: Props) {
  const [wpm, setWpm] = useState(WPM_DEFAULT)
  const [size, setSize] = useState(32)
  const [running, setRunning] = useState(false)
  const [mirrored, setMirrored] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const text = [hook, body, cta].filter(Boolean).join('\n\n')
  const words = text.trim().split(/\s+/).length
  const seconds = Math.round((words / wpm) * 60)

  // Keep the screen awake while filming. Without this the phone dims and locks
  // mid-take, which is the single most annoying way for a prompter to fail.
  // Re-acquired on visibility change because the lock is dropped when the tab
  // is hidden. Unsupported browsers simply carry on.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen')
        }
      } catch { /* denied or unsupported — not worth telling her about */ }
    }
    void acquire()
    const onVis = () => { if (!cancelled && document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      void lock?.release().catch(() => {})
    }
  }, [])

  // Scroll at a pace derived from words-per-minute, measured against the real
  // rendered height so it holds for a long script and a short one alike.
  useEffect(() => {
    if (!running) return
    const el = scrollRef.current
    if (!el) return
    const totalPx = el.scrollHeight - el.clientHeight
    if (totalPx <= 0) return
    const pxPerMs = totalPx / (seconds * 1000)
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = t - last
      last = t
      el.scrollTop += pxPerMs * dt
      if (el.scrollTop >= totalPx - 1) setRunning(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, seconds])

  // Desktop convenience; harmless on a phone.
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.code === 'Space') { e.preventDefault(); setRunning(r => !r) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  function restart() {
    setRunning(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black text-white flex flex-col overscroll-none"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Minimal top bar — every pixel here is script she cannot read. */}
      <div className="flex items-center justify-between px-4 py-2 flex-shrink-0">
        <button
          onClick={() => setShowSettings(s => !s)}
          className="w-11 h-11 -ml-1 flex items-center justify-center text-white/60 active:text-white"
          aria-label="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V12a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <span className="text-[12px] text-white/40 tabular-nums">{seconds}s · {wpm} wpm</span>
        <button
          onClick={onClose}
          className="w-11 h-11 -mr-1 flex items-center justify-center text-white/60 active:text-white"
          aria-label="Close"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* THE SCRIPT. Tapping anywhere on it starts/pauses — the whole point on a
          phone, where she is an arm's length away and cannot aim for a button. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute left-0 right-0 top-[30%] h-px bg-[#FF4F17]/50 z-10 pointer-events-none" />
        <div
          ref={scrollRef}
          onClick={() => setRunning(r => !r)}
          className="h-full overflow-y-auto px-5 sm:px-16 overscroll-none"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined, WebkitOverflowScrolling: 'touch' }}
        >
          <div style={{ paddingTop: '30vh', paddingBottom: '70vh' }}>
            <p
              className="font-semibold whitespace-pre-wrap text-center select-none"
              style={{ fontSize: `${size}px`, lineHeight: 1.45 }}
            >
              {text}
            </p>
          </div>
        </div>

        {/* Only shown while paused, so it never covers the script mid-take. */}
        {!running && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
            <span className="text-[12px] text-white/40 bg-black/60 rounded-full px-3 py-1.5">
              Tap the script to start
            </span>
          </div>
        )}
      </div>

      {/* Settings drawer — closed by default so the script owns the screen. */}
      {showSettings && (
        <div className="px-5 pb-3 space-y-3 flex-shrink-0 border-t border-white/10 pt-3">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-white/50 w-11">Speed</span>
            <input
              type="range" min={WPM_MIN} max={WPM_MAX} step={5} value={wpm}
              onChange={e => setWpm(Number(e.target.value))}
              className="flex-1 h-8 accent-[#FF4F17]"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-white/50 w-11">Size</span>
            <input
              type="range" min={SIZE_MIN} max={SIZE_MAX} step={2} value={size}
              onChange={e => setSize(Number(e.target.value))}
              className="flex-1 h-8 accent-[#FF4F17]"
            />
          </div>
          <button
            onClick={() => setMirrored(m => !m)}
            className={`w-full py-2.5 rounded-xl border text-[13px] ${mirrored ? 'border-[#FF4F17] text-[#FF4F17]' : 'border-white/20 text-white/70'}`}
          >
            Mirror {mirrored ? 'on' : 'off'}
          </button>
        </div>
      )}

      {/* Thumb-reach controls. 56px tall: comfortably tappable while standing
          back from a propped-up phone. */}
      <div className="flex items-stretch gap-2 px-4 pb-3 pt-2 flex-shrink-0">
        <button
          onClick={restart}
          className="w-16 rounded-2xl border border-white/20 text-white/70 active:bg-white/10 flex items-center justify-center"
          aria-label="Restart"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={() => setRunning(r => !r)}
          className="flex-1 h-14 rounded-2xl bg-[#FF4F17] text-white text-[15px] font-semibold active:opacity-90"
        >
          {running ? 'Pause' : 'Start'}
        </button>
      </div>
    </div>
  )
}
