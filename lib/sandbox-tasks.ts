// ── Pipeline task dispatcher ──────────────────────────────────────────────────
// One entry point for all heavy background work. Two homes:
//
//   Long-lived server (local dev, VPS): run the task in-process,
//   fire-and-forget — exactly the behavior the app has always had.
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

export type PipelineTask =
  | { task: 'prepare-source'; jobId: string; sourceUrl: string }
  | { task: 'render-variant'; jobId: string; variantId: string }
  | { task: 'finalize-submagic'; jobId: string; variantId: string; downloadUrl: string }

// Env the worker needs inside the sandbox. Only names listed here are passed.
const WORKER_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_MODEL',
  'SUBMAGIC_API_KEY',
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

/** Fire off a pipeline task in whichever home fits this deployment. Resolves
 *  once the task is RUNNING (not finished) — progress lands in the DB. */
export async function dispatchPipelineTask(payload: PipelineTask): Promise<void> {
  if (process.env.VERCEL) {
    await runInSandbox(payload)
  } else {
    void runInline(payload).catch((e) =>
      console.error(`[sandbox-tasks] inline ${payload.task} failed:`, (e as Error).message)
    )
  }
}
