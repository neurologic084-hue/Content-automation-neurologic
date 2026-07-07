// ── Residual-silence backstop ─────────────────────────────────────────────────
// Submagic runs extra-fast silence removal, but the occasional long gap still
// survives their cut. This pass runs on the FINISHED Submagic file and trims
// any remaining dead air — conservatively: only clearly-quiet stretches, with
// breathing-room padding on both sides so a cut can never clip into a word.
// Captions are already burned in, but silences have no caption on screen, so
// cutting them is visually safe.

import fs from 'fs'
import { exec } from 'child_process'
import { detectSilences } from './audio-clean'

const MIN_RESIDUAL_SEC = 0.55  // only silences at least this long get cut
const EDGE_PAD_SEC = 0.15      // breathing room kept on each side of a cut
const HEAD_GUARD_SEC = 0.5     // never touch the very top — that's the hook
const MAX_CUTS = 60

function run(cmd: string, timeoutMs = 600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 64 }, (err, _out, stderr) => {
      if (err) reject(new Error(`${err.message}\n${(stderr ?? '').slice(-500)}`))
      else resolve()
    })
  })
}

/** Trims residual silences from videoPath in place.
 *  Returns the seconds removed (0 = nothing worth cutting, file untouched). */
export async function trimResidualSilences(videoPath: string): Promise<number> {
  // Slightly stricter noise floor than the word-gap detector (-40dB vs -38dB)
  // so quiet-but-present speech never reads as silence.
  const silences = await detectSilences(videoPath, { noiseDb: -40, minDurationSec: MIN_RESIDUAL_SEC })

  const cuts = silences
    .map(([s, e]) => [s + EDGE_PAD_SEC, e - EDGE_PAD_SEC] as [number, number])
    .filter(([s, e]) => e - s >= 0.25)
    .filter(([s]) => s > HEAD_GUARD_SEC)
    .slice(0, MAX_CUTS)

  if (!cuts.length) {
    console.log('[post-trim] no residual silences worth cutting')
    return 0
  }

  const removed = cuts.reduce((total, [s, e]) => total + (e - s), 0)
  const expr = cuts.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join('+')
  const tmp = videoPath + '_trim.mp4'

  await run(
    `ffmpeg -y -i "${videoPath}" -filter_complex ` +
    `"[0:v]select='not(${expr})',setpts=N/FRAME_RATE/TB[v];` +
    `[0:a]aselect='not(${expr})',asetpts=N/SR/TB[a]" ` +
    `-map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 19 ` +
    `-c:a aac -b:a 192k -movflags +faststart "${tmp}"`,
  )

  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw new Error('residual-silence trim produced no output')
  }
  fs.renameSync(tmp, videoPath)
  console.log(`[post-trim] cut ${cuts.length} residual silence(s), ${removed.toFixed(1)}s removed`)
  return removed
}
