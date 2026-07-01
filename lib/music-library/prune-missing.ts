// ── Prune the catalog to what's actually on disk ──────────────────────────────
// After curating the working library (deleting tracks you don't want in
// music-library-files/), run this to drop the matching catalog entries so
// catalog.ts reflects only the tracks that still exist locally. Then sync-supabase
// mirrors those deletions to the bucket, and describe-tracks only sees survivors.
//
// Run: npm run music:prune
//      npm run music:prune -- --dry   (report only, don't write)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { MUSIC_CATALOG } from './catalog'
import { serializeCatalog } from './catalog-format'
import { musicLibraryDir } from './resolve'

const CATALOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.ts')

function main() {
  const dry = process.argv.includes('--dry')
  const dir = musicLibraryDir()

  const kept = MUSIC_CATALOG.filter(t => fs.existsSync(path.join(dir, t.file)))
  const removed = MUSIC_CATALOG.filter(t => !fs.existsSync(path.join(dir, t.file)))

  console.log(`Catalog: ${MUSIC_CATALOG.length} tracks → keeping ${kept.length}, removing ${removed.length}.\n`)
  for (const t of removed) console.log(`  − ${t.file}`)

  if (dry) { console.log('\n(dry run — catalog.ts not written)'); return }
  fs.writeFileSync(CATALOG_PATH, serializeCatalog(kept))
  console.log(`\nWrote catalog.ts with ${kept.length} tracks.`)
}

main()
