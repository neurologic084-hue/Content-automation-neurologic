import { NextResponse } from 'next/server'
import os from 'os'

// Railway's healthcheck target. Deliberately shallow: it answers "this
// container is serving" and nothing more.
//
// It must NOT check Supabase or R2. A container that is up but briefly cannot
// reach Supabase should keep serving — failing the healthcheck would make
// Railway restart it, killing any render running in-process and turning a
// transient upstream blip into lost work.
export const dynamic = 'force-dynamic'

export function GET() {
  // Machine shape is reported so the render sizing can be checked against the
  // box actually paid for — the render tab count and how many renders run at
  // once are both derived from these numbers, so seeing them is the fastest
  // way to tell whether capacity is being left on the table.
  return NextResponse.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    cores: os.cpus().length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
  })
}
