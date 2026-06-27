/**
 * End-to-end pipeline test.
 * Run from vid-app directory:
 *   npx tsx scripts/test-pipeline.mts
 *
 * Tests each stage independently so you can see exactly where something fails.
 * Uses a public 15-second Pexels video as the source so no Google Drive needed.
 */

import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

// Load .env.local manually (dotenv not installed as dep)
const envFile = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

// ── Config ────────────────────────────────────────────────────────────────────
const OUT_DIR = path.resolve(process.cwd(), 'public', 'renders', 'test-pipeline')

// ── Helpers ───────────────────────────────────────────────────────────────────
function ok(msg: string) { console.log(`  ✓ ${msg}`) }
function fail(msg: string, e?: unknown) {
  console.error(`  ✗ ${msg}`, e instanceof Error ? e.message : e)
}
function section(title: string) { console.log(`\n[ ${title} ]`) }

async function downloadUrl(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const file = fs.createWriteStream(dest)
  const reader = res.body.getReader()
  await new Promise<void>((resolve, reject) => {
    file.on('error', reject)
    file.on('finish', resolve)
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { file.end(); break }
          if (!file.write(Buffer.from(value))) await new Promise<void>(r => file.once('drain', r))
        }
      } catch (e) { file.destroy(e as Error) }
    }
    pump()
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true })
console.log(`Output dir: ${OUT_DIR}`)

// ── 1. FFmpeg ─────────────────────────────────────────────────────────────────
section('1. FFmpeg availability')
try {
  const ver = execSync('ffmpeg -version 2>&1 | head -1', { encoding: 'utf8' }).trim()
  ok(ver)
} catch (e) { fail('ffmpeg not found in PATH', e); process.exit(1) }

// ── 2. Generate test video with FFmpeg ────────────────────────────────────────
// Creates a 10-second silent black portrait video locally — no internet needed.
section('2. Generate test video')
const inputPath = path.join(OUT_DIR, 'source.mp4')
try {
  // Use a sine wave (real audio, not silence) so ElevenLabs can parse the file
  execSync(
    `ffmpeg -y -f lavfi -i "color=black:size=1080x1920:duration=10:rate=30" ` +
    `-f lavfi -i "sine=frequency=440:duration=10:sample_rate=44100" ` +
    `-t 10 -c:v libx264 -preset fast -crf 22 -c:a aac -pix_fmt yuv420p "${inputPath}" 2>/dev/null`,
    { stdio: 'pipe' }
  )
  const stat = fs.statSync(inputPath)
  ok(`source.mp4 — ${(stat.size / 1024).toFixed(0)} KB (10s, 1080x1920, silent)`)
  console.log('  Note: transcription will return 0 words (no speech in test video)')
  console.log('  For a real transcription test, use the app with a recording from Jessica')
} catch (e) { fail('test video generation failed', e); process.exit(1) }

// ── 3. ElevenLabs Music ───────────────────────────────────────────────────────
section('3. ElevenLabs Music API')
const musicPath = path.join(OUT_DIR, 'background_music.mp3')
if (!process.env.ELEVENLABS_API_KEY) {
  fail('ELEVENLABS_API_KEY not set — skipping')
} else {
  try {
    process.stdout.write('  Generating music (may take 15-30s)...')
    const res = await fetch('https://api.elevenlabs.io/v1/music', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'upbeat motivational background music for social media video, instrumental',
        model_id: 'music_v2',
        music_length_ms: 15000,
        force_instrumental: true,
      }),
    })
    if (res.ok) {
      fs.writeFileSync(musicPath, Buffer.from(await res.arrayBuffer()))
      const stat = fs.statSync(musicPath)
      console.log(' done')
      ok(`background_music.mp3 — ${(stat.size / 1024).toFixed(0)} KB`)
    } else {
      const body = await res.text()
      console.log()
      fail(`ElevenLabs Music API returned ${res.status}: ${body.slice(0, 200)}`)
    }
  } catch (e) { console.log(); fail('ElevenLabs Music exception', e) }
}

// ── 4. ElevenLabs Transcription ───────────────────────────────────────────────
section('4. ElevenLabs Transcription (local file upload)')
interface WordTiming { text: string; start: number; end: number }
let words: WordTiming[] = []

if (!process.env.ELEVENLABS_API_KEY) {
  fail('ELEVENLABS_API_KEY not set — skipping')
} else {
  try {
    process.stdout.write('  Transcribing...')
    const fileBuffer = fs.readFileSync(inputPath)
    const blob = new Blob([fileBuffer], { type: 'video/mp4' })
    const form = new globalThis.FormData()
    form.append('model_id', 'scribe_v1')
    form.append('file', blob, 'source.mp4')
    form.append('language_code', 'en')
    form.append('timestamps_granularity', 'word')

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
      body: form,
    })
    if (res.ok) {
      const data = await res.json()
      words = data.words ?? []
      console.log(' done')
      ok(`${words.length} words — "${(data.text as string ?? '').slice(0, 60)}..."`)
    } else {
      const body = await res.text()
      console.log()
      fail(`Transcription API ${res.status}: ${body.slice(0, 200)}`)
    }
  } catch (e) { console.log(); fail('Transcription exception', e) }
}

// ── 5. Pexels B-roll search ───────────────────────────────────────────────────
section('5. Pexels B-roll search')
let brollUrls: string[] = []

if (!process.env.PEXELS_API_KEY) {
  fail('PEXELS_API_KEY not set — skipping')
} else {
  try {
    const res = await fetch(
      'https://api.pexels.com/videos/search?query=motivation+success&per_page=3&orientation=portrait&size=medium',
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    )
    if (res.ok) {
      const data = await res.json() as { videos?: { video_files: { quality: string; width: number; height: number; link: string }[] }[] }
      brollUrls = (data.videos ?? []).flatMap(v => {
        const files = v.video_files ?? []
        const f = files.find(f => f.quality === 'hd' && f.height >= f.width)
          ?? files.find(f => f.height >= f.width)
          ?? files[0]
        return f?.link ? [f.link] : []
      })
      ok(`Found ${brollUrls.length} portrait clips`)
      brollUrls.forEach((u, i) => console.log(`     [${i}] ${u.slice(0, 80)}...`))
    } else {
      fail(`Pexels API ${res.status}: ${await res.text()}`)
    }
  } catch (e) { fail('Pexels exception', e) }
}

// ── 6. FFmpeg silence cut ─────────────────────────────────────────────────────
section('6. FFmpeg silence cut')
const cutPath = path.join(OUT_DIR, 'cut.mp4')
if (words.length < 5) {
  console.log('  Skipped (need transcription words — test video may have no speech)')
  fs.copyFileSync(inputPath, cutPath)
} else {
  try {
    const PRE_PAD = 0.15, POST_PAD = 0.25, MIN_GAP = 0.35
    const segments: [number, number][] = []
    let segStart = Math.max(0, words[0].start - PRE_PAD)
    let segEnd = words[0].end + POST_PAD
    for (let i = 1; i < words.length; i++) {
      if (words[i].start - words[i - 1].end > MIN_GAP) {
        segments.push([segStart, segEnd])
        segStart = Math.max(0, words[i].start - PRE_PAD)
      }
      segEnd = words[i].end + POST_PAD
    }
    segments.push([segStart, segEnd])

    const concatFile = path.join(OUT_DIR, 'silence_cut.txt')
    const escaped = inputPath.replace(/'/g, "\\'")
    fs.writeFileSync(concatFile,
      segments.map(([s, e]) => `file '${escaped}'\ninpoint ${s.toFixed(3)}\noutpoint ${e.toFixed(3)}`).join('\n')
    )
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:v libx264 -preset fast -crf 22 -c:a aac -pix_fmt yuv420p "${cutPath}" 2>/dev/null`,
      { stdio: 'pipe' }
    )
    ok(`cut.mp4 — ${segments.length} segments kept`)
  } catch (e) {
    fail('silence cut failed', e)
    fs.copyFileSync(inputPath, cutPath)
  }
}

// ── 7. FFmpeg 9:16 format ─────────────────────────────────────────────────────
section('7. FFmpeg 9:16 format')
const formattedPath = path.join(OUT_DIR, 'formatted.mp4')
try {
  execSync(
    `ffmpeg -y -i "${cutPath}" ` +
    `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black" ` +
    `-c:v libx264 -preset fast -crf 22 -c:a aac -pix_fmt yuv420p "${formattedPath}" 2>/dev/null`,
    { stdio: 'pipe' }
  )
  ok('formatted.mp4 — 1080x1920 portrait')
} catch (e) { fail('format step failed', e) }

// ── 8. B-roll download + overlay ─────────────────────────────────────────────
section('8. B-roll overlay inject')
const brollPath = path.join(OUT_DIR, 'with_broll.mp4')
if (!brollUrls.length) {
  console.log('  Skipped (no B-roll URLs)')
  fs.existsSync(formattedPath) && fs.copyFileSync(formattedPath, brollPath)
} else {
  try {
    process.stdout.write('  Downloading + normalizing B-roll clips...')
    const normPaths: string[] = []
    for (let i = 0; i < brollUrls.length; i++) {
      const rawPath = path.join(OUT_DIR, `broll_raw_${i}.mp4`)
      const normPath = path.join(OUT_DIR, `broll_norm_${i}.mp4`)
      try {
        await downloadUrl(brollUrls[i], rawPath)
        execSync(
          `ffmpeg -y -i "${rawPath}" -t 3 ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts=PTS-STARTPTS" ` +
          `-r 30 -c:v libx264 -preset fast -crf 22 -an "${normPath}" 2>/dev/null`,
          { stdio: 'pipe' }
        )
        normPaths.push(normPath)
      } catch { /* skip */ }
    }
    console.log(` got ${normPaths.length} clips`)

    if (!normPaths.length) {
      fs.copyFileSync(formattedPath, brollPath)
    } else {
      const durOutput = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${formattedPath}"`,
        { encoding: 'utf8', stdio: 'pipe' }
      ).trim()
      const totalDuration = parseFloat(durOutput) || 60
      const BROLL_DURATION = 3
      const safeEnd = Math.max(8, totalDuration - 5)
      const usableRange = safeEnd - 5 - BROLL_DURATION
      const injectionPoints = normPaths.map((_, i) =>
        Math.floor(5 + usableRange * (i + 1) / (normPaths.length + 1))
      )

      const inputArgs = [`-i "${formattedPath}"`, ...normPaths.map(p => `-i "${p}"`)].join(' ')
      let currentStream = '0:v'
      const filterParts = normPaths.map((_, i) => {
        const t0 = injectionPoints[i], t1 = t0 + BROLL_DURATION
        const outStream = `v${i}`
        const f = `[${currentStream}][${i + 1}:v]overlay=enable='between(t,${t0},${t1})'[${outStream}]`
        currentStream = outStream
        return f
      })
      execSync(
        `ffmpeg -y ${inputArgs} ` +
        `-filter_complex "${filterParts.join('; ')}" ` +
        `-map "[${currentStream}]" -map "0:a" ` +
        `-c:v libx264 -preset fast -crf 22 -c:a aac -pix_fmt yuv420p "${brollPath}" 2>/dev/null`,
        { stdio: 'pipe' }
      )
      ok(`with_broll.mp4 — injected at t=${injectionPoints.join('s, ')}s`)
    }
  } catch (e) { fail('B-roll overlay failed', e) }
}

// ── 9. Music mix ──────────────────────────────────────────────────────────────
section('9. Music mix (15% volume)')
const mixedPath = path.join(OUT_DIR, 'mixed.mp4')
const sourceForMix = fs.existsSync(brollPath) ? brollPath : formattedPath
if (!fs.existsSync(musicPath)) {
  console.log('  Skipped (no music file)')
  fs.existsSync(sourceForMix) && fs.copyFileSync(sourceForMix, mixedPath)
} else {
  try {
    execSync(
      `ffmpeg -y -i "${sourceForMix}" -i "${musicPath}" ` +
      `-filter_complex "[1:a]volume=0.15,aloop=loop=-1:size=2e+09[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]" ` +
      `-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${mixedPath}" 2>/dev/null`,
      { stdio: 'pipe' }
    )
    ok('mixed.mp4 — voice + music')
  } catch (e) { fail('music mix failed', e) }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n── Result files ─────────────────────────────────────────────────────')
const files = ['source.mp4', 'cut.mp4', 'formatted.mp4', 'with_broll.mp4',
                'background_music.mp3', 'mixed.mp4']
for (const f of files) {
  const p = path.join(OUT_DIR, f)
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p)
    console.log(`  ${f.padEnd(24)} ${(stat.size / 1024 / 1024).toFixed(2)} MB`)
  }
}
console.log(`\nAll files at: ${OUT_DIR}`)
console.log('Open any .mp4 in QuickTime to preview.\n')
