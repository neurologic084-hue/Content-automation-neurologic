// Run once to delete all files from the Supabase Storage renders bucket:
//   node scripts/clear-storage.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://eagktzvsakvsihrojirz.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZ2t0enZzYWt2c2locm9qaXJ6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjEzMzYxNSwiZXhwIjoyMDk3NzA5NjE1fQ.8apK68-9xi_yE5MLohvYDbT1hWjhuq2d4W_b2rDEQF4'
const BUCKET = 'renders'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

async function clearBucket() {
  let total = 0

  // List all folders (job IDs) at the root level
  const { data: folders, error: listErr } = await db.storage.from(BUCKET).list('')
  if (listErr) { console.error('list failed:', listErr.message); process.exit(1) }
  if (!folders?.length) { console.log('Bucket is already empty.'); return }

  for (const folder of folders) {
    // Each folder is a job ID — list its files
    const { data: files } = await db.storage.from(BUCKET).list(folder.name)
    if (!files?.length) continue

    const paths = files.map(f => `${folder.name}/${f.name}`)
    const { error } = await db.storage.from(BUCKET).remove(paths)
    if (error) {
      console.error(`failed to delete ${folder.name}/:`, error.message)
    } else {
      console.log(`deleted ${paths.length} file(s) from ${folder.name}/`)
      total += paths.length
    }
  }

  console.log(`\ndone — ${total} file(s) removed from the "${BUCKET}" bucket.`)
}

clearBucket()
