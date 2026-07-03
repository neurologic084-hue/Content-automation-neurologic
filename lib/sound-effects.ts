import fs from 'fs'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'

// ── Native sound effects ──────────────────────────────────────────────────────
// A generic transition whoosh is the same regardless of video content, unlike
// mood-matched music — generate it once via ElevenLabs Sound Generation (the
// right tool for short discrete SFX, unlike full song composition) and cache
// to disk so every render after the first reuses the same file.

const CACHE_DIR = path.join(os.tmpdir(), 'olympus-sfx-cache')

interface SfxDef {
  name: string
  prompt: string
  durationSeconds: number
}

// Small fixed category library — the AI picks WHICH category fits a given
// sentence's content, never invents new bespoke audio per sentence. Each
// category is generated once and reused across every video forever after.
export type SfxCategory =
  | 'whoosh' | 'impact' | 'ding' | 'riser' | 'shutter'
  | 'whoosh-snap' | 'flash-pop' | 'shutter-soft' | 'pop'
  | 'whoosh-airy' | 'whoosh-deep' | 'boom-soft' | 'click-digital'

const SFX_DEFS: Record<SfxCategory, SfxDef> = {
  whoosh: {
    name: 'whoosh-transition',
    prompt: 'short subtle whoosh transition sound effect, quick clean air swipe, modern and minimal, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  // B-roll photo cards: the modern "photo pops on screen" grammar — a single
  // crisp mechanical shutter snap, professional and tight.
  shutter: {
    name: 'camera-shutter',
    prompt: 'single professional DSLR camera shutter click sound effect, crisp tight mechanical snap, fast attack, clean and modern, no beep, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  impact: {
    name: 'impact-hit',
    prompt: 'short punchy impact hit sound effect, deep thud with a tight transient, serious and weighty, no music, no voice',
    durationSeconds: 1,
  },
  ding: {
    name: 'positive-ding',
    prompt: 'short bright positive ding or chime sound effect, clean single tone, upbeat and satisfying, no music, no voice',
    durationSeconds: 1,
  },
  riser: {
    name: 'tension-riser',
    prompt: 'short rising tension riser sound effect, builds anticipation, subtle and modern, no music, no voice, no cymbal crash at the end',
    durationSeconds: 2,
  },
  // Variation kit — multi-version renders pair each transition style with its
  // own join sound and each run with its own B-roll entrance sound.
  'whoosh-snap': {
    name: 'whoosh-snap',
    prompt: 'very fast tight whip swish transition sound effect, snappy with a crisp transient at the end, modern short-form editing style, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'flash-pop': {
    name: 'flash-pop',
    prompt: 'bright quick camera flash pop sound effect, soft airy burst with a subtle sparkle transient, clean and modern, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'shutter-soft': {
    name: 'shutter-soft',
    prompt: 'soft mirrorless camera shutter sound effect, gentle quick double click, quiet and refined, no beep, no music, no voice, no reverb',
    durationSeconds: 1,
  },
  pop: {
    name: 'ui-pop',
    prompt: 'minimal soft pop click sound effect, like a clean modern UI element appearing, subtle and satisfying, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'whoosh-airy': {
    name: 'whoosh-airy',
    prompt: 'soft airy swish transition sound effect, gentle breathy air movement, light and elegant, modern short-form editing, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'whoosh-deep': {
    name: 'whoosh-deep',
    prompt: 'deep cinematic swoosh transition sound effect, low sub-heavy air movement with a smooth body, powerful but short, no music, no voice, no long tail',
    durationSeconds: 1,
  },
  'boom-soft': {
    name: 'boom-soft',
    prompt: 'soft cinematic boom hit sound effect, muffled low thump with a quick decay, subtle and modern, no music, no voice, no long rumble tail',
    durationSeconds: 1,
  },
  // Textured layer (stage two of the sound-design system): a tiny UI tap that
  // rides on accent-word pops and blends the riser's landing on the poster
  // card. Directs attention without ever reading as a "sound effect".
  'click-digital': {
    name: 'click-digital',
    prompt: 'single soft digital user interface click sound effect, tiny rounded tap like a modern app button press, very short and subtle, clean, no beep, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
}

// Bumping this regenerates the library with peak normalization applied — old
// unnormalized files simply go stale in the tmp cache.
const SFX_CACHE_VERSION = 2

function execP(cmd: string, opts: { maxBuffer?: number; encoding?: 'buffer' } = {}): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60_000, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024, encoding: opts.encoding ?? 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

// Peak-normalize a freshly generated SFX to -3 dBFS so the planner's volume
// multipliers mean the same thing for every category — ElevenLabs output
// loudness varies a lot between generations. Best-effort: on any failure the
// raw file is kept.
async function normalizeSfx(filePath: string): Promise<void> {
  try {
    const probe = await execP(`ffmpeg -i "${filePath}" -af volumedetect -f null - 2>&1`) as string
    const match = probe.match(/max_volume:\s*(-?[\d.]+)\s*dB/)
    if (!match) return
    const gain = -3 - parseFloat(match[1])
    if (Math.abs(gain) < 0.5) return
    const tmp = `${filePath}.norm.mp3`
    await execP(`ffmpeg -y -i "${filePath}" -af "volume=${gain.toFixed(2)}dB" -c:a libmp3lame -q:a 4 "${tmp}"`)
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) fs.renameSync(tmp, filePath)
  } catch { /* keep the raw file */ }
}

async function generateSfx(def: SfxDef): Promise<string> {
  const cachePath = path.join(CACHE_DIR, `${def.name}.v${SFX_CACHE_VERSION}.mp3`)
  if (fs.existsSync(cachePath)) return cachePath

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY not set — cannot generate sound effects')

  console.log(`[sound-effects] generating "${def.name}"...`)
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: def.prompt, duration_seconds: def.durationSeconds, prompt_influence: 0.6 }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs SFX generation failed (${res.status}): ${err.slice(0, 200)}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cachePath, buf)
  await normalizeSfx(cachePath)
  console.log(`[sound-effects] cached "${def.name}" -> ${cachePath}`)
  return cachePath
}

// ── Timing probe (peak alignment) ─────────────────────────────────────────────
// The core trick of premium sound design: the LOUDEST INSTANT of a sound must
// land on the animation's point of maximum motion — not the file's first
// sample. This measures where that instant sits inside a file so the planner
// can back-time each cue (start = peakTarget - peakSec). Risers get this for
// free: their peak is near the end, so aligning it drops the build-up
// naturally BEFORE the moment.

export interface SfxTiming {
  durationSec: number
  peakSec: number   // offset of the loudest sample from the start of the file
}

const timingCache = new Map<string, Promise<SfxTiming>>()

export function probeSfxTiming(filePath: string): Promise<SfxTiming> {
  let cached = timingCache.get(filePath)
  if (!cached) {
    cached = (async (): Promise<SfxTiming> => {
      const RATE = 8000
      const pcm = await execP(
        `ffmpeg -v error -i "${filePath}" -f s16le -ac 1 -ar ${RATE} -`,
        { encoding: 'buffer' },
      ) as Buffer
      const samples = Math.floor(pcm.length / 2)
      let maxAbs = 0
      let maxAt = 0
      for (let i = 0; i < samples; i++) {
        const v = Math.abs(pcm.readInt16LE(i * 2))
        if (v > maxAbs) { maxAbs = v; maxAt = i }
      }
      return { durationSec: samples / RATE, peakSec: maxAt / RATE }
    })().catch((e) => {
      timingCache.delete(filePath)
      throw e
    })
    timingCache.set(filePath, cached)
  }
  return cached
}

const sfxAttempts = new Map<SfxCategory, Promise<string | null>>()

// Returns a local file path, or null if generation isn't possible (missing
// key, API error) — callers should fall back to a silent (visual-only)
// moment rather than failing the whole render.
export async function getSfx(category: SfxCategory): Promise<string | null> {
  let attempt = sfxAttempts.get(category)
  if (!attempt) {
    attempt = generateSfx(SFX_DEFS[category]).catch((e) => {
      console.warn(`[sound-effects] "${category}" generation failed, that moment will be silent:`, (e as Error).message)
      sfxAttempts.delete(category) // allow retry on a future render
      return null
    })
    sfxAttempts.set(category, attempt)
  }
  return attempt
}

// Back-compat convenience for the existing transition call site.
export async function getWhooshSfx(): Promise<string | null> {
  return getSfx('whoosh')
}

export async function getShutterSfx(): Promise<string | null> {
  return getSfx('shutter')
}

// 'slide' is the viral-podcast push (v5's locked style): covers shove in from
// the right and shove back out. It stays out of TRANSITION_STYLES so the seeded
// rotation used by v4/v6 harness runs keeps its original three-style cycle.
export type TransitionStyle = 'blur' | 'flash' | 'punch' | 'slide'

export const TRANSITION_STYLES: TransitionStyle[] = ['blur', 'flash', 'punch']

export function transitionStyleFor(variation: number): TransitionStyle {
  return TRANSITION_STYLES[variation % TRANSITION_STYLES.length]
}
