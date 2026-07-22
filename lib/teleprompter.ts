// ── Script read-aloud (teleprompter audio) ───────────────────────────────────
// Turns an approved script into a spoken reference track so the creator can
// hear the pacing before filming — and read along to it on set.
//
// Deliberately GENERATED ON DEMAND, never automatically for every script.
// ElevenLabs bills per character (~1,400 for a typical script) and this
// account has run dry before, so a script that is never filmed should never
// cost anything. The result is cached in R2 keyed by the script's CONTENT, so
// pressing play twice is free but an edited script re-reads itself.

import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { uploadToStorage } from './storage'

// Two ElevenLabs stock voices. Ids are stable across accounts (they ship with
// every one), so this needs no per-account setup.
export const TELEPROMPTER_VOICES = {
  female: { id: '21m00Tcm4TlvDq8ikWAM', label: 'Female' },  // Rachel — warm, unhurried
  male:   { id: 'pNInz6obpgDQGcFmaJgB', label: 'Male' },    // Adam — even, neutral
} as const

export type TeleprompterVoice = keyof typeof TELEPROMPTER_VOICES

export function normalizeVoice(raw: unknown): TeleprompterVoice {
  return raw === 'male' ? 'male' : 'female'
}

/** One line of script text, in the order it should be spoken. */
export function scriptToSpeech(hook: string, body: string, cta: string): string {
  return [hook, body, cta]
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 5000) // a sane ceiling; a short-form script is ~1,400 characters
}

// Content-addressed: the same words in the same voice are the same audio, so a
// re-press costs nothing and an edit invalidates itself without any bookkeeping.
function cacheName(text: string, voice: TeleprompterVoice): string {
  const digest = crypto.createHash('sha256').update(`${voice}:${text}`).digest('hex').slice(0, 24)
  return `${digest}.mp3`
}

export class TeleprompterUnavailable extends Error {}

/**
 * Returns a public URL for the spoken script, generating it only on a cache
 * miss. Throws TeleprompterUnavailable with a human-readable reason when the
 * account cannot do this — the key is missing, lacks text-to-speech
 * permission, or is out of characters — so the caller can say which.
 */
export async function getScriptVoiceover(
  text: string,
  voice: TeleprompterVoice,
): Promise<string> {
  if (!text.trim()) throw new TeleprompterUnavailable('This script has no text to read yet.')

  const name = cacheName(text, voice)
  const base = process.env.R2_PUBLIC_URL
  if (base) {
    const cached = `${base}/teleprompter/${name}`
    const hit = await fetch(cached, { method: 'HEAD', signal: AbortSignal.timeout(8_000) })
      .then(r => r.ok).catch(() => false)
    if (hit) return cached
  }

  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new TeleprompterUnavailable('Voice reading is not set up yet (no ElevenLabs key).')

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${TELEPROMPTER_VOICES[voice].id}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        // Steady and clear rather than performed — this is a pacing reference
        // to read along with, not a voiceover meant to ship.
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 0.95 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  )

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300).toLowerCase()
    // The three failures worth naming apart, because the fix differs for each.
    if (res.status === 401 || detail.includes('missing_permission') || detail.includes('permission')) {
      throw new TeleprompterUnavailable(
        'The ElevenLabs key does not have permission to create speech. Enable "Text to Speech" for this key in the ElevenLabs dashboard.',
      )
    }
    if (detail.includes('quota') || res.status === 429) {
      throw new TeleprompterUnavailable('ElevenLabs is out of characters this month — top up to use the read-aloud.')
    }
    throw new TeleprompterUnavailable(`Could not create the voice reading (${res.status}). Please try again.`)
  }

  const audio = Buffer.from(await res.arrayBuffer())
  if (audio.length < 1024) throw new TeleprompterUnavailable('The voice reading came back empty. Please try again.')

  // uploadToStorage is file-based; stage to a private temp path so two
  // concurrent presses of different scripts cannot share a filename.
  const tmp = path.join(os.tmpdir(), `tp-${process.pid}-${name}`)
  fs.writeFileSync(tmp, audio)
  let url: string
  try {
    url = await uploadToStorage(tmp, name, 'teleprompter')
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
  }
  console.log(`[teleprompter] read ${text.length} chars in the ${voice} voice (${(audio.length / 1e6).toFixed(1)}MB)`)
  return url
}
