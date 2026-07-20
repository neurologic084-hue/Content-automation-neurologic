'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Detects the broken-session state and resets it, instead of letting every
// page hang. Seen in production twice: the server-side cookie still passes the
// proxy (so the shell renders), but the BROWSER client's refresh token is dead
// — its auto-refresh fails, and from then on every client-side query awaits a
// session that never comes. New Idea, Settings, Publish: all spin forever,
// and the only cure was knowing to sign out by hand.
//
// The probe validates the session against the server once per mount. Three
// outcomes:
//   - valid           → do nothing (the common case, costs one request)
//   - explicit auth
//     failure         → sign out and land on /login with a clean slate
//   - hangs past 8s   → same reset; a hung auth call IS the broken state
// A transient network error does NOT reset — signing someone out because
// their wifi blipped would be worse than the bug.
export function SessionGuard() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    const reset = () => {
      if (cancelled) return
      cancelled = true
      // Local scope: clear this browser's tokens even if the server call
      // can't be reached, then start over at login.
      supabase.auth.signOut({ scope: 'local' }).finally(() => router.replace('/login'))
    }

    ;(async () => {
      const verdict = await Promise.race([
        supabase.auth.getUser()
          .then(({ data, error }) => {
            if (data?.user) return 'ok' as const
            // AuthApiError (invalid/expired refresh token) is the state we
            // exist to catch. A fetch-level failure is just bad network.
            return error && error.name !== 'AuthRetryableFetchError' ? 'broken' as const : 'unknown' as const
          })
          .catch(() => 'unknown' as const),
        new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 8_000)),
      ])
      if (verdict === 'broken' || verdict === 'hung') reset()
    })()

    return () => { cancelled = true }
  }, [router])

  return null
}
