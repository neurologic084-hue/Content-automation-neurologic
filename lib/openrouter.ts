
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export const MODELS = {
  script: 'anthropic/claude-sonnet-4-6',
  // EDITORIAL decisions the viewer actually sees: where a cut lands, which
  // clip covers which line, what a caption emphasises. These were on the cheap
  // tier and it showed — an elevator clip over a line about captions, cuts in
  // the wrong place. Judgement matters more than latency here, and these calls
  // are small (a transcript plus a prompt), so the cost delta is modest.
  planner: 'anthropic/claude-sonnet-4-6',
  // Mechanical classification with a small fixed answer space (pick a mood,
  // rank a list, choose a template). Haiku is genuinely sufficient and paying
  // Sonnet prices for these would be waste, not quality.
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

  // LAST RESORT: go straight to the model's own provider.
  //
  // OpenRouter is this app's single largest dependency — 15 modules route
  // every LLM call through it, so one exhausted account or one outage takes
  // out script generation, cut planning, B-roll placement, caption styling and
  // footage analysis at the same time. It routes across providers internally,
  // which covers a provider being down, but nothing covers OUR account being
  // out of credits.
  //
  // Optional by design: no ANTHROPIC_API_KEY means this is a no-op and the
  // original error surfaces exactly as before. Set one and it becomes a spare
  // tyre that only ever gets used when the main path is already broken.
  const direct = await directProviderFallback(opts, lastError ?? null)
  if (direct !== null) return direct

  throw lastError ?? new Error('OpenRouter: exhausted retries')
}

async function directProviderFallback(opts: CompletionOptions, cause: Error | null): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  // Only Anthropic models can be re-pointed at Anthropic. A google/* model has
  // no home here, and silently swapping to a different family mid-render would
  // change output style rather than rescue it.
  if (!key || !opts.model.startsWith('anthropic/')) return null

  const model = opts.model.replace(/^anthropic\//, '')
  // Anthropic takes the system turn as a top-level field, not a message.
  const system = opts.messages.filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : '')).join('\n\n')
  const messages = opts.messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  if (!messages.length) return null

  try {
    console.warn(`[openrouter] unavailable (${cause?.message?.slice(0, 90)}) — falling back to Anthropic directly for ${model}`)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.max_tokens ?? 2000,
        temperature: opts.temperature ?? 0.7,
        ...(system ? { system } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[openrouter] Anthropic fallback also failed (${res.status})`)
      return null
    }
    const body = await res.json() as { content?: Array<{ type: string; text?: string }> }
    const text = (body.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('').trim()
    if (!text) return null
    console.log('[openrouter] Anthropic direct fallback answered')
    return text
  } catch (e) {
    console.warn('[openrouter] Anthropic fallback errored:', (e as Error).message)
    return null
  }
}
