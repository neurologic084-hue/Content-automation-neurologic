// ── SFX staging + peak alignment ──────────────────────────────────────────────
// Turns planned cues (lib/render-kit.ts) into render-ready audio props:
//   1. generate/fetch each category's file (cached forever after first use)
//   2. stage it into remotion/public so staticFile() can reach it
//   3. measure the file's real duration and loudest-sample offset
//   4. back-time every cue with a peak target so the sound's PEAK lands on the
//      animation's point of maximum motion — the difference between "an SFX
//      plays near the cut" and "the edit feels expensive"
// Best-effort throughout: a category that can't generate or probe just drops
// out and that moment stays silent.

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

export async function stageSfxCues(
  cues: SfxCue[],
  remotionPublicDir: string,
  publicPrefix = 'edit-cache',
): Promise<StagedSfx[]> {
  const staged = new Map<SfxCategory, { rel: string; peakSec: number; durationSec: number }>()

  for (const category of new Set(cues.map(c => c.category))) {
    try {
      const src = await getSfx(category)
      if (!src) continue
      const rel = `${publicPrefix}/sfx-${category}.mp3`
      fs.mkdirSync(path.dirname(path.join(remotionPublicDir, rel)), { recursive: true })
      fs.copyFileSync(src, path.join(remotionPublicDir, rel))
      const timing = await probeSfxTiming(src)
      staged.set(category, { rel, ...timing })
    } catch (e) {
      console.warn(`[sfx-stage] "${category}" unavailable, that moment stays silent:`, (e as Error).message)
    }
  }

  return cues
    .filter(c => staged.has(c.category))
    .map(c => {
      const info = staged.get(c.category)!
      const start = c.peakAt !== undefined ? Math.max(0, c.peakAt - info.peakSec) : c.start
      return { file: info.rel, start, volume: c.volume, durationSec: info.durationSec }
    })
    .sort((a, b) => a.start - b.start)
}
