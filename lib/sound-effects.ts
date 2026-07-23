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

// Small fixed category library — the planners pick WHICH category fits a given
// moment, never invent bespoke audio per sentence. Each category is generated
// once and reused across every video forever after.
//
// Hand-auditioned down to eight categories. Cut after listening to every
// generated take: riser (by far the loudest thing in any render), shutter,
// shutter-soft, ding, shing, and the four that no planner ever requested
// (impact, boom-808, glitch, tape-stop).
export type SfxCategory =
  | 'whoosh' | 'whoosh-snap' | 'whoosh-airy' | 'whoosh-deep'
  | 'pop' | 'flash-pop' | 'boom-soft' | 'click-digital'

const SFX_DEFS: Record<SfxCategory, SfxDef> = {
  // Trending short-form grammar: the tight whip-whoosh every viral editor cuts
  // on — fast air rip with a crisp arrival transient, gone in half a second.
  whoosh: {
    name: 'whoosh-transition',
    prompt: 'fast tight whip whoosh transition sound effect, sharp air rip with a crisp snap at the end, viral short-form video editing style, punchy and modern, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'whoosh-snap': {
    name: 'whoosh-snap',
    prompt: 'very fast tight whip swish transition sound effect, snappy with a crisp transient at the end, modern short-form editing style, no music, no voice, no reverb tail',
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
  pop: {
    name: 'ui-pop',
    prompt: 'minimal soft pop click sound effect, like a clean modern UI element appearing, subtle and satisfying, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'flash-pop': {
    name: 'flash-pop',
    prompt: 'bright quick camera flash pop sound effect, soft airy burst with a subtle sparkle transient, clean and modern, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
  'boom-soft': {
    name: 'boom-soft',
    prompt: 'soft cinematic boom hit sound effect, muffled low thump with a quick decay, subtle and modern, no music, no voice, no long rumble tail',
    durationSeconds: 1,
  },
  // Textured layer: a tiny UI tap that rides accent-word pops and list-item
  // reveals. Directs attention without ever reading as a "sound effect".
  'click-digital': {
    name: 'click-digital',
    prompt: 'single soft digital user interface click sound effect, tiny rounded tap like a modern app button press, very short and subtle, clean, no beep, no music, no voice, no reverb tail',
    durationSeconds: 1,
  },
}

// Which generated takes of each category are allowed to play. ElevenLabs is
// nondeterministic, so takes of one prompt genuinely differ — these are the
// ones that survived a listen-through; the rest are never staged.
//
// Do NOT bump SFX_CACHE_VERSION to "refresh" the library: regeneration would
// produce different-sounding takes and silently invalidate every choice below.
export const ALLOWED_TAKES: Record<SfxCategory, number[]> = {
  whoosh: [2],
  'whoosh-snap': [0, 1],
  'whoosh-airy': [0],
  'whoosh-deep': [1, 2],
  pop: [0, 1, 2],
  'flash-pop': [0, 1, 2],
  'boom-soft': [0, 1],
  'click-digital': [1],
}

// Bumping this regenerates the library with peak normalization applied — old
// unnormalized files simply go stale in the tmp cache.
// v3: trending-sound prompt overhaul (whip whoosh, 808 boom, glitch, tape stop).
const SFX_CACHE_VERSION = 3

function execP(cmd: string, opts: { maxBuffer?: number; encoding?: 'buffer' } = {}): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60_000, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024, encoding: opts.encoding ?? 'utf8' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

// A cached SFX must be PLAYABLE audio, not merely bytes of plausible size. The
// old guards checked size only (> 500 bytes), so an interrupted upload or an
// error-page body cached as ui-pop.v3.t2.mp3 passed every check — and because
// R2 is the source of truth, the poisoned object re-infected the tmp cache of
// every container after every deploy, silencing that cue on every render,
// forever. A full decode is the test ffmpeg itself applies at staging time,
// and these files are ~1s long, so it costs nothing.
async function isPlayableAudio(filePath: string): Promise<boolean> {
  try {
    await execP(`ffmpeg -v error -i "${filePath}" -f null -`)
    return true
  } catch {
    return false
  }
}

// Peak-normalize a freshly generated SFX to -3 dBFS. This equalizes PEAKS, not
// perceived loudness: measured across the cached library, files sitting at an
// identical -3 dBFS peak spanned 25 dB of mean level. Perceived loudness is
// evened out at staging time instead (see LOUDNESS_TARGET_DB in sfx-stage.ts),
// which is what makes a cue's `volume` number comparable across categories.
// Best-effort: on any failure the raw file is kept.
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

// SYNTHESISED FALLBACK. Every category here is a noise transient — a swish, a
// tap, a thump — which is exactly the class of sound ffmpeg can build from
// scratch. So when ElevenLabs is unavailable (no key, quota gone, outage) the
// edit still gets its sound design instead of falling silent, which is what
// happened on 2026-07-20: 18 planned cues, 0 delivered, because the quota ran
// out mid-render. Not as characterful as a generated take, and deliberately
// so — it is the floor, not the goal.
function synthArgs(name: string): string {
  // Shaped noise for anything airy; a decaying tone for the low hits.
  if (name.startsWith('whoosh')) {
    const deep = name.includes('deep')
    const airy = name.includes('airy')
    const dur = deep ? 0.5 : airy ? 0.42 : 0.32
    const lo = deep ? 90 : airy ? 900 : 500
    const hi = deep ? 2200 : airy ? 7000 : 6500
    return `-f lavfi -i "anoisesrc=d=${dur}:c=pink:a=0.7:r=48000" ` +
      `-af "highpass=f=${lo},lowpass=f=${hi},afade=t=in:st=0:d=${(dur * 0.45).toFixed(2)}:curve=exp,` +
      `afade=t=out:st=${(dur * 0.45).toFixed(2)}:d=${(dur * 0.55).toFixed(2)}:curve=exp"`
  }
  if (name === 'boom-soft') {
    return `-f lavfi -i "sine=frequency=68:duration=0.45:r=48000" ` +
      `-af "afade=t=out:st=0.02:d=0.42:curve=exp,lowpass=f=200,volume=1.1"`
  }
  // ui-pop / flash-pop / click-digital: very short bright transients.
  const bright = name === 'flash-pop'
  const dur = name === 'click-digital' ? 0.05 : 0.09
  return `-f lavfi -i "anoisesrc=d=${dur}:c=white:a=0.6:r=48000" ` +
    `-af "highpass=f=${bright ? 2500 : 1400},lowpass=f=${bright ? 11000 : 7000},` +
    `afade=t=out:st=0.004:d=${(dur - 0.004).toFixed(3)}:curve=exp"`
}

async function synthesiseSfx(def: SfxDef, cachePath: string): Promise<string> {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  await execP(`ffmpeg -y -v error ${synthArgs(def.name)} -c:a libmp3lame -q:a 4 "${cachePath}"`)
  if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size < 500) {
    throw new Error('ffmpeg produced no usable audio')
  }
  await normalizeSfx(cachePath)
  console.log(`[sound-effects] synthesised "${def.name}" locally (no API needed)`)
  return cachePath
}

async function generateSfx(def: SfxDef, take = 0): Promise<string> {
  // take 0 keeps the original cache name so existing files stay warm; takes
  // 1+ are fresh generations of the same prompt — ElevenLabs is nondeterministic,
  // so each take is a genuinely different-sounding version of the category.
  const cachePath = path.join(CACHE_DIR, `${def.name}.v${SFX_CACHE_VERSION}${take > 0 ? `.t${take}` : ''}.mp3`)
  if (fs.existsSync(cachePath)) return cachePath

  // R2 FIRST. These 8 sounds are generic and identical for every video ever
  // rendered, but the cache above lives in os.tmpdir() — wiped on every deploy
  // and every container restart. So a hosted app regenerated the whole library
  // constantly and burned a paid quota on files it already owned. R2 makes a
  // sound generated once last forever, for every future render on any machine.
  const remoteName = `${def.name}.v${SFX_CACHE_VERSION}${take > 0 ? `.t${take}` : ''}.mp3`
  if (process.env.R2_PUBLIC_URL) {
    try {
      const res = await fetch(`${process.env.R2_PUBLIC_URL}/sfx/${remoteName}`, { signal: AbortSignal.timeout(20_000) })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        if (buf.length > 500) {
          fs.mkdirSync(CACHE_DIR, { recursive: true })
          fs.writeFileSync(cachePath, buf)
          // A shared-library object can itself be corrupt (interrupted upload,
          // error body stored as .mp3 — observed on ui-pop.v3.t2). Accepting it
          // here is what made the corruption permanent: regenerating below also
          // REPUBLISHES, replacing the poisoned object for every future
          // container.
          if (await isPlayableAudio(cachePath)) {
            console.log(`[sound-effects] "${def.name}" reused from the shared library (no generation)`)
            return cachePath
          }
          console.warn(`[sound-effects] shared library copy of "${remoteName}" is not playable audio — regenerating and replacing it`)
          try { fs.unlinkSync(cachePath) } catch { /* best-effort */ }
        }
      }
    } catch { /* not cached yet — generate below */ }
  }

  const publish = async () => {
    try {
      const { uploadToStorage } = await import('./storage')
      await uploadToStorage(cachePath, remoteName, 'sfx')
    } catch (e) {
      console.warn(`[sound-effects] could not publish "${def.name}" to the shared library:`, (e as Error).message)
    }
  }

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    const out = await synthesiseSfx(def, cachePath)
    await publish()
    return out
  }

  console.log(`[sound-effects] generating "${def.name}" (take ${take})...`)
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: def.prompt, duration_seconds: def.durationSeconds, prompt_influence: 0.6 }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    // Out of quota, bad key, service down — all the same decision here: the
    // video still deserves sound. Synthesise instead of returning null, which
    // is what left an entire render silent.
    const err = await res.text()
    console.warn(`[sound-effects] ElevenLabs unavailable (${res.status}) — synthesising "${def.name}" locally: ${err.slice(0, 120)}`)
    const out = await synthesiseSfx(def, cachePath)
    await publish()
    return out
  }

  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cachePath, buf)
  // A 200 whose body is not decodable audio must never enter the cache — and
  // absolutely never be published, or every future container inherits it.
  if (!(await isPlayableAudio(cachePath))) {
    console.warn(`[sound-effects] ElevenLabs returned unplayable bytes for "${def.name}" — synthesising locally instead`)
    try { fs.unlinkSync(cachePath) } catch { /* best-effort */ }
    const out = await synthesiseSfx(def, cachePath)
    await publish()
    return out
  }
  await normalizeSfx(cachePath)
  await publish()
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
  rmsDb: number     // RMS level in dBFS — how loud the file actually SOUNDS.
                    // Matches `ffmpeg -af volumedetect`'s mean_volume. Do not
                    // "simplify" this to a mean of |sample|, and do not
                    // downsample before measuring: whooshes carry real energy
                    // above 11 kHz, and an 8 or 22 kHz decode reads them up to
                    // 7 dB quiet — which silently mis-scales every loudness trim.
}

const timingCache = new Map<string, Promise<SfxTiming>>()

export function probeSfxTiming(filePath: string): Promise<SfxTiming> {
  let cached = timingCache.get(filePath)
  if (!cached) {
    cached = (async (): Promise<SfxTiming> => {
      // Full-band, and BOTH channels kept. Every generated SFX is stereo, and
      // some (whoosh-snap) have near-out-of-phase channels: a `-ac 1` downmix
      // cancels them and reads ~7 dB quiet. Measure each channel's samples, the
      // way ffmpeg's volumedetect does. A 1s file is ~96k samples — free.
      const RATE = 48000
      const pcm = await execP(
        `ffmpeg -v error -i "${filePath}" -f s16le -ac 2 -ar ${RATE} -`,
        { encoding: 'buffer' },
      ) as Buffer
      const frames = Math.floor(pcm.length / 4)   // 2ch × int16
      let maxAbs = 0
      let maxAt = 0
      let sumSquares = 0
      for (let i = 0; i < frames; i++) {
        const l = pcm.readInt16LE(i * 4)
        const r = pcm.readInt16LE(i * 4 + 2)
        sumSquares += l * l + r * r
        const a = Math.max(Math.abs(l), Math.abs(r))
        if (a > maxAbs) { maxAbs = a; maxAt = i }
      }
      const rms = frames > 0 ? Math.sqrt(sumSquares / (frames * 2)) : 0
      const rmsDb = rms > 0 ? 20 * Math.log10(rms / 32768) : -90
      return { durationSec: frames / RATE, peakSec: maxAt / RATE, rmsDb }
    })().catch((e) => {
      timingCache.delete(filePath)
      throw e
    })
    timingCache.set(filePath, cached)
  }
  return cached
}

const sfxAttempts = new Map<string, Promise<string | null>>()

// Returns a local file path, or null if generation isn't possible (missing
// key, API error) — callers should fall back to a silent (visual-only)
// moment rather than failing the whole render. `take` selects one of several
// generated versions of the category (variety rule: no single file should
// play more than twice in one video — the staging allocator enforces it).
export async function getSfx(category: SfxCategory, take = 0): Promise<string | null> {
  const key = `${category}:${take}`
  let attempt = sfxAttempts.get(key)
  if (!attempt) {
    attempt = generateSfx(SFX_DEFS[category], take).catch((e) => {
      console.warn(`[sound-effects] "${category}" (take ${take}) generation failed, that moment will be silent:`, (e as Error).message)
      sfxAttempts.delete(key) // allow retry on a future render
      return null
    })
    sfxAttempts.set(key, attempt)
  }
  return attempt
}

// 'slide' is the viral-podcast push (v5's locked style): covers shove in from
// the right and shove back out. 'zoom' (zoom-through with motion blur) and
// 'whip' (whip-pan) are per-cover styles for the eubank combo rotation. All
// three stay out of TRANSITION_STYLES so the seeded rotation used by harness
// runs keeps its original three-style cycle.
export type TransitionStyle = 'blur' | 'flash' | 'punch' | 'slide' | 'zoom' | 'whip'

export const TRANSITION_STYLES: TransitionStyle[] = ['blur', 'flash', 'punch']

export function transitionStyleFor(variation: number): TransitionStyle {
  return TRANSITION_STYLES[variation % TRANSITION_STYLES.length]
}
