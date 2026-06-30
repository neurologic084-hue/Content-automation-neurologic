// ── Curated music library — mood-category model ───────────────────────────────
// The library is the creator's own organized folder of tracks, ingested from
// mood-named subfolders (see ingest-local.ts). Selection is driven by matching a
// video's mood to a music category, so the folders ARE the source of truth.
//
// Audio files are NOT committed (kept light) — the catalog stores a relative
// path into the music library directory (default ./music-library-files, override
// with MUSIC_LIBRARY_DIR) and the resolver reads the local file.

export type MusicCategory =
  | 'calm'
  | 'emotional'
  | 'sad'
  | 'happy'
  | 'funny'
  | 'energetic'
  | 'motivation'
  | 'inspiring'
  | 'curious'
  | 'mysterious'
  | 'dark'
  | 'gangster'

export const MUSIC_CATEGORIES: MusicCategory[] = [
  'calm', 'emotional', 'sad', 'happy', 'funny',
  'energetic', 'motivation', 'inspiring', 'curious',
  'mysterious', 'dark', 'gangster',
]

// Fallback category when nothing else fits — a safe, neutral bed.
export const NEUTRAL_CATEGORY: MusicCategory = 'calm'

export interface MusicTrack {
  id: string
  title: string
  // One or more mood categories (a track found in multiple mood folders carries
  // all of them, so it can match more than one kind of video).
  categories: MusicCategory[]
  // Path relative to the music library directory, e.g. "calm/after-dark.mp3".
  file: string
  durationSeconds: number | null
  // Seconds into the track where the best part (chorus/drop) begins — the mix
  // starts playback here so the strong section lands in the clip instead of the
  // intro. Filled by the analysis pass (analyze-sections.ts); 0/undefined = start
  // from the beginning.
  startOffset?: number
}

// What the selector scores a track against.
export interface MusicSelectionContext {
  hook: string
  moodTag: string | null
  scriptFormat?: string
}
