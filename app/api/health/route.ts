import { NextResponse } from 'next/server'
import os from 'os'
import fs from 'fs'
import { rendersRoot } from '@/lib/paths'
import { containerCores, containerMemoryGb, renderSlots, renderConcurrency } from '@/lib/motion-renderer'

// Railway's healthcheck target. Deliberately shallow: it answers "this
// container is serving" and nothing more.
//
// It must NOT check Supabase or R2. A container that is up but briefly cannot
// reach Supabase should keep serving — failing the healthcheck would make
// Railway restart it, killing any render running in-process and turning a
// transient upstream blip into lost work.
export const dynamic = 'force-dynamic'

// Free space where renders live. A long-lived container keeps every finished
// video on local disk, so this is the number that explains "file went missing"
// style failures. Never throws: health must keep answering.
function diskInfo(): { freeGb: number; totalGb: number } | null {
  try {
    const dir = fs.existsSync(rendersRoot()) ? rendersRoot() : os.tmpdir()
    const st = fs.statfsSync(dir)
    const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10
    return { freeGb: gb(st.bavail * st.bsize), totalGb: gb(st.blocks * st.bsize) }
  } catch {
    return null
  }
}

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
    disk: diskInfo(),
    render: { concurrentRenders: slots, tabsPerRender: renderConcurrency(), variantsPerWave: slots },
  })
}
