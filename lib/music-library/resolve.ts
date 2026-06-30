import fs from 'fs'
import os from 'os'
import path from 'path'
import type { MusicTrack } from './types'

// ── Track file resolver ───────────────────────────────────────────────────────
// The catalog stores a path relative to the library (e.g. "calm/after-dark.mp3").
// The audio lives in two places:
//   1. Locally under music-library-files/ (the creator's machine has the snippets)
//   2. The Supabase Storage "music" bucket (so Daniel / clients have them too)
// Resolution is LOCAL-FIRST: if the file is on disk we use it; otherwise we
// download it from the public bucket once and cache it in tmp for reuse.

const MUSIC_BUCKET = 'music'
const CACHE_DIR = path.join(os.tmpdir(), 'olympus-music-cache')
const inFlight = new Map<string, Promise<string | null>>()

export function musicLibraryDir(): string {
  return process.env.MUSIC_LIBRARY_DIR || path.join(process.cwd(), 'music-library-files')
}

function bucketUrl(file: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/${MUSIC_BUCKET}/${encoded}`
}

async function downloadFromBucket(track: MusicTrack): Promise<string | null> {
  const url = bucketUrl(track.file)
  if (!url) return null
  const cachePath = path.join(CACHE_DIR, track.file)
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 1024) return cachePath
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) { console.warn(`[music-library] bucket fetch failed for "${track.title}" (HTTP ${res.status})`); return null }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 1024) return null
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, buf)
    console.log(`[music-library] downloaded "${track.title}" from Supabase (${(buf.byteLength / 1024).toFixed(0)} KB)`)
    return cachePath
  } catch (e) {
    console.warn(`[music-library] bucket download error for "${track.title}":`, (e as Error).message)
    return null
  }
}

// Returns an absolute path to the track's audio, or null if it's neither local
// nor downloadable — callers fall back (to no music) rather than fail the render.
export async function resolveTrackFile(track: MusicTrack): Promise<string | null> {
  const local = path.join(musicLibraryDir(), track.file)
  if (fs.existsSync(local) && fs.statSync(local).size > 1024) return local

  // Not local (e.g. Daniel's machine) → download from Supabase + cache.
  let attempt = inFlight.get(track.id)
  if (!attempt) {
    attempt = downloadFromBucket(track).catch((e) => {
      console.warn(`[music-library] resolve failed for "${track.title}":`, (e as Error).message)
      inFlight.delete(track.id)
      return null
    })
    inFlight.set(track.id, attempt)
  }
  return attempt
}
