import { NextRequest, NextResponse } from 'next/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildLaneSuggestionPrompt } from '@/lib/prompts'
import type { LaneSuggestion } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { idea } = await req.json()

  if (!idea?.trim()) {
    return NextResponse.json({ error: 'Idea is required' }, { status: 400 })
  }

  const prompt = buildLaneSuggestionPrompt(idea)

  const raw = await chatCompletion({
    model: MODELS.fast,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 300,
    json: true,
  })

  let suggestion: LaneSuggestion
  try {
    suggestion = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }

  return NextResponse.json(suggestion)
}
