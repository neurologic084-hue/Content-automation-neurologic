import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { hook, body, cta, audience_lane, mood_tag, approve } = await req.json()

  if (!hook?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Hook and body are required.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const now = new Date().toISOString()

  // Scripts require an idea FK — create a stub idea for manually-entered scripts
  const { data: idea, error: ideaError } = await supabase
    .from('ideas')
    .insert({
      raw_idea: hook.trim().slice(0, 200),
      confirmed_lane: audience_lane ?? null,
      status: 'approved',
    })
    .select('id')
    .single()

  if (ideaError || !idea) {
    return NextResponse.json({ error: ideaError?.message ?? 'Failed to create idea.' }, { status: 500 })
  }

  const fullScript = [hook.trim(), body.trim(), cta?.trim()].filter(Boolean).join('\n\n')

  const { data: script, error } = await supabase
    .from('scripts')
    .insert({
      idea_id: idea.id,
      hook: hook.trim(),
      body: body.trim(),
      cta: cta?.trim() ?? '',
      full_script: fullScript,
      filming_plan: {},
      mood_tag: mood_tag ?? null,
      status: approve ? 'approved' : 'pending_review',
      approved_at: approve ? now : null,
    })
    .select('id')
    .single()

  if (error || !script) {
    return NextResponse.json({ error: error?.message ?? 'Failed to save script.' }, { status: 500 })
  }

  return NextResponse.json({ script_id: script.id })
}
