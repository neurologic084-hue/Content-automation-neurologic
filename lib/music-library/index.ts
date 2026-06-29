import { resolveTrackFile } from './resolve'
import { selectTrack } from './select'
import type { MusicSelectionContext, MusicTrack } from './types'

export type { MusicCategory, MusicSelectionContext, MusicTrack } from './types'
export { MUSIC_CATEGORIES } from './types'
export { MUSIC_CATALOG } from './catalog'
export { selectTrack } from './select'

export interface ResolvedLibraryMusic {
  filePath: string
  track: MusicTrack
}

// High-level entry point for the render path: pick the best-fitting track from
// the creator's library and resolve it to a local file. Returns null when the
// library is empty or the file is missing — the caller then renders without
// music. (The tracks are the creator's own, so no attribution is attached.)
export async function getLibraryMusic(
  ctx: MusicSelectionContext,
): Promise<ResolvedLibraryMusic | null> {
  const track = await selectTrack(ctx)
  if (!track) return null

  const filePath = await resolveTrackFile(track)
  if (!filePath) return null

  return { filePath, track }
}
