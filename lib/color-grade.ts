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
  // smart adds ZERO warmth (6500 short-circuits the temperature filter): the
  // final blind round scored this recipe highest of the natural looks (7.5/10,
  // 3/4 ship-ok) and any residual warm reading is the room's own light, which
  // shows on the ungraded reference too. If it isn't us, don't fight over it.
  smart:  { temperature: 6500, contrast: 1.05, saturation: 1.04, brightness: -0.02 },
  golden: { temperature: 6150, contrast: 1.05, saturation: 1.06, brightness: -0.03 },
  clean:  { temperature: 6500, contrast: 1.05, saturation: 1.04, brightness: -0.015 },
  moody:  { temperature: 6800, contrast: 1.09, saturation: 0.86, brightness: -0.04 },
}
// Warmth retuned 2026-07-20 after measuring shipped renders — the client's
// "very very yellow" was real and large, not a matter of taste.
//
// Measured on her face (Haar box, inner 64%, vs the same job's ungraded source):
// shipped `smart` moved blue -32.6% and the blue/red ratio -38.3%, with 16% of
// face pixels clipping a channel. `clean` — which short-circuits the temperature
// filter entirely at 6500 — measures -4.5%, so ~-5% is the floor for "we changed
// nothing about colour". Warm was running at six times that.
//
// Then tuned AGAIN the same day after the client said warm was still too
// yellow and too bright — this time judged blind by Gemini vision on her real
// frames (two rounds, 4 frames each, graded candidates shuffled against the
// ungraded reference), not just by channel ratios:
//
//   - candidates that raised brightness or saturation were flagged "too
//     bright" — her footage is already bright, warm indoor light, so a grade
//     that ADDS either reads as artificial on top of it;
//   - even fully neutral grades drew "too yellow" flags, because the ROOM is
//     warm. The winner (natural 7/10, zero brightness flags) pairs a trace of
//     temperature with saturation near unity and a slight dim (-0.03), which
//     flatters the footage instead of amplifying it.
//
// So every mode now dims slightly rather than brightens, saturation stays
// within a few percent of unity, and warmth is a trace even in `golden`
// (6150 vs the original 5200 — most of the "warm look" is gone on purpose;
// the client asked for it "very, very reduced"). Numbers are per-footage
// judgements, not universal truths: if her lighting setup changes, re-run
// the frame sweep before trusting them.

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
