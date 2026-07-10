import { notifyOps } from './notify'

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export const MODELS = {
  script: 'anthropic/claude-sonnet-4-6',
  fast: 'anthropic/claude-haiku-4-5',
} as const

// content is a plain string for text-only turns, or an array of content parts
// (text + image_url + input_audio) for multimodal turns like audio understanding.
type ContentPart = Record<string, unknown>

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

interface CompletionOptions {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  json?: boolean
}

// A hung completion used to hang the whole render: this fetch had no timeout at
// all, so a stalled connection blocked a variant until the 30-minute safety
// timer in motion-renderer fired. Observed: planViralCaptions sat for 33 minutes
// mid-render, and the poisoned connection pool then killed B-roll planning with
// undici's "terminated", so the variant rendered with no B-roll at all.
const REQUEST_TIMEOUT_MS = 120_000
const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 1_500

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 408/429 and 5xx are worth another go; 4xx (bad key, bad request) never is.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export async function chatCompletion(opts: CompletionOptions): Promise<string> {
  let lastError: Error | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          'X-Title': 'Olympus',
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.max_tokens ?? 2000,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (!res.ok) {
        const err = (await res.text().catch(() => '')).slice(0, 300)
        const e = new Error(`OpenRouter error ${res.status}: ${err}`)
        if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
          lastError = e
          console.warn(`[openrouter] ${opts.model} attempt ${attempt}/${MAX_ATTEMPTS} failed (${res.status}), retrying`)
          await sleep(RETRY_BASE_MS * attempt)
          continue
        }
        // Dead key / empty credits kills EVERY AI stage at once, and most
        // callers degrade silently (fallback profile, kept takes, heuristic
        // captions) — so the render "succeeds" and hides the outage. Alert the
        // moment it happens; one alert per hour is plenty since every call
        // fails identically until credits are topped up.
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          notifyOps(
            `🔴 OpenRouter auth/credit failure (HTTP ${res.status}) — AI stages are silently degrading on every render until this is fixed: ${err}`,
            { key: 'openrouter-credits', dedupeMs: 60 * 60 * 1000 },
          )
        }
        throw e
      }

      const data = await res.json()
      // A malformed body used to throw a bare TypeError on data.choices[0].
      const raw: string | undefined = data?.choices?.[0]?.message?.content
      if (typeof raw !== 'string') {
        const e = new Error(`OpenRouter returned no completion: ${JSON.stringify(data).slice(0, 300)}`)
        if (attempt < MAX_ATTEMPTS) {
          lastError = e
          console.warn(`[openrouter] ${opts.model} attempt ${attempt}/${MAX_ATTEMPTS} returned no content, retrying`)
          await sleep(RETRY_BASE_MS * attempt)
          continue
        }
        throw e
      }

      // Strip markdown code fences that some models add despite response_format: json_object
      if (opts.json) {
        return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
      }
      return raw
    } catch (e) {
      const err = e as Error
      // AbortSignal.timeout throws TimeoutError; undici throws "terminated" when
      // a connection dies mid-stream. Both are transient — retry them.
      const transient = err.name === 'TimeoutError' || err.name === 'AbortError' || /terminated|fetch failed|socket|ECONNRESET/i.test(err.message)
      if (transient && attempt < MAX_ATTEMPTS) {
        lastError = err
        console.warn(`[openrouter] ${opts.model} attempt ${attempt}/${MAX_ATTEMPTS} ${err.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err.message}, retrying`)
        await sleep(RETRY_BASE_MS * attempt)
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error('OpenRouter: exhausted retries')
}
