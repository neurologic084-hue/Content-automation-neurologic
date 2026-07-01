// ── Gemini client (native audio / video understanding) ────────────────────────
// The OpenRouter client (lib/openrouter.ts) handles our text LLM calls. Gemini is
// added ONLY for what OpenRouter can't reliably do: analyzing real media files
// (an audio track, a video). It talks to Google's Generative Language REST API
// directly — no SDK — mirroring the fetch style of the OpenRouter client.
//
// Needs GEMINI_API_KEY. Model is overridable via GEMINI_MODEL (default below) so
// we can bump versions without a code change if the id ever 404s.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash'

export interface InlineMedia {
  mimeType: string   // e.g. "audio/mp3", "video/mp4"
  data: string       // base64-encoded bytes
}

interface GenerateOptions {
  prompt: string
  media?: InlineMedia[]
  model?: string
  // A JSON Schema (Google's subset) — when set, Gemini returns validated JSON.
  responseSchema?: Record<string, unknown>
  temperature?: number
  maxOutputTokens?: number
  // Gemini 3.x models "think" by default, and reasoning tokens draw from the
  // output budget — which can truncate the actual answer. Default to 0 (off) for
  // our structured extraction tasks; raise it if a task genuinely needs reasoning.
  thinkingBudget?: number
  // Override the API key (default GEMINI_API_KEY). Lets a caller spread requests
  // across multiple keys to multiply a per-key rate limit.
  apiKey?: string
}

// Low-level generateContent call. Returns the raw text part (JSON string when a
// responseSchema is supplied). Throws on a non-200 so callers can skip + retry.
export async function geminiGenerate(opts: GenerateOptions): Promise<string> {
  const key = opts.apiKey || process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')

  const model = opts.model || DEFAULT_MODEL
  const parts: Record<string, unknown>[] = [{ text: opts.prompt }]
  for (const m of opts.media ?? []) {
    parts.push({ inline_data: { mime_type: m.mimeType, data: m.data } })
  }

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
      thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
      ...(opts.responseSchema
        ? { responseMimeType: 'application/json', responseSchema: opts.responseSchema }
        : {}),
    },
  }

  const res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const text: string = data?.candidates?.[0]?.content?.parts
    ?.map((p: { text?: string }) => p.text ?? '')
    .join('') ?? ''
  return text.trim()
}

// Convenience: generateContent expecting a JSON object back (responseSchema set).
export async function geminiJSON<T>(opts: GenerateOptions): Promise<T> {
  const raw = await geminiGenerate(opts)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch (e) {
    throw new Error(`${(e as Error).message} — raw: ${JSON.stringify(raw.slice(0, 300))}`)
  }
}
