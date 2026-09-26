'use client'

import Link from 'next/link'
import { useSyncExternalStore } from 'react'
import { PAGE_GUIDES, type PageGuideKey } from './guide-content'

// Hidden/shown is remembered per page in localStorage and read as an external
// store: the server and hydration pass render the collapsed pill, so a guide
// she has hidden never flashes open on load.
const CHANGE_EVENT = 'olympus-guide-change'
const storageKey = (page: PageGuideKey) => `olympus_guide_${page}`

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

function setHidden(page: PageGuideKey, hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(storageKey(page), 'hidden')
    else localStorage.removeItem(storageKey(page))
  } catch { /* private mode: the toggle just won't persist */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** "How this page works" card shown at the top of a page. Open until she
 *  hides it; a small pill brings it back. Copy lives in guide-content.ts. */
export function PageGuide({ page, className = 'mb-6' }: { page: PageGuideKey; className?: string }) {
  const guide = PAGE_GUIDES[page]
  const state = useSyncExternalStore(
    subscribe,
    () => { try { return localStorage.getItem(storageKey(page)) === 'hidden' ? 'hidden' : 'open' } catch { return 'open' } },
    () => 'hidden',
  )

  if (state === 'hidden') {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setHidden(page, false)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E4E4E0] bg-white px-3 py-1.5 text-xs font-medium text-[#71717A] transition-colors hover:border-[#FFD4C4] hover:text-[#FF4F17] cursor-pointer"
        >
          <HelpIcon />
          How this page works
        </button>
      </div>
    )
  }

  return (
    <section
      aria-labelledby={`guide-${page}`}
      className={`${className} animate-fadeIn rounded-2xl border p-4 sm:p-5`}
      style={{ borderColor: '#FBE3D8', background: '#FFFAF7' }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-[#FF4F17]" style={{ background: '#FFEDE5' }}>
          <HelpIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#FF4F17]">How this page works</p>
          <h2 id={`guide-${page}`} className="mt-0.5 text-[15px] font-semibold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
            {guide.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setHidden(page, true)}
          className="-mr-1 -mt-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-white hover:text-[#18181B] cursor-pointer"
        >
          Hide
        </button>
      </div>

      <ol className={`mt-4 grid gap-3 ${guide.steps.length > 3 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {guide.steps.map((s, i) => (
          <li key={s.title} className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#FF4F17] text-[10px] font-bold text-white">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#18181B]">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-[#71717A]">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      {guide.tip && (
        <p className="mt-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs leading-relaxed text-[#92400E]">
          <span className="font-semibold">Good to know: </span>
          {guide.tip}
        </p>
      )}

      <Link
        href={`/guide#${guide.anchor}`}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#FF4F17] hover:underline"
      >
        Read the full guide
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </Link>
    </section>
  )
}

export function HelpIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}
