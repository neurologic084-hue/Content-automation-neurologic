// ── Local music library ingestion ─────────────────────────────────────────────
// Walks the creator's mood-organized source folders, normalizes them into one
// clean category taxonomy, DEDUPES (collapses "Copy of …" and the same track
// appearing in multiple folders — unioning its categories), copies everything
// into one organized folder (music-library-files/<category>/…), and writes
// catalog.ts. Excludes SFX / client-dump / duplicate folders.
//
// Run it:
//   node --env-file=.env.local --import tsx lib/music-library/ingest-local.ts "<source-root>"
//   (or set MUSIC_SOURCE_DIR; defaults to the Drive download folder)
//   npm run music:ingest -- "<source-root>"

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { serializeCatalog } from './catalog-format'
import type { MusicCategory, MusicTrack } from './types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = path.join(HERE, 'catalog.ts')
const DEST_DIR = path.join(process.cwd(), 'music-library-files')

const DEFAULT_SOURCE = '/Users/junmacbook/Downloads/drive-download-20260629T182108Z-3-001'

// Mood folder → canonical category. Only these folders are ingested; everything
// else (Audio Edit / SFX, Magic Clients, ~MoneyMind Vids, ALL SONGS, Story dups)
// is intentionally excluded.
const FOLDER_MAP: { rel: string; category: MusicCategory }[] = [
  { rel: 'Songs/Calm', category: 'calm' },
  { rel: 'Music 1/Instrumental Reflection', category: 'calm' },
  { rel: 'Songs/Emotional', category: 'emotional' },
  { rel: 'Music 1/Emotional', category: 'emotional' },
  { rel: 'Songs/Sad', category: 'sad' },
  { rel: 'Songs/Happy', category: 'happy' },
  { rel: 'Songs/Funny', category: 'funny' },
  { rel: 'Music 1/Funny', category: 'funny' },
  { rel: 'Songs/Energetic', category: 'energetic' },
  { rel: 'Music 1/General Energetic', category: 'energetic' },
  { rel: 'Songs/Motivation', category: 'motivation' },
  { rel: 'Songs/Inspiring', category: 'inspiring' },
  { rel: 'Music 1/Heroic Uplifting', category: 'inspiring' },
  { rel: 'Songs/Curious-Interesting', category: 'curious' },
  { rel: 'Songs/Weird-Mysterious', category: 'mysterious' },
  { rel: 'Songs/Gangster', category: 'gangster' },
  { rel: 'Music 1/Badass', category: 'gangster' },
  { rel: 'Music 1/Dark Vibe', category: 'dark' },
]

const AUDIO_RE = /\.(mp3|m4a|wav|aac|flac)$/i

function listAudio(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => AUDIO_RE.test(f)).map(f => path.join(dir, f))
}

// Dedup key: lowercased name, "copy of" stripped, separators collapsed.
function dedupKey(file: string): string {
  return path.basename(file)
    .replace(AUDIO_RE, '')
    .toLowerCase()
    .replace(/^copy of /, '')
    .replace(/[_\-\s]+/g, ' ')
    .trim()
}

function cleanTitle(file: string): string {
  return path.basename(file)
    .replace(AUDIO_RE, '')
    .replace(/^Copy of /i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'track'
}

interface Entry {
  key: string
  title: string
  categories: Set<MusicCategory>
  srcPath: string
  ext: string
}

// Carry over startOffset/duration from a prior catalog so a re-ingest doesn't
// wipe the analysis pass results for tracks that still exist (matched by id).
async function loadPriorAnalysis(): Promise<Map<string, { startOffset?: number; durationSeconds: number | null }>> {
  const map = new Map<string, { startOffset?: number; durationSeconds: number | null }>()
  if (!fs.existsSync(CATALOG_PATH)) return map
  try {
    const mod = (await import(CATALOG_PATH)) as { MUSIC_CATALOG?: MusicTrack[] }
    for (const t of mod.MUSIC_CATALOG ?? []) {
      map.set(t.id, { startOffset: t.startOffset, durationSeconds: t.durationSeconds })
    }
  } catch { /* fresh catalog */ }
  return map
}

async function main() {
  const source = process.argv[2] || process.env.MUSIC_SOURCE_DIR || DEFAULT_SOURCE
  if (!fs.existsSync(source)) {
    console.error(`Source folder not found: ${source}`)
    process.exit(1)
  }
  console.log(`Ingesting from: ${source}\n`)

  // Collect + dedupe across all mapped folders, unioning categories.
  const entries = new Map<string, Entry>()
  for (const { rel, category } of FOLDER_MAP) {
    const files = listAudio(path.join(source, rel))
    let added = 0
    for (const f of files) {
      const key = dedupKey(f)
      if (!key) continue
      const existing = entries.get(key)
      if (existing) {
        existing.categories.add(category)
      } else {
        entries.set(key, { key, title: cleanTitle(f), categories: new Set([category]), srcPath: f, ext: path.extname(f).toLowerCase() })
        added++
      }
    }
    console.log(`  ${rel} (${category}): ${files.length} files, ${added} new`)
  }

  // Preserve analysis (startOffset/duration) from any prior catalog before rebuild.
  const prior = await loadPriorAnalysis()

  // Copy into music-library-files/<primaryCategory>/<slug>.<ext> and build catalog.
  fs.rmSync(DEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(DEST_DIR, { recursive: true })

  const tracks: MusicTrack[] = []
  const usedNames = new Set<string>()
  for (const e of entries.values()) {
    const primary = [...e.categories][0]
    const base = slug(e.title)
    let name = `${base}${e.ext}`
    let n = 1
    while (usedNames.has(`${primary}/${name}`)) { name = `${base}-${n++}${e.ext}` }
    usedNames.add(`${primary}/${name}`)

    const relFile = `${primary}/${name}`
    const destPath = path.join(DEST_DIR, relFile)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    try {
      fs.copyFileSync(e.srcPath, destPath)
    } catch (err) {
      console.warn(`  skip "${e.title}": ${(err as Error).message}`)
      continue
    }

    const id = `local-${slug(primary)}-${slug(e.title)}`.slice(0, 80)
    const carried = prior.get(id)
    tracks.push({
      id,
      title: e.title,
      categories: [...e.categories],
      file: relFile,
      durationSeconds: carried?.durationSeconds ?? null,
      ...(carried?.startOffset !== undefined ? { startOffset: carried.startOffset } : {}),
    })
  }

  tracks.sort((a, b) => a.categories[0].localeCompare(b.categories[0]) || a.title.localeCompare(b.title))
  fs.writeFileSync(CATALOG_PATH, serializeCatalog(tracks))

  // Per-category summary.
  const byCat: Record<string, number> = {}
  for (const t of tracks) for (const c of t.categories) byCat[c] = (byCat[c] ?? 0) + 1
  console.log(`\nWrote ${tracks.length} unique tracks → catalog.ts`)
  console.log(`Copied audio → ${DEST_DIR}`)
  console.log(`Category counts: ${JSON.stringify(byCat)}`)
}

main()
