// ── Visual transition accents for the Submagic variants ──────────────────────
// Submagic gives v1-v3 its zoom punch-ins (magicZooms), but its API has no
// flash/glow vocabulary. This pass adds that layer locally on the FINISHED
// file: at a smart subset of the edit's own cuts, a colored veil fades in and
// out — a hard white flash, a soft glow-up, or a black dip. Deliberately
// sparse: only a fraction of cuts get one (energy-scaled), never two within a
// few seconds, never in the first or last second. Runs before the music/SFX
// passes so the whooshes land on the same cuts the eyes see flash.

import fs from 'fs'
import { exec } from 'child_process'
import type { ContentProfile } from './video-analysis'

const MIN_GAP_SEC = 4        // minimum spacing between two veils
const EDGE_GUARD_SEC = 1     // never inside the first/last second
const MAX_VEILS = 12

function run(cmd: string, timeoutMs = 600_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const proc = exec(cmd, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 }, (err) =>
      err ? reject(new Error(buf.slice(-500) || err.message)) : resolve(buf)
    )
    proc.stderr?.on('data', (d) => { buf += String(d) })
  })
}

// ffprobe writes to stdout — run() collects stderr, so probing execs directly.
async function probeJson(videoPath: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of json "${videoPath}"`,
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve({ width: 1080, height: 1920, duration: 0 })
        try {
          const data = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } }
          resolve({
            width: data.streams?.[0]?.width ?? 1080,
            height: data.streams?.[0]?.height ?? 1920,
            duration: parseFloat(data.format?.duration ?? '0') || 0,
          })
        } catch {
          resolve({ width: 1080, height: 1920, duration: 0 })
        }
      }
    )
  })
}

// Scene-cut recovery WITH per-cut impact scores. A jump-cut inside the same
// talking-head shot barely moves the scene score; B-roll entering or leaving
// replaces the whole frame and scores high. Scoring every candidate lets the
// selector give veils to the strongest B-roll transitions only — trim cuts
// never qualify.
interface ScoredCut { t: number; score: number }

async function detectCuts(videoPath: string): Promise<ScoredCut[]> {
  const stderr = await run(
    `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.30)',metadata=print" -f null -`,
    180_000,
  )
  const cuts: ScoredCut[] = []
  let pendingT: number | null = null
  for (const line of stderr.split('\n')) {
    const t = line.match(/pts_time:([\d.]+)/)
    if (t) pendingT = parseFloat(t[1])
    const s = line.match(/lavfi\.scene_score=([\d.]+)/)
    if (s && pendingT !== null) {
      cuts.push({ t: pendingT, score: parseFloat(s[1]) })
      pendingT = null
    }
  }
  return cuts
}

interface Veil {
  at: number
  color: 'white' | 'black'
  peak: number    // max opacity 0..1
  inDur: number
  outDur: number
}

// The three moves, per the creative brief: screen-goes-white flash, soft
// glow-up, and a black dip ("glow down").
const FLASH = { color: 'white' as const, peak: 0.85, inDur: 0.06, outDur: 0.14 }
const GLOW = { color: 'white' as const, peak: 0.35, inDur: 0.14, outDur: 0.28 }
const DIP = { color: 'black' as const, peak: 0.65, inDur: 0.08, outDur: 0.16 }

/** Adds veil transitions at a smart subset of scene cuts, in place.
 *  Returns how many were applied (0 = file untouched). */
export async function applyVisualTransitions(
  videoPath: string,
  profile: ContentProfile | null,
): Promise<number> {
  const { width, height, duration } = await probeJson(videoPath)
  if (!duration) return 0

  const cuts = await detectCuts(videoPath)
  if (!cuts.length) return 0

  // Energy decides how MANY transitions earn a veil.
  const energy = profile?.energy ?? 'medium'
  const fraction = energy === 'high' ? 0.4 : energy === 'low' ? 0.15 : 0.25

  // B-roll-grade transitions only: a full-frame replacement scores ≥0.45;
  // jump cuts and punch-ins score below it and never get a veil.
  const eligible = cuts.filter(c =>
    c.score >= 0.45 && c.t > EDGE_GUARD_SEC && c.t < duration - EDGE_GUARD_SEC
  )
  if (!eligible.length) return 0
  const target = Math.min(MAX_VEILS, Math.max(1, Math.round(eligible.length * fraction)))

  // Smart pick: strongest frame-changes first (the real B-roll swaps), each
  // respecting the spacing rule against everything already chosen.
  const chosen: ScoredCut[] = []
  for (const c of [...eligible].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= target) break
    if (chosen.every(x => Math.abs(x.t - c.t) >= MIN_GAP_SEC)) chosen.push(c)
  }
  chosen.sort((a, b) => a.t - b.t)

  // Style matched to impact and mood: the hardest swaps flash white, medium
  // ones glow up; every third becomes a black dip for rhythm. Calm footage
  // gets soft glows only.
  const veils: Veil[] = chosen.map((c, i) => {
    const style = energy === 'low'
      ? GLOW
      : i % 3 === 2 ? DIP : c.score >= 0.6 ? FLASH : GLOW
    return { at: c.t, ...style }
  })
  if (!veils.length) return 0

  // One overlay chain per veil: a colored clip with alpha fades, shifted to
  // its cut time. eof_action=pass keeps the base video running after each
  // veil clip ends.
  const sources = veils.map((v, i) => {
    const d = (v.inDur + v.outDur).toFixed(3)
    return (
      `color=c=${v.color}:s=${width}x${height}:d=${d}:r=30,format=yuva420p,` +
      `fade=t=in:st=0:d=${v.inDur}:alpha=1,fade=t=out:st=${v.inDur}:d=${v.outDur}:alpha=1,` +
      `colorchannelmixer=aa=${v.peak},setpts=PTS-STARTPTS+${v.at.toFixed(3)}/TB[veil${i}]`
    )
  })
  const chains: string[] = []
  let prev = '[0:v]'
  veils.forEach((_, i) => {
    const out = i === veils.length - 1 ? '[outv]' : `[b${i}]`
    chains.push(`${prev}[veil${i}]overlay=eof_action=pass${out === '[outv]' ? ',format=yuv420p' : ''}${out}`)
    prev = out === '[outv]' ? '' : out
  })

  const tmp = videoPath + '_veil.mp4'
  await run(
    `ffmpeg -y -i "${videoPath}" -filter_complex ` +
    `"${[...sources, ...chains].join(';')}" ` +
    `-map "[outv]" -map "0:a?" -c:v libx264 -preset veryfast -crf 19 -c:a copy -movflags +faststart "${tmp}"`,
  )

  if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 1000) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw new Error('visual transition render produced no output')
  }
  fs.renameSync(tmp, videoPath)
  console.log(`[visual-transitions] ${veils.length} veil(s) applied (energy: ${energy}) at ${veils.map(v => v.at.toFixed(1)).join(', ')}s`)
  return veils.length
}
