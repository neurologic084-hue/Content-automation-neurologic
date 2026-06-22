'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const TOUR_KEY = 'reel_tour_v1'

const STEPS = [
  {
    selector: 'a[href="/dashboard"]',
    title: 'Dashboard',
    body: 'Your overview. See your stats, pick up where you left off, and track your content pipeline at a glance.',
  },
  {
    selector: 'a[href="/ideas/new"]',
    title: 'New Idea',
    body: 'Where every script starts. Type a rough topic or let AI generate 10 ideas from your brand profile. Takes 30 seconds.',
  },
  {
    selector: 'a[href="/review"]',
    title: 'Review',
    body: 'Scripts waiting for your decision. Read the hook, body and CTA — approve what works, request a revision, or skip it.',
  },
  {
    selector: 'a[href="/library"]',
    title: 'Library',
    body: 'Every script you have approved, organised by audience. The more you approve, the smarter future scripts get.',
  },
  {
    selector: 'a[href="/settings"]',
    title: 'Settings',
    body: 'Your brand voice. Fill this in once — identity, tone, offerings, ideal client. It trains every script Olympus writes forever.',
  },
]

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

type Phase = 'welcome' | 'tour'

export function TourModal() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('welcome')
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState<HighlightRect | null>(null)

  useEffect(() => {
    try {
      if (!localStorage.getItem(TOUR_KEY)) setVisible(true)
    } catch {}
  }, [])

  // Measure the target nav element whenever step changes
  useEffect(() => {
    if (!visible || phase !== 'tour') return
    function measure() {
      const el = document.querySelector(STEPS[step].selector)
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [visible, phase, step])

  function dismiss() {
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
    setVisible(false)
  }

  function startTour() {
    setPhase('tour')
    setStep(0)
  }

  function next() {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1)
    } else {
      dismiss()
      router.push('/settings')
    }
  }

  if (!visible) return null

  // ── Welcome slide ──────────────────────────────────────────────
  if (phase === 'welcome') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(6px)' }}
      >
        <div
          className="w-full max-w-md bg-white rounded-3xl overflow-hidden"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}
        >
          <div className="px-8 pt-8 pb-6">
            <div className="flex items-start justify-between mb-6">
              <p className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: '#FF4F17' }}>
                WELCOME TO OLYMPUS
              </p>
              <button
                onClick={dismiss}
                className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: '#F4F3F0', color: '#9B9B97' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)', boxShadow: '0 0 20px rgba(255,79,23,0.3)' }}
            >
              <svg width="32" height="28" viewBox="0 0 18 16" fill="none">
                <path d="M9 1 L17 15 L1 15 Z" fill="white" />
                <path d="M9 1 L13.5 9 L4.5 9 Z" fill="white" fillOpacity="0.28" />
              </svg>
            </div>

            <h2
              className="text-[22px] font-bold text-[#111111] leading-snug mb-3"
              style={{ fontFamily: 'var(--font-jakarta)' }}
            >
              Take the guided tour?
            </h2>
            <p className="text-[15px] leading-relaxed" style={{ color: '#6B6B68' }}>
              A quick walkthrough of every page — what it does and how to use it. Go at your own pace, leave any time.
            </p>
          </div>

          <div style={{ height: 1, background: '#F0EFED' }} />

          <div className="px-8 py-5 flex items-center justify-between">
            <button
              onClick={dismiss}
              className="px-4 py-2 rounded-xl text-[13px] font-medium border cursor-pointer"
              style={{ borderColor: '#E4E0DA', color: '#9B9B97' }}
            >
              Maybe later
            </button>
            <button
              onClick={startTour}
              className="px-6 py-2.5 rounded-xl text-[13px] font-semibold text-white cursor-pointer"
              style={{ background: '#111111', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}
            >
              Start tour →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Nav tour ───────────────────────────────────────────────────
  if (!rect) return null

  const PAD = 5
  const SIDEBAR_W = 224 // w-56
  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  // Keep tooltip vertically centred on the nav item, clamped to viewport
  const tooltipTop = Math.min(
    Math.max(rect.top + rect.height / 2 - 90, 16),
    window.innerHeight - 220
  )

  return (
    <>
      {/* Spotlight highlight — box-shadow creates the overlay */}
      <div
        style={{
          position: 'fixed',
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          borderRadius: 10,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.42)',
          outline: '2px solid rgba(255,79,23,0.7)',
          zIndex: 50,
          pointerEvents: 'none',
          transition: 'top 0.2s ease, height 0.2s ease',
        }}
      />

      {/* Tooltip card */}
      <div
        style={{
          position: 'fixed',
          top: tooltipTop,
          left: SIDEBAR_W + 18,
          width: 288,
          zIndex: 51,
          transition: 'top 0.2s ease',
        }}
      >
        {/* Arrow pointing left */}
        <div
          style={{
            position: 'absolute',
            left: -7,
            top: 26,
            width: 0,
            height: 0,
            borderTop: '7px solid transparent',
            borderBottom: '7px solid transparent',
            borderRight: '7px solid white',
            filter: 'drop-shadow(-2px 0 2px rgba(0,0,0,0.06))',
          }}
        />

        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.16)' }}
        >
          <div className="px-5 pt-5 pb-4">
            <p
              className="text-[9px] font-bold tracking-[0.13em] uppercase mb-2"
              style={{ color: '#FF4F17' }}
            >
              {step + 1} of {STEPS.length}
            </p>
            <h3
              className="text-[17px] font-bold text-[#111111] mb-1.5"
              style={{ fontFamily: 'var(--font-jakarta)' }}
            >
              {current.title}
            </h3>
            <p className="text-[13px] leading-relaxed" style={{ color: '#6B6B68' }}>
              {current.body}
            </p>
          </div>

          <div style={{ height: 1, background: '#F0EFED' }} />

          <div className="px-5 py-3.5 flex items-center justify-between">
            {/* Progress dots */}
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: i === step ? 14 : 5,
                    height: 5,
                    background: i === step ? '#FF4F17' : '#E4E0DA',
                  }}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={dismiss}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer"
                style={{ color: '#A09D9A' }}
              >
                Skip
              </button>
              <button
                onClick={next}
                className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white cursor-pointer"
                style={{ background: '#111111' }}
              >
                {isLast ? 'Done →' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
