// ── SFX staging + peak alignment + variety allocation ─────────────────────────
// Turns planned cues (lib/render-kit.ts) into render-ready audio props:
//   1. VARIETY RULE — no single sound file plays more than TWICE in one video.
//      Each category has up to 3 generated "takes" (same prompt, different
//      ElevenLabs generation = a genuinely different sound); takes rotate
//      round-robin so back-to-back cues of one category never sound identical,
//      and when a category's take budget is spent, cues overflow into a
//      same-family category (a whoosh becomes an airier whoosh, never a ding).
//   2. generate/fetch each needed file (cached forever after first use)
//   3. stage it into remotion/public so staticFile() can reach it
//   4. measure each file's real duration and loudest-sample offset
//   5. back-time every cue with a peak target so the sound's PEAK lands on the
//      animation's point of maximum motion — the difference between "an SFX
//      plays near the cut" and "the edit feels expensive"
// Best-effort throughout: a file that can't generate or probe just drops out
// and that moment stays silent.

import fs from 'fs'
import path from 'path'
import { getSfx, probeSfxTiming, type SfxCategory } from './sound-effects'
import type { SfxCue } from './render-kit'

export interface StagedSfx {
  file: string          // path relative to remotion/public
  start: number         // edited-timeline seconds, already peak-aligned
  volume: number
  durationSec: number   // real file length so the render never clips a tail
}

const MAX_PER_FILE = 2   // the variety rule: a file never plays a 3rd time
const MAX_TAKES = 3      // generated versions per category

// Overflow chain per category — where a cue goes when its category's take
// budget (MAX_TAKES × MAX_PER_FILE plays) is exhausted. Same sonic family
// only: motion sounds stay motion sounds, UI taps stay UI taps.
const FAMILY: Partial<Record<SfxCategory, SfxCategory[]>> = {
  whoosh: ['whoosh-snap', 'whoosh-airy', 'whoosh-deep'],
  'whoosh-snap': ['whoosh', 'whoosh-airy', 'whoosh-deep'],
  'whoosh-airy': ['whoosh', 'whoosh-snap', 'whoosh-deep'],
  'whoosh-deep': ['whoosh', 'whoosh-snap', 'whoosh-airy'],
  pop: ['click-digital', 'shutter-soft', 'flash-pop'],
  'click-digital': ['pop', 'shutter-soft', 'flash-pop'],
  'flash-pop': ['pop', 'click-digital', 'shutter-soft'],
  shutter: ['shutter-soft', 'pop', 'click-digital'],
  'shutter-soft': ['shutter', 'pop', 'click-digital'],
  ding: ['pop', 'click-digital', 'shutter-soft'],
  'boom-soft': ['impact', 'boom-808', 'whoosh-deep'],
  impact: ['boom-soft', 'boom-808', 'whoosh-deep'],
  'boom-808': ['boom-soft', 'impact', 'whoosh-deep'],
  shing: ['whoosh-snap', 'click-digital'],
  glitch: ['tape-stop', 'whoosh-snap'],
  'tape-stop': ['glitch', 'whoosh-snap'],
}

export async function stageSfxCues(
  cues: SfxCue[],
  remotionPublicDir: string,
  publicPrefix = 'edit-cache',
): Promise<StagedSfx[]> {
  // 1. Allocate a concrete (category, take) per cue, in timeline order, so the
  //    round-robin lands different takes on neighboring cues.
  const catCount = new Map<SfxCategory, number>()
  const allocate = (cat: SfxCategory): { cat: SfxCategory; take: number } | null => {
    for (const c of [cat, ...(FAMILY[cat] ?? [])]) {
      const n = catCount.get(c) ?? 0
      if (n < MAX_TAKES * MAX_PER_FILE) {
        catCount.set(c, n + 1)
        return { cat: c, take: n % MAX_TAKES }
      }
    }
    return null // family fully spent — that moment stays silent
  }
  const assigned = [...cues]
    .sort((a, b) => a.start - b.start)
    .map(cue => ({ cue, slot: allocate(cue.category) }))
    .filter((a): a is { cue: SfxCue; slot: { cat: SfxCategory; take: number } } => a.slot !== null)

  // 2. Stage each distinct (category, take) file once.
  const staged = new Map<string, { rel: string; peakSec: number; durationSec: number }>()
  for (const key of new Set(assigned.map(a => `${a.slot.cat}:${a.slot.take}`))) {
    const [cat, takeStr] = key.split(':')
    const take = Number(takeStr)
    try {
      const src = await getSfx(cat as SfxCategory, take)
      if (!src) continue
      const rel = `${publicPrefix}/sfx-${cat}${take > 0 ? `-t${take}` : ''}.mp3`
      fs.mkdirSync(path.dirname(path.join(remotionPublicDir, rel)), { recursive: true })
      fs.copyFileSync(src, path.join(remotionPublicDir, rel))
      const timing = await probeSfxTiming(src)
      staged.set(key, { rel, ...timing })
    } catch (e) {
      console.warn(`[sfx-stage] "${key}" unavailable, that moment stays silent:`, (e as Error).message)
    }
  }

  // 3. Peak-align each cue against ITS OWN file's timing — takes of the same
  //    category peak at different offsets.
  return assigned
    .filter(a => staged.has(`${a.slot.cat}:${a.slot.take}`))
    .map(a => {
      const info = staged.get(`${a.slot.cat}:${a.slot.take}`)!
      const start = a.cue.peakAt !== undefined ? Math.max(0, a.cue.peakAt - info.peakSec) : a.cue.start
      return { file: info.rel, start, volume: a.cue.volume, durationSec: info.durationSec }
    })
    .sort((a, b) => a.start - b.start)
}
