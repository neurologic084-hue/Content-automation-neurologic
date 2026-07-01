import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildRevisionMessages } from '@/lib/prompts'
import type { AudienceLane, GeneratedScript } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { script_id } = await req.json()
  if (!script_id) return NextResponse.json({ error: 'script_id required' }, { status: 400 })

  const supabase = await createClient()

  const { data: script, error: scriptError } = await supabase
    .from('scripts')
    .select('*, idea:ideas(*)')
    .eq('id', script_id)
    .single()

  if (scriptError || !script) return NextResponse.json({ error: 'Script not found' }, { status: 404 })

  const idea = Array.isArray(script.idea) ? script.idea[0] : script.idea
  if (!idea) return NextResponse.json({ error: 'Idea not found' }, { status: 404 })
  if (!script.revision_notes?.trim()) return NextResponse.json({ error: 'No revision notes on this script' }, { status: 400 })

  const { data: brand } = await supabase.from('brand_settings').select('*').eq('is_active', true).single()
  if (!brand) return NextResponse.json({ error: 'Brand settings not configured' }, { status: 400 })

  const { data: fewShotsRaw } = await supabase
    .from('scripts')
    .select('hook, body, cta')
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(15)

  const fewShots = (fewShotsRaw ?? []) as any[]

  const messages = buildRevisionMessages(
    { hook: script.hook, body: script.body, cta: script.cta },
    script.revision_notes,
    idea.raw_idea,
    idea.confirmed_lane as AudienceLane,
    brand,
    fewShots
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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  let generated: GeneratedScript
  try {
    generated = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Failed to parse revised script' }, { status: 500 })
  }

  const { data: newScript, error: insertError } = await supabase
    .from('scripts')
    .insert({
      idea_id: idea.id,
      hook: generated.hook,
      body: generated.body,
      cta: generated.cta,
      full_script: generated.full_script,
      filming_plan: generated.filming_plan,
      mood_tag: generated.mood_tag,
      why_this_works: generated.why_this_works,
      search_context: script.search_context,
      status: 'pending_review',
    })
    .select('id')
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  await supabase.from('scripts').update({ status: 'rejected' }).eq('id', script_id)
  await supabase.from('ideas').update({ status: 'ready_for_review' }).eq('id', idea.id)

  return NextResponse.json({ script_id: newScript.id })
}
