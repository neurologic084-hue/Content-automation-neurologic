// ── Pre-cut for the Submagic variants (v1-v3) ─────────────────────────────────
// Submagic's own silence / bad-take cutting is hit-or-miss. So instead of
// handing Submagic the raw clip and letting it cut, we make the cuts ourselves
// with the SAME planner the Remotion variants use (silence + retake + stutter +
// filler removal, hard-validated), producing a clean trimmed clip that carries
// NO captions / transitions / SFX. Submagic then only does what it's good at:
// premium captions + zoom styling on top of an already-tight cut.
//
// Submagic re-transcribes whatever file it receives, so its captions sync to the
// trimmed clip automatically — we don't need to pass our word timings through.
//
// Best-effort end to end: any failure returns null and the caller falls back to
// the uncut compressed source (Submagic cuts on its own, exactly as before).

import fs from 'fs'
import { exec } from 'child_process'
import { transcribeLocalFile, type WordTimestamp } from './caption-renderer'
import { detectSilences } from './audio-clean'
import { planKeepSegments, type KeepSegment } from './edit-plan'

// Flip to false to hand cutting back to Submagic for v1-v3 (e.g. if a pre-cut
// clip ever confuses Submagic's caption alignment). Nothing else needs changing.
export const PRECUT_FOR_SUBMAGIC = true

const FPS = 30
// Don't pay for a full re-encode to shave off less than this — let Submagic's
// own (now gentle) pass mop up the rest.
const MIN_REMOVED_SEC = 0.8

function run(cmd: string, timeoutMs = 600_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _o, stderr) => {
      if (err) reject(new Error((stderr ?? '').slice(-500) || err.message))
      else resolve()
    })
  })
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (_err, stdout) => resolve(parseFloat((stdout ?? '').trim()) || 0),
    )
  })
}

export interface SubmagicCutResult {
  path: string
  // The exact keep-windows the ffmpeg select expression was built from, in
  // SOURCE seconds. They are the timeline map: anything that must be timed
  // against the cut file (custom B-roll placements) maps source times through
  // these via mapWordsToCutTimeline, instead of guessing from a second
  // transcription of the cut.
  keep: KeepSegment[]
  // The word timings the cut was planned from (source timeline).
  words: WordTimestamp[]
}

/** Produces a physically-trimmed copy of `compressedPath` at `outPath` using our
 *  cut planner, ready to feed Submagic for caption-only styling. Returns the
 *  output path plus the keep-windows it was cut from, or null when disabled /
 *  nothing worth cutting / any failure.
 *
 *  Pass `opts.words` to reuse a transcript prep already made (the shared clean
 *  now runs before this) instead of paying for a second transcription of the
 *  same footage. Those timings are on the CLEANED audio, which is remuxed in
 *  sync with this same video, so they line up with the compressed source we cut
 *  here; a list that overruns the clip (a stale re-prep) is rejected and we fall
 *  back to transcribing. */
export async function buildSubmagicCutSource(
  compressedPath: string,
  outPath: string,
  opts: { words?: WordTimestamp[] } = {},
): Promise<SubmagicCutResult | null> {
  if (!PRECUT_FOR_SUBMAGIC) return null
  try {
    const duration = await probeDuration(compressedPath)
    if (duration < 8) return null

    // Reuse the shared transcript when it fits this clip; otherwise transcribe.
    let words = opts.words && opts.words.length >= 10 ? opts.words : null
    if (words && (words[words.length - 1]?.end ?? 0) > duration + 2) words = null
    if (words) console.log('[precut] reusing the job transcript (no second transcription)')
    else words = await transcribeLocalFile(compressedPath)
    if (words.length < 10) return null

    // Energy-detected silence is the second cut signal (word timings alone miss
    // pauses the transcript stretches across) — same inputs the Remotion cut uses.
    const silences = await detectSilences(compressedPath, { noiseDb: -38, minDurationSec: 0.4 }).catch(() => [])
    const keep = await planKeepSegments(words, duration, { silences })
    if (!keep.length) return null

    const kept = keep.reduce((total, s) => total + Math.max(0, s.end - s.start), 0)
    if (duration - kept < MIN_REMOVED_SEC) {
      console.log(`[precut] only ${(duration - kept).toFixed(1)}s to trim — leaving it to Submagic`)
      return null
    }

    // Snap every keep-window to the 30fps grid: the video track drops whole
    // frames while audio cuts at sample precision, so unsnapped windows leave a
    // sliver of drift per cut that compounds into visible lip-sync error.
    const snap = (t: number) => Math.round(t * FPS) / FPS
    const expr = keep
      .map(s => `between(t,${snap(Math.max(0, s.start)).toFixed(3)},${snap(s.end).toFixed(3)})`)
      .join('+')

    await run(
      `ffmpeg -y -i "${compressedPath}" -filter_complex ` +
      `"[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[v];` +
      `[0:a]aselect='${expr}',asetpts=N/SR/TB[a]" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 19 ` +
      `-c:a aac -b:a 192k -movflags +faststart "${outPath}"`,
      // Scales with the footage: the 600s default was sized for shorts and
      // would kill this re-encode mid-flight on a long (but allowed) upload.
      Math.min(45 * 60_000, Math.max(600_000, duration * 1_500 + 300_000)),
    )

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      try { fs.unlinkSync(outPath) } catch { /* best-effort */ }
      return null
    }
    console.log(`[precut] built cut source: ${(duration - kept).toFixed(1)}s removed across ${keep.length} kept segment(s)`)
    return { path: outPath, keep, words }
  } catch (e) {
    console.warn('[precut] failed — Submagic will cut on its own:', (e as Error).message)
    return null
  }
}

/** Maps source-timeline word timings onto the CUT file's timeline, using the
 *  same 30fps-snapped keep-windows the ffmpeg select expression trimmed with —
 *  so the mapped times land on the exact frames Submagic receives, not on an
 *  approximation. Words that were cut away are dropped. This is what lets
 *  custom B-roll placements be planned against the file Submagic actually gets:
 *  timing them against any other cut of the footage is the bug that made
 *  Submagic reject whole submissions (a cutaway past the end of the video). */
export function mapWordsToCutTimeline(
  words: { text: string; start: number; end: number }[],
  keep: KeepSegment[],
): { text: string; start: number; end: number }[] {
  const snap = (t: number) => Math.round(t * 30) / 30
  // Cut-timeline offset at which each keep-window begins.
  const segments = [...keep]
    .sort((a, b) => a.start - b.start)
    .map(s => ({ start: snap(Math.max(0, s.start)), end: snap(s.end) }))
    .filter(s => s.end > s.start)
  let offset = 0
  const placed: { srcStart: number; srcEnd: number; cutStart: number }[] = []
  for (const s of segments) {
    placed.push({ srcStart: s.start, srcEnd: s.end, cutStart: offset })
    offset += s.end - s.start
  }
  const out: { text: string; start: number; end: number }[] = []
  for (const w of words) {
    // A word survives if its midpoint survived the cut; its edges are clamped
    // into the window so a word straddling a cut boundary can't map past it.
    const mid = (w.start + w.end) / 2
    const seg = placed.find(p => mid >= p.srcStart && mid < p.srcEnd)
    if (!seg) continue
    const start = seg.cutStart + Math.max(0, Math.min(w.start, seg.srcEnd) - seg.srcStart)
    const end = seg.cutStart + Math.max(0, Math.min(w.end, seg.srcEnd) - seg.srcStart)
    if (end <= start) continue
    out.push({ text: w.text, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) })
  }
  return out
}
