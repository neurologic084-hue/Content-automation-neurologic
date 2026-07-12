// ── Gemini via OpenRouter (native audio / video understanding) ────────────────
// All LLM traffic — text AND media analysis — now flows through the one
// OpenRouter account. Gemini models on OpenRouter accept video/audio as
// content parts, so the separate GEMINI_API_KEY (and its separate billing)
// is gone. The exported surface is unchanged: callers still pass a prompt,
// inline media, and an optional Google-style responseSchema.
//
// Model is overridable via GEMINI_MODEL (default below) so we can bump
// versions without a code change if the id ever 404s.


const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'google/gemini-3.5-flash'

// Same retry discipline as lib/openrouter.ts: media-analysis calls used to be
// a single fetch, so one transient blip (429, gateway hiccup, dropped socket)
// failed the whole analysis and silently downgraded the render to the fallback
// profile. 408/429/5xx and transient network errors get retried; real 4xx
// (bad key, bad request) never do.
const REQUEST_TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 1_500

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export interface InlineMedia {
  mimeType: string   // e.g. "audio/mp3", "video/mp4"
  data: string       // base64-encoded bytes
}

interface GenerateOptions {
  prompt: string
  media?: InlineMedia[]
  model?: string
  // A JSON Schema (Google's uppercase-type subset) — converted to standard
  // JSON Schema and enforced via OpenRouter structured outputs.
  responseSchema?: Record<string, unknown>
  temperature?: number
  maxOutputTokens?: number
  // Gemini models "think" by default, and reasoning tokens draw from the
  // output budget — which can truncate the actual answer. Default to 0 (off)
  // for our structured extraction tasks.
  thinkingBudget?: number
  // Override the API key (default OPENROUTER_API_KEY).
  apiKey?: string
}

// Google's schema subset writes types in uppercase (OBJECT/STRING/...);
// standard JSON Schema wants lowercase. Convert recursively; everything else
// (properties, items, enum, required, description) passes through untouched.
function toStandardSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStandardSchema)
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toStandardSchema(v)
    }
    return out
  }
  return node
}

// One inline media file → the OpenRouter content part for its kind.
function mediaPart(m: InlineMedia): Record<string, unknown> {
  if (m.mimeType.startsWith('audio/')) {
    // input_audio takes a bare format name, not a mime type
    const format = m.mimeType.split('/')[1]?.replace('mpeg', 'mp3') ?? 'mp3'
    return { type: 'input_audio', input_audio: { data: m.data, format } }
  }
  if (m.mimeType.startsWith('image/')) {
    return { type: 'image_url', image_url: { url: `data:${m.mimeType};base64,${m.data}` } }
  }
  return { type: 'video_url', video_url: { url: `data:${m.mimeType};base64,${m.data}` } }
}

// Low-level chat call. Returns the raw text (JSON string when a
// responseSchema is supplied). Throws on a non-200 so callers can skip + retry.
export async function geminiGenerate(opts: GenerateOptions): Promise<string> {
  const key = opts.apiKey || process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')

  const model = opts.model || DEFAULT_MODEL
  const media = opts.media ?? []
  const content: Record<string, unknown>[] = [
    { type: 'text', text: opts.prompt },
    ...media.map(mediaPart),
  ]

  const hasVideo = media.some(m => m.mimeType.startsWith('video/'))

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxOutputTokens ?? 1024,
    // Only steer reasoning when a budget is requested — some Gemini endpoints
    // reject {enabled:false} outright ("Reasoning is mandatory").
    ...((opts.thinkingBudget ?? 0) > 0 ? { reasoning: { max_tokens: opts.thinkingBudget } } : {}),
    ...(opts.responseSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'result', strict: true, schema: toStandardSchema(opts.responseSchema) },
          },
        }
      : {}),
    // Base64 video data URLs are a Vertex-only feature — Google's AI Studio
    // provider on OpenRouter accepts YouTube links only.
    ...(hasVideo ? { provider: { only: ['google-vertex'] } } : {}),
  }

  let lastError: Error | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const err = (await res.text()).slice(0, 500)
        const e = new Error(`Gemini (OpenRouter) error ${res.status}: ${err}`)
        if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
          lastError = e
          console.warn(`[gemini] ${model} attempt ${attempt}/${MAX_ATTEMPTS} failed (${res.status}), retrying`)
          await sleep(RETRY_BASE_MS * attempt)
          continue
        }
        throw e
      }

      const data = await res.json()
      const text: string = data?.choices?.[0]?.message?.content ?? ''
      return text.trim()
    } catch (e) {
      const err = e as Error
      const transient = err.name === 'TimeoutError' || err.name === 'AbortError' || /terminated|fetch failed|socket|ECONNRESET/i.test(err.message)
      if (transient && attempt < MAX_ATTEMPTS) {
        lastError = err
        console.warn(`[gemini] ${model} attempt ${attempt}/${MAX_ATTEMPTS} ${err.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err.message}, retrying`)
        await sleep(RETRY_BASE_MS * attempt)
        continue
      }
      throw err
    }
  }
  throw lastError ?? new Error('Gemini (OpenRouter): exhausted retries')
}

// Convenience: a call expecting a JSON object back (responseSchema set).
export async function geminiJSON<T>(opts: GenerateOptions): Promise<T> {
  const raw = await geminiGenerate(opts)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch (e) {
    throw new Error(`${(e as Error).message} — raw: ${JSON.stringify(raw.slice(0, 300))}`)
  }
}
