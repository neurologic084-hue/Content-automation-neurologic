// ── Best-part (chorus / drop) detection ───────────────────────────────────────
// For each track, finds where the most energetic sustained section begins and
// stores it as startOffset, so the mix starts the music there instead of at the
// intro. This is the energy-envelope approximation of chorus detection: scan the
// short-term loudness over the whole track (ffmpeg ebur128), find the loudest
// sustained region, and take its onset. Tracks whose filename names the drop
// ("beat drop 13 seconds") use that explicitly.
//
// NOTE: this is the loudness/energy approach. The full Spotify-style method also
// uses a self-similarity matrix over chroma to find the most-REPEATED section
// (the true chorus) — that needs a DSP/MIR library (librosa/Essentia) and would
// be a separate service. Energy alone is a strong proxy for short-form use.
//
// Run it:
//   npm run music:analyze            (skips tracks already analyzed)
//   npm run music:analyze -- --force (re-analyze everything)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { MUSIC_CATALOG } from './catalog'
import { serializeCatalog } from './catalog-format'
import { musicLibraryDir } from './resolve'
import type { MusicTrack } from './types'

const execAsync = promisify(exec)
const FFMPEG = ffmpegStatic as unknown as string
const FFPROBE = (ffprobeStatic as { path: string }).path
const CATALOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.ts')

const LEAD = 1.0          // start this many seconds before the loud section onset (fade covers it)
const MIN_RUNWAY = 15     // keep at least this many seconds of track after the offset
const SUSTAIN = 3         // a section must stay loud this many seconds to count as the chorus
const THRESHOLD_DB = 4    // "loud" = within this many dB of the track's peak short-term loudness

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

async function getDuration(file: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `"${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
    )
    const d = parseFloat(stdout.trim())
    return d > 0 ? d : 0
  } catch { return 0 }
}

// "beat drop 13 seconds", "drop at 14 sec", "beat drop 13s"
function dropHint(title: string): number | null {
  const m = title.match(/drop\s*(?:at\s*)?(\d{1,3})\s*(?:s\b|sec|second)/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 && n < 600 ? n : null
}

// Parse ffmpeg ebur128 short-term loudness (S) over time → [{t, s}].
async function loudnessEnvelope(file: string): Promise<{ t: number; s: number }[]> {
  const { stderr } = await execAsync(
    `"${FFMPEG}" -nostats -i "${file}" -filter_complex ebur128 -f null -`,
    { maxBuffer: 256 * 1024 * 1024 },
  )
  const env: { t: number; s: number }[] = []
  const re = /t:\s*([\d.]+).*?\bS:\s*(-?[\d.]+|-?inf|nan)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1])
    const s = parseFloat(m[2])
    if (Number.isFinite(t) && Number.isFinite(s) && s > -70) env.push({ t, s })
  }
  return env
}

// Onset of the loudest sustained region.
function chorusOnset(env: { t: number; s: number }[]): number {
  if (env.length < 3) return 0
  const peak = Math.max(...env.map(e => e.s))
  const threshold = peak - THRESHOLD_DB

  // Earliest point where loudness stays above threshold for >= SUSTAIN seconds.
  for (let i = 0; i < env.length; i++) {
    if (env[i].s < threshold) continue
    const startT = env[i].t
    let j = i
    while (j < env.length && env[j].s >= threshold) j++
    const endT = env[j - 1].t
    if (endT - startT >= SUSTAIN) return startT
  }
  // Fallback: the single loudest moment.
  return env.reduce((best, e) => (e.s > best.s ? e : best), env[0]).t
}

async function analyze(track: MusicTrack): Promise<{ durationSeconds: number | null; startOffset: number } | null> {
  const abs = path.join(musicLibraryDir(), track.file)
  if (!fs.existsSync(abs)) { console.warn(`  missing: ${track.file}`); return null }

  const dur = await getDuration(abs)
  const maxOffset = Math.max(0, dur - MIN_RUNWAY)

  const hint = dropHint(track.title)
  let offset: number
  if (hint != null) {
    offset = hint
  } else {
    const env = await loudnessEnvelope(abs)
    offset = chorusOnset(env) - LEAD
  }

  return { durationSeconds: dur || null, startOffset: Math.round(clamp(offset, 0, maxOffset)) }
}

async function main() {
  const force = process.argv.includes('--force')
  const tracks = [...MUSIC_CATALOG]
  const todo = tracks.filter(t => force || t.startOffset === undefined)
  console.log(`Analyzing ${todo.length} / ${tracks.length} tracks${force ? ' (force)' : ''}...\n`)

  let done = 0
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const track = todo[i++]
      try {
        const res = await analyze(track)
        if (res) {
          track.startOffset = res.startOffset
          track.durationSeconds = res.durationSeconds
          console.log(`  ✓ ${track.title} — start @ ${res.startOffset}s${dropHint(track.title) != null ? ' (filename)' : ''}`)
        }
      } catch (e) {
        console.warn(`  skip "${track.title}": ${(e as Error).message}`)
      }
      done++
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))

  fs.writeFileSync(CATALOG_PATH, serializeCatalog(tracks))
  const withOffset = tracks.filter(t => t.startOffset !== undefined && t.startOffset > 0).length
  console.log(`\nDone. Analyzed ${done}, ${withOffset} tracks now start at a detected best-part offset.`)
}

main().catch((e) => { console.error('[analyze] failed:', e); process.exit(1) })
