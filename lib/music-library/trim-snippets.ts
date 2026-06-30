// ── Trim the library to best-part snippets ────────────────────────────────────
// Most tracks are 3-10 min, but a short-form clip only ever plays ~30-60s from
// the chorus. So we trim every track to a short clip STARTING at its detected
// best-part offset. The library keeps all 315 tracks but shrinks ~1.5GB -> ~350MB
// (fits Supabase free), and since each snippet now starts at the chorus, the
// catalog's startOffset is reset to 0.
//
// Writes snippets to ./music-library-snippets (mirroring the category structure).
// After it runs, swap that in as the local library and upload it to Supabase.
//
// Run: npm run music:trim

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import { MUSIC_CATALOG } from './catalog'
import { serializeCatalog } from './catalog-format'
import { musicLibraryDir } from './resolve'

const execAsync = promisify(exec)
const FFMPEG = (ffmpegStatic as unknown as string) || 'ffmpeg'
const CATALOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.ts')

const SRC = musicLibraryDir()
const DEST = path.join(process.cwd(), 'music-library-snippets')
const SNIPPET_SECONDS = 75   // covers virtually every short-form clip without looping
const BITRATE = '128k'

async function trim(file: string, offset: number): Promise<boolean> {
  const inPath = path.join(SRC, file)
  const outPath = path.join(DEST, file)
  if (!fs.existsSync(inPath)) { console.warn(`  missing: ${file}`); return false }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  // -ss before -i = fast seek to the best part; re-encode to a consistent 128k.
  await execAsync(
    `"${FFMPEG}" -ss ${offset} -i "${inPath}" -t ${SNIPPET_SECONDS} -c:a libmp3lame -b:a ${BITRATE} -y "${outPath}"`,
    { maxBuffer: 64 * 1024 * 1024 },
  )
  return true
}

async function main() {
  if (!MUSIC_CATALOG.length) { console.error('Empty catalog — run music:ingest first.'); process.exit(1) }
  fs.rmSync(DEST, { recursive: true, force: true })
  fs.mkdirSync(DEST, { recursive: true })
  console.log(`Trimming ${MUSIC_CATALOG.length} tracks to ${SNIPPET_SECONDS}s snippets → ${DEST}\n`)

  const tracks = [...MUSIC_CATALOG]
  let i = 0, ok = 0
  const worker = async () => {
    while (i < tracks.length) {
      const t = tracks[i++]
      try { if (await trim(t.file, Math.max(0, t.startOffset ?? 0))) ok++ }
      catch (e) { console.warn(`  skip "${t.title}": ${(e as Error).message}`) }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  // Snippets now start at the chorus, so the playback offset is 0.
  const updated = tracks.map(t => ({ ...t, startOffset: 0 }))
  fs.writeFileSync(CATALOG_PATH, serializeCatalog(updated))

  // Report total size.
  let bytes = 0
  for (const t of tracks) {
    const p = path.join(DEST, t.file)
    if (fs.existsSync(p)) bytes += fs.statSync(p).size
  }
  console.log(`\nDone. ${ok}/${tracks.length} trimmed. Total: ${(bytes / 1024 / 1024).toFixed(0)} MB`)
  console.log(`Catalog startOffsets reset to 0.`)
  console.log(`Next: swap ${DEST} in as music-library-files, then upload to Supabase.`)
}

main().catch((e) => { console.error('[trim] failed:', e); process.exit(1) })
