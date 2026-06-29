// ── Standalone music mix test ─────────────────────────────────────────────────
// Adds library background music to ANY local video file, without the Submagic /
// Descript / Remotion pipeline. Runs the real selector + the exact mix chain
// from motion-renderer.ts's mixBackgroundMusic (EQ carve + voice ducking), and
// writes a NEW file alongside the input — your original is never touched.
//
// Run it:
//   npm run music:test-mix -- /path/to/your-video.mp4
//   npm run music:test-mix -- ./clip.mp4 --mood=calm --niche=medical --pace=calm
//
// Flags (all optional): --mood, --niche, --pace (calm|natural|fast), --hook="..."

import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { selectTrack } from './select'
import { resolveTrackFile } from './resolve'
import type { MusicSelectionContext } from './types'

const execAsync = promisify(exec)

// Use the bundled static binaries so this works regardless of shell PATH.
const FFMPEG = (ffmpegStatic as unknown as string) || 'ffmpeg'
const FFPROBE = (ffprobeStatic as { path: string }).path || 'ffprobe'

function arg(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : undefined
}

async function videoDuration(file: string): Promise<number> {
  const { stdout } = await execAsync(
    `"${FFPROBE}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
  )
  const d = parseFloat(stdout.trim())
  return d > 0 ? d : 0
}

async function main() {
  const input = process.argv[2]
  if (!input || input.startsWith('--')) {
    console.error('Usage: npm run music:test-mix -- <video-file> [--mood=] [--format=] [--hook=]')
    process.exit(1)
  }
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`)
    process.exit(1)
  }

  const ctx: MusicSelectionContext = {
    hook: arg('hook') ?? 'A short-form talking head video',
    moodTag: arg('mood') ?? null,
    scriptFormat: arg('format'),
  }

  console.log('Selecting a track...')
  const track = await selectTrack(ctx)
  if (!track) {
    console.error('No track selected — library is empty (run `npm run music:ingest`).')
    process.exit(1)
  }
  const startOffset = Math.max(0, track.startOffset ?? 0)
  const ssArg = startOffset > 0 ? `-ss ${startOffset} ` : ''
  console.log(`→ "${track.title}"  [${track.categories.join('/')}]${startOffset ? ` @ ${startOffset}s (best part)` : ''}`)

  const musicPath = await resolveTrackFile(track)
  if (!musicPath) {
    console.error('Could not resolve the track audio file.')
    process.exit(1)
  }

  const duration = await videoDuration(input)
  const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2)
  const dir = path.dirname(input)
  const base = path.basename(input, path.extname(input))
  const out = path.join(dir, `${base}_music.mp4`)

  // NOTE: this filter chain mirrors mixBackgroundMusic in lib/motion-renderer.ts —
  // keep them in sync. Music: loop → fade in/out → EQ-carve vocal band → level
  // (~18dB under voice) → sidechain-duck under the voice → mix → master to
  // -14 LUFS / -1.5 dBTP (short-form loudness target).
  const cmd =
    `"${FFMPEG}" -y -i "${input}" -stream_loop -1 ${ssArg}-i "${musicPath}" ` +
    `-filter_complex ` +
    `"[1:a]asetpts=N/SR/TB,afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=1.5,` +
    `equalizer=f=2500:width_type=q:w=1.4:g=-5,volume=0.12[bgfade];` +
    `[bgfade][0:a]sidechaincompress=threshold=0.018:ratio=10:attack=5:release=450[ducked];` +
    `[0:a][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-13:TP=-1.5:LRA=11[out]" ` +
    `-map 0:v -map "[out]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${out}"`

  console.log('\nMixing music in (this is the exact production chain)...')
  await execAsync(cmd, { maxBuffer: 512 * 1024 * 1024 })
  console.log(`\n✓ Done. Listen here:\n  ${out}\n`)
}

main().catch((e) => {
  console.error('[test-mix] failed:', e?.message ?? e)
  process.exit(1)
})
