// ── Color grade looks ─────────────────────────────────────────────────────────
// Phone footage reads flat and slightly cold as shot. Every job carries a
// grade mode chosen at creation (default 'smart'):
//
//   smart  — each variant's signature look: warm/vibrant for v1-v5, the dark
//            cinematic grade for v6. The curated default.
//   golden — warm, sunny, lifestyle. Forced on every variant.
//   clean  — crisp + a touch richer, no warmth shift. Most true-to-life
//            (accurate skin tone), forced on every variant.
//   moody  — dark, desaturated, dramatic. Forced on every variant.
//   off    — footage exactly as shot.
//
// v1-v3 (Submagic chain) grade via the ffmpeg pass below after the edit comes
// back; v4-v6 grade in-render (ShortEdit's grade prop) via resolveEditGrade.

import fs from 'fs'
import { exec } from 'child_process'

export type GradeMode = 'smart' | 'golden' | 'clean' | 'moody' | 'off'

export const GRADE_MODES: GradeMode[] = ['smart', 'golden', 'clean', 'moody', 'off']

export function normalizeGradeMode(raw: unknown): GradeMode {
  return GRADE_MODES.includes(raw as GradeMode) ? (raw as GradeMode) : 'smart'
}

// ffmpeg knobs per look (v1-v3 finishing chain). temperature 6500 = neutral
// (skips the filter); contrast/saturation 1.0 = untouched; brightness 0 = untouched.
const FFMPEG_GRADES: Record<Exclude<GradeMode, 'off'>, { temperature: number; contrast: number; saturation: number; brightness: number }> = {
  smart:  { temperature: 5600, contrast: 1.06, saturation: 1.18, brightness: 0 },
  golden: { temperature: 5200, contrast: 1.07, saturation: 1.24, brightness: -0.01 },
  clean:  { temperature: 6500, contrast: 1.07, saturation: 1.08, brightness: 0 },
  moody:  { temperature: 6800, contrast: 1.09, saturation: 0.86, brightness: -0.04 },
}

// Maps the job-level mode onto ShortEdit's in-render grade for v4-v6.
// 'smart' keeps the variant's own signature look from its render kit.
export function resolveEditGrade(
  mode: GradeMode | undefined,
  kitDefault: 'cinematic' | 'warm' | 'clean' | undefined,
): 'cinematic' | 'warm' | 'clean' | undefined {
  switch (mode) {
    case 'golden': return 'warm'
    case 'clean':  return 'clean'
    case 'moody':  return 'cinematic'
    case 'off':    return undefined
    default:       return kitDefault
  }
}

function run(cmd: string, timeoutMs = 600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr ?? '').slice(-500) || err.message))
      else resolve()
    })
  })
}

/** Applies the selected grade to videoPath in place (video re-encode, audio
 *  untouched). No-op for 'off'. Best-effort at call sites — a grade must
 *  never cost a finished video. */
export async function applyColorGrade(videoPath: string, mode: GradeMode = 'smart'): Promise<void> {
  if (mode === 'off') return
  const g = FFMPEG_GRADES[mode]
  const filters = [
    ...(g.temperature !== 6500 ? [`colortemperature=temperature=${g.temperature}`] : []),
    `eq=contrast=${g.contrast}:saturation=${g.saturation}${g.brightness !== 0 ? `:brightness=${g.brightness}` : ''}`,
  ].join(',')
  const tmp = videoPath + '_grade.mp4'
  await run(
    `ffmpeg -y -i "${videoPath}" -vf "${filters}" ` +
    `-c:v libx264 -preset veryfast -crf 19 -c:a copy -movflags +faststart "${tmp}"`,
  )
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw new Error('color grade produced no output')
  }
  fs.renameSync(tmp, videoPath)
  console.log(`[color-grade] ${mode} grade applied (${filters})`)
}
