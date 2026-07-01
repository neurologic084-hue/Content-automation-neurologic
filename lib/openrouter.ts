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

export async function chatCompletion(opts: CompletionOptions): Promise<string> {
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
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const raw: string = data.choices[0]?.message?.content ?? ''

  // Strip markdown code fences that some models add despite response_format: json_object
  if (opts.json) {
    return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  }

  return raw
}
