// ── SFX staging + peak alignment + loudness trim + variety allocation ─────────
// Turns planned cues (lib/render-kit.ts) into render-ready audio props:
//   1. VARIETY RULE — no single sound file plays more than TWICE in one video.
//      Each category exposes only its hand-picked takes (ALLOWED_TAKES in
//      sound-effects.ts); takes rotate round-robin so back-to-back cues of one
//      category never sound identical, and when a category's take budget is
//      spent, cues overflow into a same-family category (a whoosh becomes an
//      airier whoosh, never a click).
//   2. generate/fetch each needed file (cached forever after first use)
//   3. stage it into remotion/public so staticFile() can reach it
//   4. measure each file's real duration, loudest-sample offset, and RMS level
//   5. LOUDNESS TRIM — pull any file hotter than LOUDNESS_CEILING_DB down to it.
//      Files are peak-normalized, not loudness-normalized, so without this a
//      `volume: 0.20` whoosh-deep is ~12 dB louder than a `volume: 0.20`
//      flash-pop. Attenuate-only: a cue can never end up louder than authored.
//   6. back-time every cue with a peak target so the sound's PEAK lands on the
//      animation's point of maximum motion — the difference between "an SFX
//      plays near the cut" and "the edit feels expensive"
// Best-effort throughout: a file that can't generate or probe just drops out
// and that moment stays silent.

import fs from 'fs'
import path from 'path'
import { getSfx, probeSfxTiming, ALLOWED_TAKES, type SfxCategory } from './sound-effects'
import type { SfxCue } from './render-kit'

export interface StagedSfx {
  file: string          // path relative to remotion/public
  start: number         // edited-timeline seconds, already peak-aligned
  volume: number
  durationSec: number   // real file length so the render never clips a tail
}

const MAX_PER_FILE = 2   // the variety rule: a file never plays a 3rd time

// Perceived-loudness ceiling for every staged sound, in dBFS RMS.
//
// Peak normalization (sound-effects.ts) leaves a ~12 dB spread across the
// surviving library — whoosh-deep reads -17 dB RMS, flash-pop -29 dB, both
// peaking at -3. Any file hotter than this ceiling is pulled DOWN to it.
//
// Attenuate-only, deliberately. Pushing quiet files up toward a common target
// would make some cues LOUDER than the volume their planner authored, which is
// the opposite of what this system is for. A planner's `volume` is therefore a
// hard maximum: the trim can only take away.
const LOUDNESS_CEILING_DB = -24

// Floor on the attenuation, so one unusually hot file can't be buried entirely.
const MAX_TRIM_DOWN_DB = -8

// Overflow chain per category — where a cue goes when its category's take
// budget (allowed takes × MAX_PER_FILE plays) is exhausted. Same sonic family
// only: motion sounds stay motion sounds, UI taps stay UI taps. Every target
// here must be a live category in SfxCategory.
const FAMILY: Partial<Record<SfxCategory, SfxCategory[]>> = {
  whoosh: ['whoosh-snap', 'whoosh-airy', 'whoosh-deep'],
  'whoosh-snap': ['whoosh', 'whoosh-airy', 'whoosh-deep'],
  'whoosh-airy': ['whoosh', 'whoosh-snap', 'whoosh-deep'],
  'whoosh-deep': ['whoosh', 'whoosh-snap', 'whoosh-airy'],
  pop: ['click-digital', 'flash-pop'],
  'click-digital': ['pop', 'flash-pop'],
  'flash-pop': ['pop', 'click-digital'],
  'boom-soft': ['whoosh-deep'],
}

export async function stageSfxCues(
  cues: SfxCue[],
  remotionPublicDir: string,
  publicPrefix = 'edit-cache',
): Promise<StagedSfx[]> {
  // 1. Allocate a concrete (category, take) per cue, in timeline order, so the
  //    round-robin lands different takes on neighboring cues. Only the takes
  //    listed in ALLOWED_TAKES are ever reachable — a category whose survivors
  //    are [1] cycles take 1 alone and spends its budget twice as fast as one
  //    with three takes.
  const catCount = new Map<SfxCategory, number>()
  const allocate = (cat: SfxCategory): { cat: SfxCategory; take: number } | null => {
    for (const c of [cat, ...(FAMILY[cat] ?? [])]) {
      const takes = ALLOWED_TAKES[c] ?? []
      if (takes.length === 0) continue
      const n = catCount.get(c) ?? 0
      if (n < takes.length * MAX_PER_FILE) {
        catCount.set(c, n + 1)
        return { cat: c, take: takes[n % takes.length] }
      }
    }
    return null // family fully spent — that moment stays silent
  }
  const assigned = [...cues]
    .sort((a, b) => a.start - b.start)
    .map(cue => ({ cue, slot: allocate(cue.category) }))
    .filter((a): a is { cue: SfxCue; slot: { cat: SfxCategory; take: number } } => a.slot !== null)

  // 2. Stage each distinct (category, take) file once.
  const staged = new Map<string, { rel: string; peakSec: number; durationSec: number; trim: number }>()
  for (const key of new Set(assigned.map(a => `${a.slot.cat}:${a.slot.take}`))) {
    const [cat, takeStr] = key.split(':')
    const take = Number(takeStr)
    let src: string | null = null
    try {
      src = await getSfx(cat as SfxCategory, take)
      if (!src) continue
      const rel = `${publicPrefix}/sfx-${cat}${take > 0 ? `-t${take}` : ''}.mp3`
      fs.mkdirSync(path.dirname(path.join(remotionPublicDir, rel)), { recursive: true })
      fs.copyFileSync(src, path.join(remotionPublicDir, rel))
      const { peakSec, durationSec, rmsDb } = await probeSfxTiming(src)
      // Attenuate-only trim, as a linear gain the cue volume is multiplied by.
      // Math.min(0, ...) is what guarantees trim <= 1: a file quieter than the
      // ceiling is left exactly as its planner authored it.
      const gainDb = Math.max(MAX_TRIM_DOWN_DB, Math.min(0, LOUDNESS_CEILING_DB - rmsDb))
      staged.set(key, { rel, peakSec, durationSec, trim: 10 ** (gainDb / 20) })
      console.log(`[sfx-stage] ${key}: ${rmsDb.toFixed(1)} dB RMS -> trim ${gainDb.toFixed(1)} dB (×${(10 ** (gainDb / 20)).toFixed(2)})`)
    } catch (e) {
      console.warn(`[sfx-stage] "${key}" unavailable, that moment stays silent:`, (e as Error).message)
      // A cache file that failed to decode here would fail identically on
      // every future render of this container — the exists-check in getSfx
      // would keep returning it. Purge it so the NEXT render re-fetches or
      // regenerates (and republishes, healing a poisoned shared-library copy).
      if (src && fs.existsSync(src)) {
        console.warn(`[sfx-stage] purging corrupt cache entry ${path.basename(src)} — next render regenerates it`)
        try { fs.unlinkSync(src) } catch { /* best-effort */ }
      }
    }
  }

  // 3. Peak-align each cue against ITS OWN file's timing — takes of the same
  //    category peak at different offsets — and apply the loudness trim so the
  //    cue's authored volume lands at the same apparent level for every file.
  return assigned
    .filter(a => staged.has(`${a.slot.cat}:${a.slot.take}`))
    .map(a => {
      const info = staged.get(`${a.slot.cat}:${a.slot.take}`)!
      const start = a.cue.peakAt !== undefined ? Math.max(0, a.cue.peakAt - info.peakSec) : a.cue.start
      const volume = a.cue.volume * info.trim   // trim <= 1, so never exceeds the authored volume
      return { file: info.rel, start, volume, durationSec: info.durationSec }
    })
    .sort((a, b) => a.start - b.start)
}
