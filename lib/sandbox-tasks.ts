// ── Pipeline task dispatcher ──────────────────────────────────────────────────
// One entry point for all heavy background work. Homes, in the order dispatch
// prefers them:
//
//   Long-lived server (Railway, VPS, local dev): run the task in-process,
//   fire-and-forget — exactly the behavior the app has always had. This is the
//   home on Railway, where the server and the pipeline share one container.
//
//   Vercel: functions die shortly after responding, so each task runs in a
//   Vercel Sandbox — an ephemeral Linux microVM that clones the repo, installs
//   deps, and executes worker/run-task.ts to completion. State flows through
//   Supabase + R2 only, so the VM being destroyed afterwards loses nothing.
//
// The Sandbox path needs these extra env vars on the Vercel project:
//   SANDBOX_REPO_URL   e.g. https://github.com/neurologic084-hue/Content-automation-neurologic.git
//   SANDBOX_GIT_TOKEN  a GitHub fine-grained token with read access (repo is private)

import {
  prepareJobSourceTask,
  renderEditVariantTask,
  finalizeSubmagicVariant,
} from './motion-renderer'
import { startSubmagicVariantTask } from './submagic-start'
import { createClient } from '@supabase/supabase-js'
import { patchVariant } from './job-lock'
import { isDraining, trackTask, type DrainMode } from './shutdown'
import type { VideoVariant } from './video-pipeline'

export type PipelineTask =
  | { task: 'prepare-source'; jobId: string; sourceUrl: string }
  | { task: 'render-variant'; jobId: string; variantId: string }
  | { task: 'start-submagic'; jobId: string; variantId: string; force?: boolean }
  | { task: 'finalize-submagic'; jobId: string; variantId: string; downloadUrl: string }

// Env the worker needs inside the sandbox. Only names listed here are passed.
const WORKER_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_MODEL',
  'SUBMAGIC_API_KEY',
  'AUPHONIC_API_TOKEN',
  'ELEVENLABS_API_KEY',
  'PEXELS_API_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_ENDPOINT',
  'R2_PUBLIC_URL',
] as const

async function runInline(payload: PipelineTask): Promise<void> {
  switch (payload.task) {
    case 'prepare-source':
      return prepareJobSourceTask(payload.jobId, payload.sourceUrl)
    case 'render-variant':
      return renderEditVariantTask(payload.jobId, payload.variantId)
    case 'start-submagic':
      return startSubmagicVariantTask(payload.jobId, payload.variantId, payload.force)
    case 'finalize-submagic':
      return finalizeSubmagicVariant(payload.jobId, payload.variantId, payload.downloadUrl)
  }
}

async function runInSandbox(payload: PipelineTask): Promise<void> {
  const { Sandbox } = await import('@vercel/sandbox')

  const repoUrl = process.env.SANDBOX_REPO_URL
  if (!repoUrl) throw new Error('SANDBOX_REPO_URL is not set — cannot launch pipeline sandbox')

  const env: Record<string, string> = {}
  for (const key of WORKER_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!
  }
  // The worker writes to /tmp inside its own VM regardless, but be explicit.
  env.RENDERS_DIR = '/tmp/renders'
  // Lets the render command adapt to the small VM (compositor cache cap).
  env.SANDBOX = '1'

  // Remotion renders need the browser + the remotion package tree; the other
  // tasks are ffmpeg-only (ffmpeg-static comes with the root npm ci).
  const needsRemotion = payload.task === 'render-variant'

  // The sandbox VM is bare Amazon Linux — Chrome Headless Shell downloads
  // fine but can't LAUNCH without the system graphics/print/sound libraries
  // (nss, atk, gbm, pango, ...). Without this install the render dies with a
  // ChildProcess exit pointing at node_modules/.remotion/chrome-*.
  // skip_missing_names + skip-broken: a renamed/absent package (distro naming
  // drifts) must never block the ones that DO exist.
  const CHROME_DEPS =
    'sudo dnf install -y --skip-broken --setopt=skip_missing_names_on_install=True ' +
    'nss nspr alsa-lib atk at-spi2-atk at-spi2-core ' +
    'cups-libs dbus-libs expat libdrm libgbm mesa-libgbm libX11 libxcb libXcomposite ' +
    'libXdamage libXext libXfixes libXrandr libxkbcommon pango cairo ' +
    'liberation-fonts google-noto-color-emoji-fonts google-noto-emoji-color-fonts'

  const inner = [
    'set -e',
    'df -h /tmp || true',
    'npm ci --no-audit --no-fund',
    ...(needsRemotion
      ? [
          CHROME_DEPS,
          // The AL2023 glibc/compositor fix (swapping in the vendored musl
          // compositor) happens in the cloned worker code at render time, not
          // here — so it always runs the latest committed logic even if this
          // Vercel function deploy is lagging behind main.
          'cd remotion && npm ci --no-audit --no-fund && npx remotion browser ensure && cd ..',
        ]
      : []),
    `node --import tsx worker/run-task.ts '${Buffer.from(JSON.stringify(payload)).toString('base64')}'`,
  ].join(' && ')

  // Everything the VM does lands in one log, and that log is pushed to R2
  // win or lose (logs/{jobId}/{task}.log) — production failures become
  // readable without any access to the dead VM. tail echoes the ending to
  // the sandbox's own stdout for Vercel's live view.
  const label = `${payload.task}${'variantId' in payload ? `-${payload.variantId}` : ''}`
  const bootstrap =
    `( ${inner} ) > /tmp/task.log 2>&1 ; EXIT=$? ; ` +
    `tail -c 3000 /tmp/task.log ; ` +
    `node --import tsx worker/upload-task-log.ts '${payload.jobId}' '${label}' /tmp/task.log || true`

  // Sandbox creation can fail transiently (Vercel rate-limit, brief capacity /
  // concurrency pressure — especially when several renders launch at once via
  // "Generate all"). Retry a couple times with backoff before giving up, and
  // surface the REAL Vercel error to the caller (it's stored on the variant so
  // it's visible without VM access — a bare "could not start" hides whether it's
  // a quota cap, a plan limit, or a blip).
  let sandbox
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      sandbox = await Sandbox.create({
        source: {
          type: 'git',
          url: repoUrl,
          ...(process.env.SANDBOX_GIT_TOKEN
            ? { username: 'x-access-token', password: process.env.SANDBOX_GIT_TOKEN }
            : {}),
          depth: 1,
        },
        resources: { vcpus: needsRemotion ? 4 : 2 },
        // Hobby caps sandboxes at 45 minutes; renders finish well inside that.
        timeout: 40 * 60 * 1000,
        runtime: 'node22',
      })
      break
    } catch (e) {
      lastErr = e as Error
      console.warn(`[sandbox-tasks] Sandbox.create attempt ${attempt}/3 failed for ${payload.task}: ${lastErr.message}`)
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000))
    }
  }
  if (!sandbox) {
    throw new Error(`Vercel Sandbox launch failed: ${lastErr?.message ?? 'unknown error'}`)
  }

  // Detached: the command keeps running inside the VM after this function
  // returns its HTTP response. The VM stops itself when the script exits.
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `${bootstrap} ; sudo shutdown -h now 2>/dev/null || true ; exit $EXIT`],
    env,
    detached: true,
  })

  console.log(`[sandbox-tasks] launched ${payload.task} for ${payload.jobId} in a sandbox VM`)
}

// owner/repo for the GitHub Actions render host. Explicit GITHUB_RENDER_REPO
// wins; otherwise it's parsed from the repo we already clone in the Sandbox path.
function githubRenderRepo(): string | null {
  if (process.env.GITHUB_RENDER_REPO) return process.env.GITHUB_RENDER_REPO
  const url = process.env.SANDBOX_REPO_URL
  const m = url?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : null
}

// Free render host: fire a repository_dispatch so a GitHub Actions runner (Ubuntu,
// modern glibc, ffmpeg present) checks out the repo and runs worker/run-task.ts.
// Needs GITHUB_DISPATCH_TOKEN (a token with Contents: write on the repo). Resolves
// once GitHub accepts the event; the run is then queued on GitHub's side.
async function runViaGitHubActions(payload: PipelineTask): Promise<void> {
  const token = process.env.GITHUB_DISPATCH_TOKEN
  const repo = githubRenderRepo()
  if (!token || !repo) {
    throw new Error('GitHub render host not configured (need GITHUB_DISPATCH_TOKEN and SANDBOX_REPO_URL/GITHUB_RENDER_REPO)')
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'render-task', client_payload: payload }),
  })
  if (!res.ok) {
    throw new Error(`GitHub Actions dispatch failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  console.log(`[sandbox-tasks] dispatched ${payload.task} for ${payload.jobId} to GitHub Actions (${repo})`)
}

// True on any long-lived container that runs tasks in its own process. Railway
// auto-injects RAILWAY_* into every service, and the Dockerfile bakes in
// PIPELINE_INPROCESS=1 as an explicit belt-and-suspenders. Either wins over a
// stray VERCEL var: RAILWAY.md tells operators to copy env from the old Vercel
// project, so a VERCEL=1 dragged along with the rest must NOT silently route
// every task into a Sandbox that no longer has SANDBOX_REPO_URL (which would
// throw on launch and fail the variant for no real reason).
function isLongLivedHost(): boolean {
  return (
    process.env.PIPELINE_INPROCESS === '1' ||
    !!process.env.RAILWAY_ENVIRONMENT ||
    !!process.env.RAILWAY_SERVICE_ID ||
    !!process.env.RAILWAY_PROJECT_ID ||
    !!process.env.RAILWAY_DEPLOYMENT_ID
  )
}

// How the graceful-shutdown drain should treat each task if SIGTERM lands while
// it is running (see lib/shutdown.ts).
function drainModeFor(task: PipelineTask['task']): DrainMode {
  switch (task) {
    case 'render-variant':
      return 'fail' // can't finish in a drain window and dies with the container
    case 'start-submagic':
    case 'finalize-submagic':
      return 'wait' // short + state-critical (writes the permanent R2 / project id)
    case 'prepare-source':
      return 'abandon' // job-level; a retried start self-heals the source from R2/Drive
    default:
      return 'abandon'
  }
}

// Last-ditch failure marker for the in-process home. runInline's tasks each fail
// their OWN variant on error — except a throw from renderEditVariantTask's
// preamble (job/script read) escapes before runSingleVariant's try/catch is set
// up, which would leave the card 'processing' until the 45-min watchdog. Fail it
// here, but only if it's still 'processing', so a result that already landed is
// never clobbered. Best-effort and silent on its own failure.
async function failStuckVariant(payload: PipelineTask): Promise<void> {
  if (!('variantId' in payload) || !payload.variantId) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return
  const db = createClient(url, key)
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', payload.jobId).single()
  const v = ((job?.variants ?? []) as VideoVariant[]).find((x) => x.id === payload.variantId)
  if (!v || v.status !== 'processing') return
  await patchVariant(
    db,
    payload.jobId,
    payload.variantId,
    { status: 'failed', error: 'The render stopped unexpectedly. Please retry this variant.', progress: null },
    { completeWhenAllDone: true },
  )
}

// In-process home: run to completion in the background while dispatch returns
// immediately. Registers with the shutdown tracker for the whole run so a
// redeploy can give it a clean ending, and nets any escaped throw so a task
// never dies silently with the card left spinning.
async function runInProcess(payload: PipelineTask): Promise<void> {
  const untrack = trackTask({
    jobId: payload.jobId,
    variantId: 'variantId' in payload ? payload.variantId : undefined,
    task: payload.task,
    mode: drainModeFor(payload.task),
  })
  try {
    await runInline(payload)
  } catch (e) {
    console.error(`[sandbox-tasks] inline ${payload.task} failed:`, (e as Error).message)
    await failStuckVariant(payload).catch((err) =>
      console.warn(`[sandbox-tasks] could not fail stuck ${payload.task}:`, (err as Error).message),
    )
  } finally {
    untrack()
  }
}

/** Fire off a pipeline task in whichever home fits this deployment. Resolves
 *  once the task is RUNNING/QUEUED (not finished) — progress lands in the DB.
 *  Home order: GitHub Actions (free, opt-in) → Vercel Sandbox (Vercel only) →
 *  in-process (Railway / long-lived server). */
export async function dispatchPipelineTask(payload: PipelineTask): Promise<void> {
  // Mid-drain: the container is on its way down, so refuse new heavy work rather
  // than start something that would be killed seconds later. The start routes
  // turn this throw into a failed variant with a retry, which is honest — the
  // user retries once the new deploy is up.
  if (isDraining()) {
    throw new Error('The server is restarting to finish a deploy — please retry in a moment.')
  }
  if (process.env.RENDER_VIA_GITHUB === '1') {
    await runViaGitHubActions(payload)
  } else if (process.env.VERCEL && !isLongLivedHost()) {
    await runInSandbox(payload)
  } else {
    void runInProcess(payload).catch((e) =>
      console.error(`[sandbox-tasks] in-process ${payload.task} crashed:`, (e as Error).message),
    )
  }
}
