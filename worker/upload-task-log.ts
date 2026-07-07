// Uploads a sandbox task's full log to R2 so production failures are
// diagnosable without VM access: logs/{jobId}/{label}.log
import { uploadToStorage } from '../lib/storage'

const [, , jobId, label, logPath] = process.argv
if (!jobId || !label || !logPath) {
  console.error('usage: upload-task-log <jobId> <label> <logPath>')
  process.exit(0)
}
uploadToStorage(logPath, `${label}.log`, jobId, 'logs')
  .then((url) => { console.log(`[upload-task-log] ${url}`); process.exit(0) })
  .catch((e) => { console.error('[upload-task-log] failed:', (e as Error).message); process.exit(0) })
