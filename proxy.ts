import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Retirement signpost: the app moved to Railway, but the old Vercel URL
  // survives in bookmarks. Anyone opening it would silently use the retired
  // deployment — same database, but renders on the slow ephemeral path with
  // the 300s kill this codebase spent a day rooting out. When MIGRATED_APP_URL
  // is set, every request forwards to the new home BEFORE auth even runs.
  //
  // Env-gated on purpose: set the variable ONLY on the Vercel project, so this
  // is inert on Railway and in local dev, and the forwarding address can change
  // without a code deploy. 307 (temporary), never 308 — browsers cache
  // permanent redirects so hard that the rollback week (unpause Vercel, point
  // DNS back) would strand anyone who had visited once.
  const migrated = process.env.MIGRATED_APP_URL
  if (migrated) {
    const dest = new URL(request.nextUrl.pathname + request.nextUrl.search, migrated)
    return NextResponse.redirect(dest, 307)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes — no auth check needed
  if (pathname.startsWith('/login') || pathname.startsWith('/onboarding')) {
    return supabaseResponse
  }

  // Cron routes are invoked by Vercel's scheduler, which carries no Supabase
  // session — they authenticate themselves via CRON_SECRET (checked in the
  // route) and only sweep internal state, never spend money.
  if (pathname.startsWith('/api/cron/')) {
    return supabaseResponse
  }

  // API routes: every endpoint spends money (LLM, Tavily, Blotato, Submagic)
  // or takes actions on connected accounts — none are public. Return 401 JSON
  // instead of a login redirect so client fetch() calls fail loudly.
  if (pathname.startsWith('/api')) {
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    return supabaseResponse
  }

  // Redirect unauthenticated users to login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|renders|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)',
  ],
}
