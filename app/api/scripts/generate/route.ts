import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildScriptGenerationMessages } from '@/lib/prompts'
import { searchWebEnhanced, formatSearchContext } from '@/lib/tavily'
import { parseJsonLoose } from '@/lib/json-loose'
import { getLearningContext, formatLearningSections } from '@/lib/learning'
import type { AudienceLane, GeneratedScript } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { idea_id, mood_tag: requestedMood, use_brand_context: useBrandContext = true, script_format: scriptFormat } = await req.json()

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

  const lane = idea.confirmed_lane as AudienceLane

  let messages: Array<{ role: 'system' | 'user'; content: string }>
  let searchResponse: Awaited<ReturnType<typeof searchWebEnhanced>> = null

  if (useBrandContext) {
    // Full pipeline: brand voice + few-shot examples + web search
    const { data: brand } = await supabase.from('brand_settings').select('*').eq('is_active', true).single()
    if (!brand) {
      return NextResponse.json({ error: 'Brand settings not configured' }, { status: 400 })
    }

    // Learning loop: relevance-ranked few-shots (same lane/format first),
    // past revision feedback as standing lessons, recent hooks as a no-repeat
    // list — so every generation improves on what came before.
    const [learning, sr] = await Promise.all([
      getLearningContext(supabase, { lane, scriptFormat: scriptFormat ?? null, profileSlot: brand.profile_slot ?? 1 }),
      searchWebEnhanced(idea.raw_idea, lane),
    ])
    searchResponse = sr
    const searchContext = formatSearchContext(searchResponse)

    messages = buildScriptGenerationMessages(
      idea.raw_idea,
      lane,
      brand,
      learning.fewShots as any[],
      searchContext,
      requestedMood ?? undefined,
      scriptFormat ?? undefined,
      formatLearningSections(learning)
    )
  } else {
    // Lean pipeline: purely from the idea, no brand/audience context
    const toneNote = requestedMood ? ` Lean ${requestedMood} in tone.` : ''
    messages = [
      {
        role: 'system',
        content: `You are an expert short-form video scriptwriter. Write compelling, direct scripts for social media (60-90 seconds when spoken aloud). Return ONLY valid JSON matching this schema exactly — no markdown, no extra keys:
{
  "hook": "opening line that grabs attention in under 3 seconds",
  "body": "main content — value-dense, conversational, no fluff",
  "cta": "clear call to action",
  "full_script": "hook + body + cta combined as one natural flow",
  "filming_plan": { "shot_list": ["..."], "on_screen_text": ["..."], "b_roll": ["..."] },
  "mood_tag": "one word describing the emotional tone",
  "why_this_works": "one sentence on why this script is effective"
}`,
      },
      {
        role: 'user',
        content: `Write a short-form video script for this idea: "${idea.raw_idea}".${toneNote}${scriptFormat === 'lead_magnet' ? ' LEAD MAGNET FORMAT: end the body with a genuine giveaway signal ("I\'m giving this away for free." or similar), and the CTA must be exactly "Comment [WORD] below and I\'ll DM/send it to you." No other CTA.' : scriptFormat ? ` Use the ${scriptFormat} format.` : ''} Make it punchy, direct, and built for social media. No hashtags.`,
      },
    ]
  }

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
    generated = parseJsonLoose<GeneratedScript>(raw)
  } catch {
    await supabase.from('ideas').update({ status: 'pending_lane_confirm' }).eq('id', idea_id)
    return NextResponse.json({ error: 'Failed to parse generated script' }, { status: 500 })
  }

  if (!generated.hook?.trim() || !generated.body?.trim()) {
    await supabase.from('ideas').update({ status: 'pending_lane_confirm' }).eq('id', idea_id)
    return NextResponse.json({ error: 'Generated script was incomplete — try again' }, { status: 500 })
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
      filming_plan: {
        ...((generated.filming_plan as object) ?? {}),
        script_format: (generated as any).script_format ?? 'educational',
        re_hook: (generated as any).re_hook ?? '',
        alt_hooks: Array.isArray((generated as any).alt_hooks) ? (generated as any).alt_hooks.slice(0, 2) : [],
        delivery_cues: Array.isArray((generated as any).delivery_cues) ? (generated as any).delivery_cues.slice(0, 5) : [],
      },
      mood_tag: requestedMood ?? generated.mood_tag,
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
