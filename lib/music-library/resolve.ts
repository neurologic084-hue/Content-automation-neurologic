import fs from 'fs'
import path from 'path'
import type { MusicTrack } from './types'

// ── Track file resolver ───────────────────────────────────────────────────────
// The catalog stores a path relative to the music library directory; the audio
// itself lives on disk under that directory (default ./music-library-files,
// override with MUSIC_LIBRARY_DIR for other environments). No download/caching —
// the files are already local.

export function musicLibraryDir(): string {
  return process.env.MUSIC_LIBRARY_DIR || path.join(process.cwd(), 'music-library-files')
}

// Returns the absolute path to the track's audio, or null if the file is missing
// — callers should fall back (to no music) rather than fail the render.
export async function resolveTrackFile(track: MusicTrack): Promise<string | null> {
  const abs = path.join(musicLibraryDir(), track.file)
  if (fs.existsSync(abs) && fs.statSync(abs).size > 1024) return abs
  console.warn(`[music-library] file missing for "${track.title}" at ${abs}`)
  return null
}
