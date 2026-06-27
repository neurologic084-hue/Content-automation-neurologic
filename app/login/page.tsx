'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Incorrect email or password. Try again.')
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-dvh flex flex-col md:flex-row">

      {/* ── Left panel   dark brand ── */}
      <div
        className="relative flex flex-col justify-between p-10 md:w-1/2 md:min-h-screen overflow-hidden"
        style={{ background: '#0D0D0D' }}
      >
        {/* Subtle radial glow behind logo */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            width: 480,
            height: 480,
            background: 'radial-gradient(circle, rgba(255,79,23,0.12) 0%, transparent 70%)',
          }}
        />

        {/* Film-strip side dots */}
        <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-around items-center py-8 pointer-events-none">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="rounded-sm flex-shrink-0"
              style={{ width: 18, height: 13, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}
            />
          ))}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-10 flex flex-col justify-around items-center py-8 pointer-events-none">
          {Array.from({ length: 14 }).map((_, i) => (
            <div
              key={i}
              className="rounded-sm flex-shrink-0"
              style={{ width: 18, height: 13, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}
            />
          ))}
        </div>

        <div />

        {/* Center   hero */}
        <div className="relative z-10 flex flex-col items-center text-center px-6">
          {/* Logo icon */}
          <div
            className="mb-8 flex items-center justify-center rounded-[28px]"
            style={{
              width: 100,
              height: 100,
              background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 24px 48px rgba(255,79,23,0.4)',
            }}
          >
            {/* Olympus mountain peak */}
            <svg width="54" height="48" viewBox="0 0 54 48" fill="none">
              <path d="M27 2 L52 46 L2 46 Z" fill="white" />
              <path d="M27 2 L40.5 27 L13.5 27 Z" fill="url(#lg)" fillOpacity="0.32" />
              <defs>
                <linearGradient id="lg" x1="27" y1="2" x2="27" y2="27" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#FFB380" />
                  <stop offset="100%" stopColor="#FF4F17" />
                </linearGradient>
              </defs>
            </svg>
          </div>

          <div className="flex items-baseline gap-2.5 justify-center mb-2">
            <h1
              className="text-white font-extrabold tracking-tight"
              style={{ fontSize: 36, fontFamily: 'var(--font-jakarta)', lineHeight: 1.1 }}
            >
              Olympus
            </h1>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 22, fontWeight: 200, lineHeight: 1 }}>|</span>
            <span
              className="font-semibold tracking-widest uppercase"
              style={{ fontSize: 10, color: '#FF6B3D', letterSpacing: '0.2em', lineHeight: 1 }}
            >
              AI Script Engine
            </span>
          </div>

          {/* Divider with label */}
          <div className="flex items-center gap-3 my-8 w-full max-w-xs">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <span
              className="text-xs tracking-widest font-semibold uppercase"
              style={{ color: 'rgba(255,255,255,0.25)', letterSpacing: '2px' }}
            >
              Creator Portal
            </span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
          </div>

          {/* Feature bullets */}
          <div className="space-y-2.5 text-center">
            {[
              'Turn any idea into a full short-form script',
              'AI picks the audience · you approve in seconds',
              'Every approval trains your voice',
            ].map((line) => (
              <p key={line} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                {line}
              </p>
            ))}
          </div>
        </div>

        {/* Bottom   phase label */}
        <div className="relative z-10 text-center">
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, letterSpacing: '0.5px' }}>
            Phase 1 · Script Engine
          </p>
        </div>
      </div>

      {/* ── Right panel   form ── */}
      <div className="flex-1 flex items-center justify-center bg-[#FAFAF9] p-8 md:p-12">
        <div className="w-full max-w-sm">

          <div className="mb-10">
            <h2
              className="font-bold text-[#18181B] mb-2"
              style={{ fontSize: 28, fontFamily: 'var(--font-jakarta)', letterSpacing: '-0.5px' }}
            >
              Welcome back
            </h2>
            <p className="text-sm text-[#71717A]">Sign in to your content engine</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#18181B] mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jessica@yourclinic.com"
                autoComplete="email"
                required
                className="w-full px-4 py-3 rounded-xl border bg-white text-[#18181B] text-sm placeholder:text-[#C4C4C0] transition-all"
                style={{
                  borderColor: '#E4E4E0',
                  outline: 'none',
                  boxShadow: 'none',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#FF4F17'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,79,23,0.1)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#E4E4E0'; e.currentTarget.style.boxShadow = 'none' }}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-sm font-medium text-[#18181B]">
                  Password
                </label>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 pr-12 rounded-xl border bg-white text-[#18181B] text-sm placeholder:text-[#C4C4C0] transition-all"
                  style={{ borderColor: '#E4E4E0', outline: 'none' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#FF4F17'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,79,23,0.1)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#E4E4E0'; e.currentTarget.style.boxShadow = 'none' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 transition-colors cursor-pointer"
                  style={{ color: '#A1A1AA' }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full py-3.5 px-4 rounded-xl text-white text-sm font-semibold transition-all duration-150 cursor-pointer disabled:cursor-not-allowed"
              style={{
                background: loading || !email.trim() || !password.trim() ? '#FFBBA8' : '#FF4F17',
                boxShadow: loading || !email.trim() || !password.trim() ? 'none' : '0 4px 16px rgba(255,79,23,0.3)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs" style={{ color: '#C4C4C0' }}>
            Access is invite-only. Contact your setup team if you need help.
          </p>
        </div>
      </div>

    </div>
  )
}
