import { ensureFfmpegOnPath } from './ffmpeg-env'
import { exec } from 'child_process'
import fs from 'fs'
import { transcribeLocalFile } from './caption-renderer'

// Patch PATH to the bundled ffmpeg/ffprobe before any exec runs. Called
// explicitly (not a bare side-effect import) so the bundler can't drop it.
ensureFfmpegOnPath()
import type { WordTimestamp } from './caption-renderer'

// ── Smart cut: a deterministic precision pass on top of Descript's AI cut ────
// Descript's Underlord handles semantic judgment (bad takes, false starts,
// Studio Sound). This layer only removes things that are mechanically safe to
// remove — no language understanding required, so no risk of cutting real
// content. Runs on the post-Descript output and re-transcribes once more so
// caption timing downstream is always exact.

// Standalone filler interjections — never carry sentence meaning on their own.
// Deliberately excludes context-dependent words ("like", "so", "actually",
// "right") that are frequently real words in a sentence — those are left to
// Descript's semantic pass, since blind removal would butcher real speech.
const FILLER_INTERJECTIONS = new Set([
  'um', 'umm', 'ummm', 'uh', 'uhh', 'uhm', 'er', 'err', 'erm', 'hmm', 'hmmm',
])

export interface CutSegment {
  start: number
  end: number
  reason: 'dead-air-head' | 'dead-air-tail' | 'silence' | 'filler' | 'stutter'
}

function run(cmd: string, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr?.slice(-500) || err.message))
      else resolve()
    })
  })
}

async function getDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (_err, stdout) => resolve(parseFloat(stdout.trim()) || 0)
    )
  })
}

// Finds segments to remove. Each rule is purely mechanical:
//  - dead-air-head/tail: silence before first word / after last word
//  - silence: mid-video gaps the Descript pass left behind
//  - filler: standalone interjections (um, uh, erm...)
//  - stutter: the same word spoken twice back-to-back with a tiny gap
export function findSmartCutSegments(
  words: WordTimestamp[],
  totalDuration: number,
  silenceThreshold = 0.6,
): CutSegment[] {
  if (!words.length) return []
  const segments: CutSegment[] = []

  // Leading dead air — keep a 100ms lead-in before the first word
  const headEnd = Math.max(0, words[0].start - 0.1)
  if (headEnd > 0.15) segments.push({ start: 0, end: headEnd, reason: 'dead-air-head' })

  // Trailing dead air — keep a 300ms hold after the last word
  const lastWord = words[words.length - 1]
  const tailStart = lastWord.end + 0.3
  if (totalDuration - tailStart > 0.15) {
    segments.push({ start: tailStart, end: totalDuration, reason: 'dead-air-tail' })
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const clean = w.text.toLowerCase().replace(/[^a-z]/g, '')

    if (FILLER_INTERJECTIONS.has(clean)) {
      segments.push({ start: Math.max(0, w.start - 0.05), end: w.end + 0.05, reason: 'filler' })
      continue
    }

    if (i > 0) {
      const prev = words[i - 1]
      const prevClean = prev.text.toLowerCase().replace(/[^a-z]/g, '')
      if (clean && clean === prevClean && w.start - prev.end < 0.3) {
        // Remove the earlier repeat, keep the later one
        segments.push({ start: Math.max(0, prev.start - 0.05), end: prev.end + 0.02, reason: 'stutter' })
      }
    }

    if (i < words.length - 1) {
      const gap = words[i + 1].start - w.end
      if (gap >= silenceThreshold) {
        segments.push({ start: w.end + 0.1, end: words[i + 1].start - 0.1, reason: 'silence' })
      }
    }
  }

  return segments.filter(s => s.end > s.start).sort((a, b) => a.start - b.start)
}

// Cuts the given segments out, keeping everything else, via FFmpeg select/aselect
// on the inverse ranges. Re-encodes (constant frame rate output required by
// setpts), but only runs on already-short-form video so cost is small.
export async function applySmartCuts(
  videoPath: string,
  segments: CutSegment[],
  totalDuration: number,
): Promise<void> {
  if (!segments.length) return

  const merged: CutSegment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end + 0.05) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ ...seg })
    }
  }

  const keep: { start: number; end: number }[] = []
  let cursor = 0
  for (const seg of merged) {
    if (seg.start > cursor) keep.push({ start: cursor, end: seg.start })
    cursor = Math.max(cursor, seg.end)
  }
  if (cursor < totalDuration) keep.push({ start: cursor, end: totalDuration })

  const keepFiltered = keep.filter(k => k.end - k.start > 0.05)
  if (!keepFiltered.length) {
    console.warn('[smart-cut] all segments would be cut, aborting smart-cut pass')
    return
  }

  const totalCut = merged.reduce((sum, s) => sum + (s.end - s.start), 0)
  console.log(
    `[smart-cut] removing ${merged.length} segments (${totalCut.toFixed(2)}s total): ` +
    merged.map(s => `${s.reason}@${s.start.toFixed(1)}s`).join(', ')
  )

  const selectExpr = keepFiltered.map(k => `between(t,${k.start.toFixed(3)},${k.end.toFixed(3)})`).join('+')
  const tmp = videoPath + '_sc.mp4'

  try {
    await run(
      `ffmpeg -y -i "${videoPath}" -filter_complex ` +
      `"[0:v]select='${selectExpr}',setpts=N/FRAME_RATE/TB[v];` +
      `[0:a]aselect='${selectExpr}',asetpts=N/SR/TB[a]" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 20 -c:a aac -movflags +faststart "${tmp}"`,
      300_000
    )
    if (fs.existsSync(tmp)) fs.renameSync(tmp, videoPath)
  } catch (e) {
    console.warn('[smart-cut] cut pass failed, keeping original:', (e as Error).message)
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
  }
}

// Full pass: transcribe → find cut segments → apply. Safe to call on any
// already-cut video as a precision polish on top of Descript's rough cut.
export async function smartCutPass(videoPath: string): Promise<void> {
  let words: WordTimestamp[]
  try {
    words = await transcribeLocalFile(videoPath)
  } catch (e) {
    console.warn('[smart-cut] transcription failed, skipping smart-cut pass:', (e as Error).message)
    return
  }
  if (!words.length) {
    console.warn('[smart-cut] no transcript, skipping smart-cut pass')
    return
  }

  const duration = await getDuration(videoPath)
  if (!duration) return

  const segments = findSmartCutSegments(words, duration)
  if (!segments.length) {
    console.log('[smart-cut] no cuts needed, already tight')
    return
  }
  await applySmartCuts(videoPath, segments, duration)
}
