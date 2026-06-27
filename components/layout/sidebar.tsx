'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ConfirmModal } from '@/components/confirm-modal'

const NAV = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/ideas/new',
    label: 'New Idea',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
    requiresSetup: true,
  },
  {
    href: '/review',
    label: 'Review',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    href: '/library',
    label: 'Library',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    href: '/edit',
    label: 'Edit',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3L14.5 4z" />
        <circle cx="12" cy="13" r="3" />
      </svg>
    ),
  },
  {
    href: '/publish',
    label: 'Publish',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    ),
  },
]

const COMING_NAV: typeof NAV = []

export function Sidebar({ hasSettings = false }: { hasSettings?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [showSignOut, setShowSignOut] = useState(false)

  async function doSignOut() {
    setShowSignOut(false)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
    <aside
      className="hidden md:flex flex-col w-56 h-screen sticky top-0 bg-white"
      style={{ borderRight: '1px solid #EDECEA' }}
    >
      {/* Wordmark */}
      <div className="px-5 pt-6 pb-6">
        <Link href="/dashboard" className="flex items-center gap-2.5 group">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-opacity group-hover:opacity-85"
            style={{ background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)' }}
          >
            {/* Olympus mountain peak */}
            <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
              <path d="M9 1 L17 15 L1 15 Z" fill="white" />
              <path d="M9 1 L13.5 9 L4.5 9 Z" fill="url(#sg)" fillOpacity="0.35" />
              <defs>
                <linearGradient id="sg" x1="9" y1="1" x2="9" y2="9" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#FFB380" />
                  <stop offset="100%" stopColor="#FF4F17" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="flex flex-col leading-none">
            <div className="flex items-baseline gap-1">
              <span
                className="font-bold text-[#111111] text-[13px] tracking-tight"
                style={{ fontFamily: 'var(--font-jakarta)' }}
              >
                Olympus
              </span>
              <span className="text-[9px] font-light" style={{ color: '#D0CCC8' }}>|</span>
              <span className="text-[9px] font-semibold tracking-[0.05em] uppercase" style={{ color: '#FF4F17', letterSpacing: '0.06em' }}>
                AI Creator
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-3 overflow-y-auto">

        {/* Main nav */}
        <div className="mb-1">
          <p className="px-3 mb-1.5 text-[9px] font-semibold uppercase tracking-[0.13em]" style={{ color: '#C4C0BB' }}>
            Content engine
          </p>
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const locked = item.requiresSetup && !hasSettings

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'relative flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150',
                  locked
                    ? 'text-[#CCCAC7]'
                    : active
                    ? 'bg-[#FFF4F1] text-[#FF4F17]'
                    : 'text-[#5A5A57] hover:bg-[#F7F5F3] hover:text-[#1A1A18]',
                ].join(' ')}
              >
                {active && !locked && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-[18px] bg-[#FF4F17] rounded-r-full" />
                )}
                <span className="flex-shrink-0" style={{ opacity: locked ? 0.6 : 1 }}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {locked && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" style={{ color: '#CCCAC7' }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </Link>
            )
          })}
        </div>


      </nav>

      {/* Bottom */}
      <div className="px-3 pb-5 pt-4" style={{ borderTop: '1px solid #F0EFED' }}>
        {/* Settings */}
        {(() => {
          const active = pathname === '/settings'
          return (
            <Link
              href="/settings"
              className={[
                'relative flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all duration-150',
                active ? 'bg-[#FFF4F1] text-[#FF4F17]' : 'text-[#5A5A57] hover:bg-[#F7F5F3] hover:text-[#1A1A18]',
              ].join(' ')}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-[18px] bg-[#FF4F17] rounded-r-full" />
              )}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className="flex-1">Settings</span>
              {!hasSettings && (
                <span className="flex-shrink-0 text-[9px] font-bold tracking-wide" style={{ color: '#FF4F17' }}>
                  SET UP
                </span>
              )}
            </Link>
          )
        })()}

        {/* Sign out */}
        <button
          onClick={() => setShowSignOut(true)}
          className="w-full mt-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-150"
          style={{
            border: '1px solid #E8E4DF',
            color: '#9B9794',
            background: 'transparent',
          }}
          onMouseEnter={e => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.borderColor = '#FECACA'
            btn.style.color = '#EF4444'
            btn.style.background = '#FEF2F2'
          }}
          onMouseLeave={e => {
            const btn = e.currentTarget as HTMLButtonElement
            btn.style.borderColor = '#E8E4DF'
            btn.style.color = '#9B9794'
            btn.style.background = 'transparent'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>

    <ConfirmModal
      open={showSignOut}
      title="Sign out"
      message="Sign out of Olympus?"
      confirmLabel="Sign out"
      danger
      onConfirm={doSignOut}
      onCancel={() => setShowSignOut(false)}
    />
    </>
  )
}
