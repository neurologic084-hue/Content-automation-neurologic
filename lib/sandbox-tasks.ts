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
  'GEMINI_API_KEY',
  'SUBMAGIC_API_KEY',
  'ELEVENLABS_API_KEY',
  'PEXELS_API_KEY',
  'AUPHONIC_API_TOKEN',
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

  // Remotion renders need the browser + the remotion package tree; the other
  // tasks are ffmpeg-only (ffmpeg-static comes with the root npm ci).
  const needsRemotion = payload.task === 'render-variant'
  const bootstrap = [
    'set -e',
    'npm ci --no-audit --no-fund',
    ...(needsRemotion
      ? ['cd remotion && npm ci --no-audit --no-fund && npx remotion browser ensure && cd ..']
      : []),
    `node --import tsx worker/run-task.ts '${Buffer.from(JSON.stringify(payload)).toString('base64')}'`,
  ].join(' && ')

  const sandbox = await Sandbox.create({
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

  // Detached: the command keeps running inside the VM after this function
  // returns its HTTP response. The VM stops itself when the script exits.
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `${bootstrap} ; EXIT=$? ; sudo shutdown -h now 2>/dev/null || true ; exit $EXIT`],
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
