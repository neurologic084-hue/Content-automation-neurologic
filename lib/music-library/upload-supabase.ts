// ── Upload the music library to Supabase Storage ──────────────────────────────
// Pushes the trimmed snippet library (music-library-files/) into a public
// Supabase Storage bucket named "music", creating it if needed. After this,
// anyone running the app (Daniel, a client) gets the tracks via the resolver —
// no zip needed. Re-run any time the library changes (upserts).
//
// Run: npm run music:upload

import fs from 'fs'
import path from 'path'
import { MUSIC_CATALOG } from './catalog'
import { musicLibraryDir } from './resolve'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'music'

async function ensureBucket(): Promise<void> {
  const head = await fetch(`${URL}/storage/v1/bucket/${BUCKET}`, {
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` },
  })
  if (head.ok) { console.log(`bucket "${BUCKET}" already exists`); return }
  const res = await fetch(`${URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    // public read so the resolver can fetch by URL without signed links
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  })
  if (!res.ok) throw new Error(`create bucket failed: ${await res.text()}`)
  console.log(`created public bucket "${BUCKET}"`)
}

function objectUrl(file: string): string {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `${URL}/storage/v1/object/${BUCKET}/${encoded}`
}

async function upload(file: string): Promise<boolean> {
  const local = path.join(musicLibraryDir(), file)
  if (!fs.existsSync(local) || fs.statSync(local).size < 1024) return false
  const body = fs.readFileSync(local)
  const res = await fetch(objectUrl(file), {
    method: 'POST',
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true', // overwrite if it already exists
    },
    body,
  })
  if (!res.ok) { console.warn(`  failed ${file}: ${(await res.text()).slice(0, 120)}`); return false }
  return true
}

async function main() {
  if (!URL || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
  if (!MUSIC_CATALOG.length) { console.error('Empty catalog.'); process.exit(1) }

  await ensureBucket()
  console.log(`Uploading ${MUSIC_CATALOG.length} tracks to bucket "${BUCKET}"...\n`)

  const files = MUSIC_CATALOG.map(t => t.file)
  let i = 0, ok = 0, done = 0
  const worker = async () => {
    while (i < files.length) {
      const f = files[i++]
      try { if (await upload(f)) ok++ } catch (e) { console.warn(`  error ${f}: ${(e as Error).message}`) }
      done++
      if (done % 50 === 0) console.log(`  ${done}/${files.length}...`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))

  console.log(`\nDone. ${ok}/${files.length} uploaded.`)
  console.log(`Public base URL: ${URL}/storage/v1/object/public/${BUCKET}/<category>/<file>`)
}

main().catch((e) => { console.error('[upload] failed:', e); process.exit(1) })
