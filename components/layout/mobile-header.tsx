'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ConfirmModal } from '@/components/confirm-modal'

// Mobile-only top bar.
//
// The sidebar owns Sign out, Settings and the active-profile readout — but it's
// `hidden md:flex`, and the bottom nav is page links only. That left phones with
// NO way to sign out at all and no sign of which profile was active. This puts
// both one tap away on small screens; desktop is untouched.
export function MobileHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showSignOut, setShowSignOut] = useState(false)
  const [profileName, setProfileName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      const { data } = await createClient()
        .from('brand_settings')
        .select('creator_name')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (!cancelled && data?.creator_name?.trim()) setProfileName(data.creator_name)
    }
    loadProfile()
    return () => { cancelled = true }
  }, [])

  // Navigating away should never leave the sheet hanging over the new page.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  async function doSignOut() {
    setShowSignOut(false)
    setMenuOpen(false)
    await createClient().auth.signOut()
    router.push('/login')
  }

  const initial = (profileName?.trim()?.[0] ?? 'O').toUpperCase()

  return (
    <>
      <header
        className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 h-14 bg-white/95 border-b border-[#EDECEA]"
        style={{ backdropFilter: 'blur(12px)' }}
      >
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
          <span
            className="text-[15px] font-bold text-[#18181B] truncate"
            style={{ fontFamily: 'var(--font-jakarta)' }}
          >
            Olympus
          </span>
          {profileName && (
            <span className="text-[11px] text-[#A1A1AA] truncate max-w-[38vw]">· {profileName}</span>
          )}
        </Link>

        {/* 44px touch target — the bar's whole reason for existing is reachability */}
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Account menu"
          aria-expanded={menuOpen}
          className="w-11 h-11 -mr-2 rounded-xl flex items-center justify-center cursor-pointer active:bg-[#F4F3F0] transition-colors"
        >
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold text-white"
            style={{ background: '#FF4F17' }}
          >
            {initial}
          </span>
        </button>
      </header>

      {/* Bottom sheet — thumb-reachable, unlike a top dropdown */}
      {menuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex items-end animate-fadeIn"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-4 pb-8 animate-fadeInUp"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-[#E4E4E0] mx-auto mb-4" />

            {profileName && (
              <div className="px-4 pb-3 mb-2 border-b border-[#F2F2EF]">
                <p className="text-[11px] font-semibold text-[#A1A1AA] uppercase tracking-widest mb-0.5">Signed in as</p>
                <p className="text-[15px] font-semibold text-[#18181B] truncate">{profileName}</p>
              </div>
            )}

            <Link
              href="/settings"
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-[15px] text-[#18181B] active:bg-[#F4F3F0] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </Link>

            <button
              onClick={() => setShowSignOut(true)}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-[15px] text-[#EF4444] active:bg-[#FEF2F2] transition-colors cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sign out
            </button>

            <button
              onClick={() => setMenuOpen(false)}
              className="w-full mt-2 py-3.5 rounded-2xl text-[15px] font-medium text-[#71717A] active:bg-[#F4F3F0] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showSignOut}
        title="Sign out"
        message="Sign out of Olympus?"
        confirmLabel="Sign out"
        cancelLabel="Stay"
        danger
        onConfirm={doSignOut}
        onCancel={() => setShowSignOut(false)}
      />
    </>
  )
}
