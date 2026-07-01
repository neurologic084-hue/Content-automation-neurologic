// ── Mirror the Supabase bucket to the catalog (delete orphans) ────────────────
// music:upload only ADDS/overwrites — it never removes. After curating the
// library + pruning the catalog, run this to DELETE any object in the "music"
// bucket that's no longer in the catalog, so Supabase matches the curated set.
//
// Run: npm run music:sync
//      npm run music:sync -- --dry   (report what would be deleted, delete nothing)

import { MUSIC_CATALOG } from './catalog'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'music'

interface Row { name: string; id: string | null }

async function list(prefix: string): Promise<Row[]> {
  const res = await fetch(`${URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  })
  if (!res.ok) throw new Error(`list "${prefix}": ${res.status} ${await res.text()}`)
  return res.json()
}

// The bucket is one level deep (category/file). id === null marks a folder.
async function allObjects(): Promise<string[]> {
  const out: string[] = []
  for (const root of await list('')) {
    if (root.id === null) {
      for (const f of await list(`${root.name}/`)) {
        if (f.id !== null) out.push(`${root.name}/${f.name}`)
      }
    } else {
      out.push(root.name)
    }
  }
  return out
}

async function remove(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const res = await fetch(`${URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: batch }),
    })
    if (!res.ok) throw new Error(`delete: ${res.status} ${await res.text()}`)
  }
}

async function main() {
  if (!URL || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
  const dry = process.argv.includes('--dry')

  const keep = new Set(MUSIC_CATALOG.map(t => t.file))
  const bucket = await allObjects()
  const orphans = bucket.filter(p => !keep.has(p))

  console.log(`Bucket has ${bucket.length} objects; catalog keeps ${keep.size}. Orphans to delete: ${orphans.length}.\n`)
  for (const p of orphans) console.log(`  − ${p}`)

  if (dry) { console.log('\n(dry run — nothing deleted)'); return }
  if (orphans.length) await remove(orphans)
  console.log(`\nDone. Deleted ${orphans.length} orphaned objects. Bucket now mirrors the catalog.`)
}

main().catch((e) => { console.error('[sync] failed:', e); process.exit(1) })
