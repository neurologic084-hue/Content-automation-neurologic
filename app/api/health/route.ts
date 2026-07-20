import { NextResponse } from 'next/server'

// Railway's healthcheck target. Deliberately shallow: it answers "this
// container is serving" and nothing more.
//
// It must NOT check Supabase or R2. A container that is up but briefly cannot
// reach Supabase should keep serving — failing the healthcheck would make
// Railway restart it, killing any render running in-process and turning a
// transient upstream blip into lost work.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ ok: true, uptime: Math.round(process.uptime()) })
}
