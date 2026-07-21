import { NextResponse } from 'next/server'
import os from 'os'
import { containerCores, containerMemoryGb, renderSlots, renderConcurrency } from '@/lib/motion-renderer'

// Railway's healthcheck target. Deliberately shallow: it answers "this
// container is serving" and nothing more.
//
// It must NOT check Supabase or R2. A container that is up but briefly cannot
// reach Supabase should keep serving — failing the healthcheck would make
// Railway restart it, killing any render running in-process and turning a
// transient upstream blip into lost work.
export const dynamic = 'force-dynamic'

export function GET() {
  // Report the HOST numbers (what os sees) next to the CONTAINER numbers (the
  // cgroup limit the kernel actually enforces) and the render plan derived from
  // them. In a container these diverge hard — a Railway box shows 48 host cores
  // while the container is capped near 24GB — and sizing renders off the host
  // would OOM the container. Seeing both confirms the sizing uses the real cap.
  const slots = renderSlots()
  return NextResponse.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    host: { cores: os.cpus().length, memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10 },
    container: { cores: containerCores(), memoryGb: Math.round(containerMemoryGb() * 10) / 10 },
    render: { concurrentRenders: slots, tabsPerRender: renderConcurrency(), variantsPerWave: slots },
  })
}
