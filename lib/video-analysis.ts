// ── Content profile — one Gemini pass per video, shared by every variant ──────
// Watches the actual footage (not just the written script) and returns a small
// structured read of it. Every field maps to a concrete downstream decision:
// Submagic settings (pace, B-roll %, zooms, caption lane) and, for v4/v5, the
// motion-graphics plan (stats, callouts, placement, density). See
// lib/VARIANTS-V2-PLAN.md for the full rationale.
//
// This is the "brain" the rest of the pipeline reads from. It runs ONCE and is
// cached on the job, so all six variants share the same understanding instead of
// each re-guessing from the transcript.

import fs from 'fs'
import path from 'path'
import { geminiJSON, type InlineMedia } from './gemini'

export interface ContentProfile {
  // How fast the person actually talks on camera.
  speechPace: 'slow' | 'measured' | 'fast'
  // Overall vocal + physical energy.
  energy: 'low' | 'medium' | 'high'
  // The guardrail field: gates how aggressive pace/effects are allowed to get,
  // regardless of what a variant's fixed personality wants.
  sensitivity: 'neutral' | 'personal' | 'medical_emotional'
  format: 'story' | 'educational' | 'list' | 'sales'
  // Is there anything on screen worth cutting to? Caps B-roll % so we never
  // force random stock footage onto a static talking head.
  brollableRichness: 'none' | 'some' | 'rich'
  hasNumbers: boolean
  // Figures the creator actually says, e.g. ["3 steps", "50% off"]. Feed the
  // motion-graphics stat cards and hook titles — never invented.
  keyNumbers: string[]
  // 3-5 lines the creator naturally punches. Anchor callouts to these (with the
  // word timings we already have) instead of guessing which words matter.
  emphasisPhrases: string[]
  hookStrength: 'weak' | 'medium' | 'strong'
  // Short (<=6 words), grounded in what's actually said on camera.
  suggestedHookTitle: string
  // The AI's read of what caption family fits the tone; nudges lane selection.
  captionMood: 'calm' | 'clean' | 'energetic'
  // Zooms and lower-thirds look bad on already-tight framing — a purely visual
  // fact a transcript can never provide.
  faceFraming: 'tight' | 'wide'
}

// Neutral, middle-of-the-road profile. Returned when Gemini is unavailable or
// errors so the pipeline degrades gracefully (matches the rest of the codebase,
// where every enrichment step is best-effort). Every variant still renders — it
// just falls back to its fixed personality with no content-aware nudging.
export const FALLBACK_PROFILE: ContentProfile = {
  speechPace: 'measured',
  energy: 'medium',
  sensitivity: 'neutral',
  format: 'educational',
  brollableRichness: 'some',
  hasNumbers: false,
  keyNumbers: [],
  emphasisPhrases: [],
  hookStrength: 'medium',
  suggestedHookTitle: '',
  captionMood: 'clean',
  faceFraming: 'wide',
}

// Google's JSON-schema subset (uppercase type names + enum). gemini.ts passes
// this straight into generationConfig.responseSchema, forcing validated JSON.
const CONTENT_PROFILE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    speechPace: { type: 'STRING', enum: ['slow', 'measured', 'fast'] },
    energy: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    sensitivity: { type: 'STRING', enum: ['neutral', 'personal', 'medical_emotional'] },
    format: { type: 'STRING', enum: ['story', 'educational', 'list', 'sales'] },
    brollableRichness: { type: 'STRING', enum: ['none', 'some', 'rich'] },
    hasNumbers: { type: 'BOOLEAN' },
    keyNumbers: { type: 'ARRAY', items: { type: 'STRING' } },
    emphasisPhrases: { type: 'ARRAY', items: { type: 'STRING' } },
    hookStrength: { type: 'STRING', enum: ['weak', 'medium', 'strong'] },
    suggestedHookTitle: { type: 'STRING' },
    captionMood: { type: 'STRING', enum: ['calm', 'clean', 'energetic'] },
    faceFraming: { type: 'STRING', enum: ['tight', 'wide'] },
  },
  required: [
    'speechPace', 'energy', 'sensitivity', 'format', 'brollableRichness',
    'hasNumbers', 'keyNumbers', 'emphasisPhrases', 'hookStrength',
    'suggestedHookTitle', 'captionMood', 'faceFraming',
  ],
}

const PROMPT = [
  'You are a short-form video editor analyzing a talking-head clip for a med-spa',
  'clinic. Watch the footage and read the audio, then return a structured profile',
  'that a downstream editor will use to pick caption style, pacing, zooms, B-roll,',
  'and motion-graphic overlays. Judge what is ACTUALLY in the video, not what you',
  'assume a med-spa video contains.',
  '',
  'Guidance per field:',
  '- sensitivity: "medical_emotional" for vulnerable/medical/personal-health content,',
  '  "personal" for candid but non-sensitive, else "neutral". This caps how aggressive',
  '  the edit is allowed to get, so be honest.',
  '- brollableRichness: "rich" only if there is genuinely something worth cutting away',
  '  to (products, procedures, demos, locations). A static person talking to camera',
  '  with nothing to illustrate is "none".',
  '- keyNumbers / hasNumbers: only figures the speaker actually says. Never invent a',
  '  statistic. Empty array if none.',
  '- emphasisPhrases: 3-5 short phrases the speaker genuinely stresses or that carry',
  '  the message. Quote them close to how they are said.',
  '- suggestedHookTitle: <=6 words, grounded in what is said, no clickbait.',
  '- faceFraming: "tight" if the face fills much of the frame (overlays would cover',
  '  it), "wide" if there is room around them.',
].join('\n')

// Guessed mime types are fine — Gemini only needs the family right.
const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mp3',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
}

// Read a local media file into the inline shape gemini.ts expects. NOTE: inline
// data is capped (~20MB per request); the compressed source is usually well
// under that for short-form, but very long/high-bitrate clips may need the Files
// API later. Keep the compressed (crf 23) file as the input, never the raw.
export function localFileToInlineMedia(filePath: string): InlineMedia {
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = MIME_BY_EXT[ext] ?? 'video/mp4'
  const data = fs.readFileSync(filePath).toString('base64')
  return { mimeType, data }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

// Coerce whatever Gemini returns onto the exact enums/shapes we rely on, filling
// any gap from FALLBACK_PROFILE so callers never see an out-of-range value.
function normalizeProfile(raw: Partial<ContentProfile>): ContentProfile {
  const f = FALLBACK_PROFILE
  return {
    speechPace: oneOf(raw.speechPace, ['slow', 'measured', 'fast'], f.speechPace),
    energy: oneOf(raw.energy, ['low', 'medium', 'high'], f.energy),
    sensitivity: oneOf(raw.sensitivity, ['neutral', 'personal', 'medical_emotional'], f.sensitivity),
    format: oneOf(raw.format, ['story', 'educational', 'list', 'sales'], f.format),
    brollableRichness: oneOf(raw.brollableRichness, ['none', 'some', 'rich'], f.brollableRichness),
    hasNumbers: typeof raw.hasNumbers === 'boolean' ? raw.hasNumbers : f.hasNumbers,
    keyNumbers: Array.isArray(raw.keyNumbers) ? raw.keyNumbers.filter((s): s is string => typeof s === 'string').slice(0, 8) : [],
    emphasisPhrases: Array.isArray(raw.emphasisPhrases) ? raw.emphasisPhrases.filter((s): s is string => typeof s === 'string').slice(0, 5) : [],
    hookStrength: oneOf(raw.hookStrength, ['weak', 'medium', 'strong'], f.hookStrength),
    suggestedHookTitle: typeof raw.suggestedHookTitle === 'string' ? raw.suggestedHookTitle.slice(0, 80) : f.suggestedHookTitle,
    captionMood: oneOf(raw.captionMood, ['calm', 'clean', 'energetic'], f.captionMood),
    faceFraming: oneOf(raw.faceFraming, ['tight', 'wide'], f.faceFraming),
  }
}

// Analyze the video and return the content profile. Best-effort: on any failure
// (missing key, API error, bad JSON) it logs and returns FALLBACK_PROFILE so the
// render never blocks on this. Pass the transcript when available to ground the
// text fields (emphasisPhrases / keyNumbers) in the real words.
export async function analyzeVideoContent(
  media: InlineMedia,
  opts: { transcript?: string; model?: string } = {},
): Promise<ContentProfile> {
  const transcriptBlock = opts.transcript
    ? `\n\nTranscript of what is said (use to ground the text fields):\n"${opts.transcript.slice(0, 2000)}"`
    : ''

  const call = (apiKey: string | undefined, model: string | undefined) => geminiJSON<Partial<ContentProfile>>({
    prompt: PROMPT + transcriptBlock,
    media: [media],
    responseSchema: CONTENT_PROFILE_SCHEMA,
    temperature: 0.2,
    maxOutputTokens: 1024,
    model,
    apiKey,
  })

  const keys = [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3]
    .filter((k): k is string => !!k)

  // Primary model (flash-lite) is cheapest but gets shed first under load (503s).
  // On a persistent overload, fall back to the sturdier gemini-2.5-flash, which
  // stays available when lite is busy. Deduped so we never try the same model twice.
  const primaryModel = opts.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
  const models = [...new Set([primaryModel, 'gemini-2.5-flash'])]

  // Retry a single (key, model) pair on transient 503/overload with backoff.
  const attempt = async (apiKey: string, model: string): Promise<Partial<ContentProfile>> => {
    const MAX = 3
    for (let a = 0; a < MAX; a++) {
      try {
        return await call(apiKey, model)
      } catch (e) {
        const msg = (e as Error).message
        const transient = /\b503\b|UNAVAILABLE|high demand|overloaded/i.test(msg)
        if (transient && a < MAX - 1) {
          await new Promise(r => setTimeout(r, 2000 * (a + 1)))
          continue
        }
        throw e
      }
    }
    throw new Error('unreachable')
  }

  try {
    let raw: Partial<ContentProfile> | null = null
    let lastErr: Error | null = null
    // Try each key; within a key, try the primary model then fall back to the
    // sturdier model on a persistent overload. A quota/429 means the key is spent,
    // so skip straight to the next key (a different model won't help a dead key).
    outer:
    for (let i = 0; i < keys.length; i++) {
      for (const model of models) {
        try {
          raw = await attempt(keys[i], model)
          break outer
        } catch (e) {
          lastErr = e as Error
          const msg = lastErr.message
          const quota = /\b429\b|quota|RESOURCE_EXHAUSTED|credits/i.test(msg)
          if (quota) {
            if (i < keys.length - 1) console.warn(`[video-analysis] key ${i + 1} out of quota, trying next key`)
            break // next key
          }
          // persistent overload on this model — try the fallback model, same key
          console.warn(`[video-analysis] key ${i + 1} model ${model} overloaded, trying sturdier model`)
        }
      }
    }
    if (!raw) throw lastErr ?? new Error('no Gemini API key configured')

    const profile = normalizeProfile(raw)
    console.log('[video-analysis] content profile:', JSON.stringify(profile))
    return profile
  } catch (e) {
    console.warn('[video-analysis] analysis failed, using fallback profile:', (e as Error).message)
    return FALLBACK_PROFILE
  }
}

// Convenience wrapper for the common case: analyze straight from a local file.
export async function analyzeVideoFile(
  filePath: string,
  opts: { transcript?: string; model?: string } = {},
): Promise<ContentProfile> {
  return analyzeVideoContent(localFileToInlineMedia(filePath), opts)
}
