import fs from 'fs'
import path from 'path'
import os from 'os'

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
export type SfxCategory = 'whoosh' | 'impact' | 'ding' | 'riser'

const SFX_DEFS: Record<SfxCategory, SfxDef> = {
  whoosh: {
    name: 'whoosh-transition',
    prompt: 'short subtle whoosh transition sound effect, quick clean air swipe, modern and minimal, no music, no voice, no reverb tail',
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
}

async function generateSfx(def: SfxDef): Promise<string> {
  const cachePath = path.join(CACHE_DIR, `${def.name}.mp3`)
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
  console.log(`[sound-effects] cached "${def.name}" -> ${cachePath}`)
  return cachePath
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
