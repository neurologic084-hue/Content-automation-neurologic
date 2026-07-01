// ── Track descriptions (sound-based) ──────────────────────────────────────────
// For each track, LISTEN to the actual audio and store what it sounds like
// (genre, instrumentation, tempo, energy, mood, "good for" / "avoid when"). This
// is grounded in the real file, NOT the filename and NOT web research — the
// library is royalty-free tracks with generic names ("aglow", "after dark"), so
// the only reliable source of truth is the audio itself.
//
// How: cut a short snippet around the detected best part (startOffset, from
// analyze-sections.ts) with ffmpeg, send it inline to an audio-capable Gemini
// model via OpenRouter, and ask for a structured profile. Describing the
// best-part section means the description reflects the part that plays under the
// video.
//
// Run it:
//   npm run music:describe            (skips tracks already described)
//   npm run music:describe -- --force (re-describe everything)
//
// Requires OPENROUTER_API_KEY. Model overridable via MUSIC_DESCRIBE_MODEL.
// Reads audio locally, or downloads from Supabase via the resolver. Safe to
// re-run — writes catalog.ts in place.

import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { promisify } from 'util'
import ffmpegStatic from 'ffmpeg-static'
import { MUSIC_CATALOG } from './catalog'
import { serializeCatalog } from './catalog-format'
import { resolveTrackFile } from './resolve'
import { chatCompletion } from '../openrouter'
import type { MusicTrack, MusicProfile } from './types'

const execAsync = promisify(exec)
const FFMPEG = ffmpegStatic as unknown as string
const CATALOG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.ts')
const TMP_DIR = path.join(os.tmpdir(), 'olympus-music-describe')

const SNIPPET_SECONDS = 45   // enough to characterize the track
const MAX_RETRIES = 6        // retries on 429 / rate limits
const CONCURRENCY = Number(process.env.MUSIC_DESCRIBE_CONCURRENCY) || 20  // parallel requests through OpenRouter
// Audio-capable Gemini via OpenRouter (uses the OpenRouter credits/key we already
// have). Override with MUSIC_DESCRIBE_MODEL if needed.
const MODEL = process.env.MUSIC_DESCRIBE_MODEL || 'google/gemini-2.5-flash'

// Back off on 429s. OpenRouter may send a Retry-After hint; fall back to 20s.
function retryDelaySeconds(msg: string): number {
  const m = msg.match(/retry[- ]after[:"\s]+([\d.]+)/i) || msg.match(/retry in ([\d.]+)s/i)
  return m ? Math.ceil(parseFloat(m[1])) + 1 : 20
}
const sleep = (s: number) => new Promise(r => setTimeout(r, s * 1000))

const PROMPT = [
  'You are a music supervisor for short-form talking-head videos (Reels / Shorts / TikTok).',
  'Listen to this audio clip and describe what it actually SOUNDS like — ignore any title.',
  'It will be used as a quiet background bed under a person speaking, so judge how it would',
  'feel underneath a voice.',
  '',
  'Return a JSON object:',
  '- description: one plain line, "what it sounds like" (instruments + feel).',
  '- genre: short label (e.g. "lo-fi pop", "ambient", "orchestral", "trap").',
  '- instrumentation: the main sounds you hear.',
  '- tempoFeel: slow | medium | fast (how it feels, not strict BPM).',
  '- bpm: your best tempo estimate as a number (approximate is fine).',
  '- energy: 1 (ambient, barely-there) to 10 (driving, hype).',
  '- moodWords: 3-6 adjectives for the emotional tone.',
  '- goodFor: 2-4 kinds of video this bed fits (e.g. "reflective storytelling",',
  '  "upbeat product demo", "high-energy motivation").',
  '- avoidWhen: 1-3 kinds of video it would clash with.',
  '',
  'Return ONLY a JSON object with exactly these keys: description (string),',
  'genre (string), instrumentation (string[]), tempoFeel ("slow"|"medium"|"fast"),',
  'bpm (number), energy (integer 1-10), moodWords (string[]), goodFor (string[]),',
  'avoidWhen (string[]). No markdown, no extra text.',
].join('\n')

// Cut a mono snippet around the best part → base64 for inline upload.
async function snippet(absPath: string, startOffset: number): Promise<string> {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const out = path.join(TMP_DIR, `snip-${path.basename(absPath)}.mp3`)
  const ss = Math.max(0, startOffset)
  await execAsync(
    `"${FFMPEG}" -y -ss ${ss} -t ${SNIPPET_SECONDS} -i "${absPath}" ` +
    `-ac 1 -ar 22050 -c:a libmp3lame -b:a 96k "${out}"`,
    { maxBuffer: 64 * 1024 * 1024 },
  )
  const b64 = fs.readFileSync(out).toString('base64')
  fs.rmSync(out, { force: true })
  return b64
}

// Hard guarantee: only describe tracks that actually live in the Supabase bucket
// (the set served to videos). HEADs the public URL; skips anything not present.
function bucketUrl(file: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/music/${encoded}`
}

async function inSupabase(file: string): Promise<boolean> {
  const url = bucketUrl(file)
  if (!url) return true // no Supabase configured → don't block local-only runs
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) })
    return res.ok
  } catch { return false }
}

async function describe(track: MusicTrack): Promise<MusicProfile | null> {
  if (!(await inSupabase(track.file))) { console.warn(`  not in Supabase, skipping: ${track.file}`); return null }

  const abs = await resolveTrackFile(track)
  if (!abs) { console.warn(`  unavailable: ${track.file}`); return null }

  const data = await snippet(abs, track.startOffset ?? 0)
  const raw = await chatCompletion({
    model: MODEL,
    temperature: 0.3,
    max_tokens: 600,
    json: true,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'input_audio', input_audio: { data, format: 'mp3' } },
      ],
    }],
  })
  let profile: MusicProfile
  try { profile = JSON.parse(raw) as MusicProfile }
  catch (e) { throw new Error(`${(e as Error).message} — raw: ${JSON.stringify(raw.slice(0, 200))}`) }
  // Clamp energy into range in case the model drifts.
  profile.energy = Math.min(10, Math.max(1, Math.round(profile.energy)))
  return profile
}

async function main() {
  const force = process.argv.includes('--force')
  const limitArg = process.argv.find(a => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity
  const tracks = [...MUSIC_CATALOG]
  const todo = tracks.filter(t => force || t.profile === undefined).slice(0, limit)

  if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set.'); process.exit(1) }
  console.log(`Describing ${todo.length} / ${tracks.length} tracks${force ? ' (force)' : ''}${Number.isFinite(limit) ? ` (limit ${limit})` : ''} via ${MODEL} (x${CONCURRENCY})...\n`)

  let done = 0
  let i = 0
  const worker = async () => {
    while (i < todo.length) {
      const track = todo[i++]
      try {
        let profile: MusicProfile | null = null
        for (let attempt = 0; ; attempt++) {
          try { profile = await describe(track); break }
          catch (e) {
            const msg = (e as Error).message
            if (msg.includes('429') && attempt < MAX_RETRIES) {
              const wait = retryDelaySeconds(msg)
              console.log(`  ⏳ rate-limited, waiting ${wait}s then retrying "${track.title}"...`)
              await sleep(wait)
              continue
            }
            throw e
          }
        }
        if (profile) {
          track.profile = profile
          console.log(`  ✓ ${track.title} — ${profile.genre}, energy ${profile.energy} (${profile.moodWords.slice(0, 3).join(', ')})`)
        }
      } catch (e) {
        console.warn(`  skip "${track.title}": ${(e as Error).message}`)
      }
      done++
      // Persist incrementally so a crash / rate-limit mid-run keeps progress.
      fs.writeFileSync(CATALOG_PATH, serializeCatalog(tracks))
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const described = tracks.filter(t => t.profile !== undefined).length
  console.log(`\nDone. Processed ${done}, ${described}/${tracks.length} tracks now have a sound profile.`)
}

main().catch((e) => { console.error('[describe] failed:', e); process.exit(1) })
