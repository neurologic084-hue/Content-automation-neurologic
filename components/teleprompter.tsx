'use client'

import { useEffect, useRef, useState } from 'react'

// Full-screen teleprompter for filming: the script scrolls at a set pace, with
// an optional read-aloud so she can hear the timing rather than guess it.
//
// The scroll and the audio are deliberately INDEPENDENT. Syncing text to speech
// needs word-level timings, and a sync that drifts is worse than none — you
// stop trusting it mid-take. Speed is hers to set; the voice is a reference.
interface Props {
  scriptId: string
  hook: string
  body: string
  cta: string
  onClose: () => void
}

const WPM_MIN = 80
const WPM_MAX = 200
const WPM_DEFAULT = 130   // unhurried spoken-video pace

export function Teleprompter({ scriptId, hook, body, cta, onClose }: Props) {
  const [wpm, setWpm] = useState(WPM_DEFAULT)
  const [running, setRunning] = useState(false)
  const [mirrored, setMirrored] = useState(false)
  const [voice, setVoice] = useState<'female' | 'male'>('female')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loadingAudio, setLoadingAudio] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const text = [hook, body, cta].filter(Boolean).join('\n\n')
  const words = text.trim().split(/\s+/).length

  // Scroll by pixels-per-second derived from words-per-minute: measure the real
  // rendered height so the pace holds for a long script and a short one alike.
  useEffect(() => {
    if (!running) return
    const el = scrollRef.current
    if (!el) return
    const totalPx = el.scrollHeight - el.clientHeight
    if (totalPx <= 0) return
    const seconds = (words / wpm) * 60
    const pxPerTick = totalPx / seconds / 20   // 20 ticks a second
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last >= 50) {
        last = t
        el.scrollTop += pxPerTick
        if (el.scrollTop >= totalPx - 1) setRunning(false)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running, wpm, words])

  // Esc closes; space starts/stops without hunting for the button mid-take.
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.code === 'Space') { e.preventDefault(); setRunning(r => !r) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  async function loadVoice() {
    if (loadingAudio) return
    setLoadingAudio(true)
    setAudioError(null)
    try {
      const res = await fetch(`/api/scripts/${scriptId}/voiceover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not create the voice reading.')
      setAudioUrl(d.url)
      // Give the element a tick to pick up the new src before playing.
      setTimeout(() => audioRef.current?.play().catch(() => {}), 50)
    } catch (e) {
      setAudioError((e as Error).message)
    } finally {
      setLoadingAudio(false)
    }
  }

  function restart() {
    setRunning(false)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 flex-shrink-0">
        <span className="text-[13px] font-semibold">Teleprompter</span>
        <button onClick={onClose} className="text-[13px] text-white/60 hover:text-white px-3 py-1.5">
          Close (Esc)
        </button>
      </div>

      {/* The reading line — a fixed marker so her eyeline stays put. */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute left-0 right-0 top-1/3 h-px bg-[#FF4F17]/40 z-10 pointer-events-none" />
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto px-6 sm:px-16 scroll-smooth"
          style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
        >
          {/* Padding so the first line starts at the marker and the last can reach it. */}
          <div style={{ paddingTop: '33vh', paddingBottom: '66vh' }}>
            <p className="text-[26px] sm:text-[38px] leading-[1.5] font-semibold whitespace-pre-wrap text-center">
              {text}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 px-5 py-4 space-y-3 flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setRunning(r => !r)}
            className="px-5 py-2.5 rounded-xl bg-[#FF4F17] text-white text-[13px] font-semibold min-w-[104px]"
          >
            {running ? 'Pause' : 'Start'}
          </button>
          <button onClick={restart} className="px-4 py-2.5 rounded-xl border border-white/20 text-[13px]">
            Restart
          </button>
          <button
            onClick={() => setMirrored(m => !m)}
            className={`px-4 py-2.5 rounded-xl border text-[13px] ${mirrored ? 'border-[#FF4F17] text-[#FF4F17]' : 'border-white/20'}`}
            title="For a teleprompter mirror rig"
          >
            Mirror
          </button>
          <span className="text-[11px] text-white/40">Space = start/pause</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] text-white/50 w-16">Speed</span>
          <input
            type="range" min={WPM_MIN} max={WPM_MAX} step={5} value={wpm}
            onChange={e => setWpm(Number(e.target.value))}
            className="flex-1 accent-[#FF4F17]"
          />
          <span className="text-[11px] text-white/70 w-24 text-right tabular-nums">
            {wpm} wpm · {Math.round((words / wpm) * 60)}s
          </span>
        </div>

        {/* Read-aloud. Generated only on press — it costs ElevenLabs characters. */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] text-white/50 w-16">Voice</span>
          <div className="flex gap-1.5">
            {(['female', 'male'] as const).map(v => (
              <button
                key={v}
                onClick={() => { setVoice(v); setAudioUrl(null) }}
                className={`px-3 py-1.5 rounded-lg text-[12px] border capitalize ${
                  voice === v ? 'border-[#FF4F17] text-[#FF4F17]' : 'border-white/20 text-white/70'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          {audioUrl ? (
            <audio ref={audioRef} src={audioUrl} controls className="h-9 flex-1 min-w-[220px]" />
          ) : (
            <button
              onClick={loadVoice}
              disabled={loadingAudio}
              className="px-4 py-2 rounded-xl border border-white/20 text-[12px] disabled:opacity-50"
            >
              {loadingAudio ? 'Creating the read…' : 'Hear it read aloud'}
            </button>
          )}
        </div>
        {audioError && <p className="text-[12px] text-[#FCA5A5]">{audioError}</p>}
      </div>
    </div>
  )
}
