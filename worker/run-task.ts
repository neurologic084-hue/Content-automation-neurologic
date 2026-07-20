// ── Sandbox worker entry ──────────────────────────────────────────────────────
// Runs ONE pipeline task to completion inside a Vercel Sandbox VM, then exits.
// Invoked by lib/sandbox-tasks.ts as:
//
//   node --import tsx worker/run-task.ts <base64-json-payload>
//
// All state goes through Supabase + R2; local files live in /tmp and die with
// the VM. Also runnable by hand for debugging:
//   node --env-file=.env.local --import tsx worker/run-task.ts "$(echo -n '{"task":"render-variant","jobId":"...","variantId":"our-v4"}' | base64)"

import {
  prepareJobSourceTask,
  renderEditVariantTask,
  finalizeSubmagicVariant,
} from '../lib/motion-renderer'
import { startSubmagicVariantTask } from '../lib/submagic-start'
import type { PipelineTask } from '../lib/sandbox-tasks'

async function main() {
  const encoded = process.argv[2]
  if (!encoded) throw new Error('usage: run-task.ts <base64-json-payload>')
  const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as PipelineTask

  console.log(`[worker] starting ${payload.task} job=${payload.jobId}`)
  const startedAt = Date.now()

  switch (payload.task) {
    case 'prepare-source':
      await prepareJobSourceTask(payload.jobId, payload.sourceUrl)
      break
    case 'render-variant':
      await renderEditVariantTask(payload.jobId, payload.variantId)
      break
    case 'start-submagic':
      await startSubmagicVariantTask(payload.jobId, payload.variantId, payload.force)
      break
    case 'finalize-submagic':
      await finalizeSubmagicVariant(payload.jobId, payload.variantId, payload.downloadUrl)
      break
    default:
      throw new Error(`unknown task: ${(payload as { task: string }).task}`)
  }

  console.log(`[worker] finished ${payload.task} in ${Math.round((Date.now() - startedAt) / 1000)}s`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[worker] task failed:', e)
    process.exit(1)
  })
