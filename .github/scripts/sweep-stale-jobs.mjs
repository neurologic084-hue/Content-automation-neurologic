// ── Stale-job sweep for GitHub Actions ────────────────────────────────────────
// Dependency-free twin of lib/stale-sweep.ts, run on a schedule by
// .github/workflows/sweep-stale-jobs.yml. Talks straight to Supabase REST with
// the service-role key (same secrets the render worker already uses), so it
// needs no deployed app URL and no Vercel cron — the Vercel Hobby plan only
// allows daily crons, which is far too slow for a stuck-render watchdog.
//
// Keep the rules in lockstep with lib/stale-sweep.ts:
//   - processing > 45 min from its start stamp        → dead worker
//   - processing > 12 min with NO progress reported   → worker never came up
//   - processing with no stamp and job > 45 min old   → legacy row
//
// Node 18+ (global fetch). Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const STALE_MS = 45 * 60 * 1000
const NEVER_STARTED_MS = 12 * 60 * 1000
const MAX_WRITE_TRIES = 3

const BASE = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!BASE || !KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

async function rest(pathname, init = {}) {
  const res = await fetch(`${BASE}/rest/v1/${pathname}`, {
    ...init,
    headers: { ...HEADERS, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

function staleReason(variant, jobAgeMs, now) {
  if (variant.status !== 'processing') return null
  if (!variant.processing_started_at) {
    return jobAgeMs > STALE_MS ? 'interrupted' : null
  }
  const age = now - new Date(variant.processing_started_at).getTime()
  if (!variant.progress && age > NEVER_STARTED_MS) return 'never-started'
  if (age > STALE_MS) return 'interrupted'
  return null
}

const ERRORS = {
  'never-started': "The render didn't start (the worker never came up). Please retry this variant.",
  interrupted: 'The render stopped unexpectedly (the worker was interrupted). Please retry this variant.',
}

async function sweepJob(job) {
  const now = Date.now()
  const jobAgeMs = now - new Date(job.created_at).getTime()
  const staleIds = new Map(
    (job.variants ?? [])
      .map(v => [v.id, staleReason(v, jobAgeMs, now)])
      .filter(([, reason]) => reason),
  )
  if (staleIds.size === 0) return 0

  // Read-modify-write with a verify pass, same shape as patchVariant in
  // lib/job-lock.ts: re-read fresh state each try so a concurrent writer
  // (a render finishing right now) isn't clobbered, and confirm our fields
  // stuck before trusting the write.
  for (let attempt = 1; attempt <= MAX_WRITE_TRIES; attempt++) {
    const [fresh] = await rest(`video_jobs?id=eq.${job.id}&select=variants`)
    if (!fresh?.variants) return 0
    let changed = 0
    const variants = fresh.variants.map(v => {
      const reason = staleIds.get(v.id)
      // Re-check status on the fresh read — it may have finished since we listed.
      if (!reason || v.status !== 'processing') return v
      changed++
      return { ...v, status: 'failed', error: ERRORS[reason], progress: null, processing_started_at: null }
    })
    if (changed === 0) return 0

    const allDone = variants.every(v => v.status === 'ready' || v.status === 'failed')
    await rest(`video_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ variants, ...(allDone ? { status: 'complete' } : {}) }),
    })

    const [check] = await rest(`video_jobs?id=eq.${job.id}&select=variants`)
    const stuck = [...staleIds.keys()].every(id => {
      const after = (check?.variants ?? []).find(v => v.id === id)
      return !after || after.status !== 'processing'
    })
    if (stuck) {
      for (const [id, reason] of staleIds) console.log(`  swept ${job.id}:${id} (${reason})`)
      return changed
    }
    console.warn(`  write clobbered for job ${job.id}, retry ${attempt}/${MAX_WRITE_TRIES}`)
  }
  return 0
}

const jobs = await rest('video_jobs?status=eq.processing&select=id,created_at,variants')
let swept = 0
for (const job of jobs) swept += await sweepJob(job)
console.log(`checked ${jobs.length} processing job(s), swept ${swept} stale variant(s)`)
