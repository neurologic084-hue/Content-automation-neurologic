import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildScriptGenerationMessages } from '@/lib/prompts'
import { searchWebEnhanced, formatSearchContext } from '@/lib/tavily'
import type { AudienceLane, GeneratedScript } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { idea_id } = await req.json()

  if (!idea_id) {
    return NextResponse.json({ error: 'idea_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  // Fetch idea
  const { data: idea, error: ideaError } = await supabase
    .from('ideas')
    .select('*')
    .eq('id', idea_id)
    .single()

  if (ideaError || !idea) {
    return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  }

  if (!idea.confirmed_lane) {
    return NextResponse.json({ error: 'Lane not confirmed yet' }, { status: 400 })
  }

  // Mark as generating
  await supabase.from('ideas').update({ status: 'generating' }).eq('id', idea_id)

  // Fetch brand settings
  const { data: brand } = await supabase.from('brand_settings').select('*').single()

  if (!brand) {
    return NextResponse.json({ error: 'Brand settings not configured' }, { status: 400 })
  }

  // Fetch few-shot examples (top approved scripts)
  const { data: fewShotsRaw } = await supabase
    .from('scripts')
    .select('hook, body, cta')
    .eq('status', 'approved')
    .eq('is_few_shot', true)
    .order('approved_at', { ascending: false })
    .limit(3)

  const fewShots = (fewShotsRaw ?? []) as any[]

  // Search the web — dual query: research + viral angle
  const lane = idea.confirmed_lane as AudienceLane
  const searchResponse = await searchWebEnhanced(idea.raw_idea, lane)
  const searchContext = formatSearchContext(searchResponse)

  // Build system+user messages and generate script
  const messages = buildScriptGenerationMessages(
    idea.raw_idea,
    lane,
    brand,
    fewShots,
    searchContext
  )

  let raw: string
  try {
    raw = await chatCompletion({
      model: MODELS.script,
      messages,
      temperature: 0.7,
      max_tokens: 2200,
      json: true,
    })
  } catch (err) {
    await supabase.from('ideas').update({ status: 'pending_lane_confirm' }).eq('id', idea_id)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  let generated: GeneratedScript
  try {
    generated = JSON.parse(raw)
  } catch {
    await supabase.from('ideas').update({ status: 'pending_lane_confirm' }).eq('id', idea_id)
    return NextResponse.json({ error: 'Failed to parse generated script' }, { status: 500 })
  }

  // Save script to DB
  const { data: script, error: scriptError } = await supabase
    .from('scripts')
    .insert({
      idea_id,
      hook: generated.hook,
      body: generated.body,
      cta: generated.cta,
      full_script: generated.full_script,
      filming_plan: generated.filming_plan,
      mood_tag: generated.mood_tag,
      why_this_works: generated.why_this_works,
      search_context: searchResponse
        ? {
            query: searchResponse.query,
            results: searchResponse.results.slice(0, 4).map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.content.slice(0, 200),
            })),
            answer: searchResponse.answer,
          }
        : null,
      status: 'pending_review',
    })
    .select('id')
    .single()

  if (scriptError) {
    await supabase.from('ideas').update({ status: 'pending_lane_confirm' }).eq('id', idea_id)
    return NextResponse.json({ error: scriptError.message }, { status: 500 })
  }

  // Update idea status
  await supabase.from('ideas').update({ status: 'ready_for_review' }).eq('id', idea_id)

  return NextResponse.json({ script_id: script.id })
}
