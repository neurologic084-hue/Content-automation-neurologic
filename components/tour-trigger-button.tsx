'use client'

import { useState } from 'react'
import { TOUR_KEY, TourModal } from './tour-modal'

export function TourTriggerButton() {
  const [open, setOpen] = useState(false)

  function handleClick() {
    try { localStorage.removeItem(TOUR_KEY) } catch {}
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer"
        style={{ background: '#F4F3F0', color: '#71717A' }}
        onMouseEnter={e => {
          const b = e.currentTarget as HTMLButtonElement
          b.style.background = '#EDECEA'
          b.style.color = '#18181B'
        }}
        onMouseLeave={e => {
          const b = e.currentTarget as HTMLButtonElement
          b.style.background = '#F4F3F0'
          b.style.color = '#71717A'
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        Take the tour
      </button>

      {open && <TourModal forceOpen onClose={() => setOpen(false)} />}
    </>
  )
}
