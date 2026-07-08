// ── Warm & vibrant color grade (Submagic variants) ───────────────────────────
// Submagic returns footage exactly as shot — phone footage often reads flat
// and slightly cold. This pass adds a gentle "graded" look: a touch more
// contrast, richer color, and a warmer temperature. Values are deliberately
// subtle: skin should look healthy, never orange.
//
// v4-v6 get their equivalent in-render (ShortEdit's grade prop), so this file
// only serves the v1-v3 finishing chain.

import fs from 'fs'
import { exec } from 'child_process'

// ── Tuning knobs ──────────────────────────────────────────────────────────────
const CONTRAST = 1.06      // 1.0 = untouched; 1.1 starts to crush shadows
const SATURATION = 1.18    // 1.0 = untouched; 1.3+ tips into Instagram-filter
const TEMPERATURE = 5600   // Kelvin target; 6500 = neutral, lower = warmer

function run(cmd: string, timeoutMs = 600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr ?? '').slice(-500) || err.message))
      else resolve()
    })
  })
}

/** Applies the warm-vibrant grade to videoPath in place (video re-encode,
 *  audio untouched). Best-effort at call sites — a grade must never cost a
 *  finished video. */
export async function applyColorGrade(videoPath: string): Promise<void> {
  const tmp = videoPath + '_grade.mp4'
  await run(
    `ffmpeg -y -i "${videoPath}" -vf ` +
    `"colortemperature=temperature=${TEMPERATURE},eq=contrast=${CONTRAST}:saturation=${SATURATION}" ` +
    `-c:v libx264 -preset veryfast -crf 19 -c:a copy -movflags +faststart "${tmp}"`,
  )
  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw new Error('color grade produced no output')
  }
  fs.renameSync(tmp, videoPath)
  console.log(`[color-grade] warm grade applied (temp ${TEMPERATURE}K, sat ${SATURATION}, contrast ${CONTRAST})`)
}
