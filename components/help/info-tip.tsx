'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsClient } from '@/components/use-is-client'

const WIDTH = 272
const MARGIN = 12

/** A small "?" next to a label that opens a plain-language explanation.
 *  Tap or click to open; tap outside, scroll, or Escape to close. The bubble
 *  is portalled and clamped to the viewport so it never runs off a phone
 *  screen or gets clipped by a card's overflow. */
export function InfoTip({ title, children, label }: { title?: string; children: React.ReactNode; label?: string }) {
  const isClient = useIsClient()
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const id = useId()

  function toggle(e: React.MouseEvent) {
    // Tips often sit inside clickable cards and labels — don't trigger those.
    e.preventDefault()
    e.stopPropagation()
    if (pos) { setPos(null); return }
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(WIDTH, window.innerWidth - MARGIN * 2)
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - width / 2), window.innerWidth - width - MARGIN)
    // Open upward when the button sits in the bottom third (e.g. above the phone nav bar).
    const above = r.bottom > window.innerHeight * 0.66
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above })
  }

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    function onPointer(e: PointerEvent) {
      const t = e.target as Node
      if (bubbleRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); buttonRef.current?.focus() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label ?? (title ? `What is "${title}"?` : 'More info')}
        aria-expanded={!!pos}
        aria-controls={pos ? id : undefined}
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border text-[10px] font-bold leading-none align-middle flex-shrink-0 transition-colors cursor-pointer"
        style={{
          borderColor: pos ? '#FF4F17' : '#D4D4D0',
          color: pos ? '#FF4F17' : '#A1A1AA',
          background: pos ? '#FFF3EF' : 'white',
        }}
      >
        ?
      </button>
      {isClient && pos && createPortal(
        <div
          ref={bubbleRef}
          id={id}
          role="note"
          className="fixed animate-fadeIn rounded-xl px-3.5 py-3 text-left shadow-xl"
          style={{
            top: pos.top,
            left: pos.left,
            width: Math.min(WIDTH, window.innerWidth - MARGIN * 2),
            transform: pos.above ? 'translateY(-100%)' : undefined,
            background: '#18181B',
            zIndex: 10001,
          }}
        >
          {title && <p className="text-[12px] font-semibold text-white mb-1">{title}</p>}
          <div className="text-[12px] leading-relaxed text-[#D4D4D8] space-y-1.5">{children}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
