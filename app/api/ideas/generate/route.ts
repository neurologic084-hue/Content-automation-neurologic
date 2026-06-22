import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildHumanizerInstruction } from '@/lib/humanizer'
import { searchNicheNews } from '@/lib/tavily'

export async function POST() {
  const supabase = await createClient()

  const { data: brand } = await supabase.from('brand_settings').select('*').single()
  if (!brand) return NextResponse.json({ error: 'Brand settings not configured' }, { status: 400 })

  const toneList = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const icp = brand.icp_definition || brand.patient_transformation || ''
  const positioning = brand.positioning || brand.what_makes_different || ''
  const offerings = brand.core_offerings || ''

  // Run news search + previous ideas fetch in parallel
  const nicheQuery = [
    positioning,
    offerings,
    icp,
    'nervous system ADHD burnout functional medicine wellness',
  ].filter(Boolean).join(' ').slice(0, 300)

  const [newsItems, previousIdeasRes] = await Promise.allSettled([
    searchNicheNews(nicheQuery),
    supabase
      .from('ideas')
      .select('raw_idea')
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  const news = newsItems.status === 'fulfilled' ? newsItems.value : []
  const previousIdeas =
    previousIdeasRes.status === 'fulfilled'
      ? (previousIdeasRes.value.data ?? []).map((i: { raw_idea: string }) => i.raw_idea)
      : []

  const newsSection =
    news.length > 0
      ? `RECENT NEWS IN THIS NICHE — use these to inspire fresh, timely angles (you don't have to quote them, just draw on what's new and relevant):
${news.map((n, i) => `${i + 1}. ${n.title} — ${n.snippet}`).join('\n')}`
      : ''

  const dedupSection =
    previousIdeas.length > 0
      ? `ALREADY COVERED — do NOT generate ideas about the same topic or angle as any of these:
${previousIdeas.slice(0, 30).map((t) => `• ${t}`).join('\n')}`
      : ''

  const systemMessage = `You are a viral short-form content strategist specialising in health, wellness, and high-performance brands. You generate content ideas that stop the scroll, create genuine resonance, and drive action.

${buildHumanizerInstruction()}`

  const userMessage = `Generate exactly 10 short-form video content ideas for this brand.

BRAND: ${brand.clinic_name}
POSITIONING: ${positioning}
IDEAL CLIENT: ${icp}
OFFERINGS: ${offerings}
TONE: ${toneList}

${newsSection}

${dedupSection}

Each idea must follow this exact format:
- One clear sentence stating what the video is about (the topic and angle)
- One sentence saying what the viewer will learn or feel by the end
- Plain, conversational language your ideal client would immediately understand
- Specific, not generic — not "talk about stress" but "why you feel exhausted all day but suddenly wired at 10pm"
- No internal directions, no "Hook:", no "End with:", no scripting notes
- No em dashes

Use one of these angles (one per idea, in this order):
1. Mechanism reveal
2. Myth bust
3. Validation
4. Urgency
5. Result story
6. Curiosity gap
7. Bold take
8. How-to
9. Comparison
10. Personal story

Where possible, tie 3-5 of the ideas to something from the recent news above — a new finding, a trending topic, or a specific claim that the audience would find surprising.

Respond ONLY with raw JSON, no markdown:
{"ideas": ["Idea written in plain conversational sentences.", "...", ...10 total]}`

  let raw: string
  try {
    raw = await chatCompletion({
      model: MODELS.fast,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.92,
      max_tokens: 1400,
      json: true,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  let parsed: { ideas: string[] }
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.ideas)) throw new Error('bad shape')
  } catch {
    return NextResponse.json({ error: 'Failed to parse generated ideas' }, { status: 500 })
  }

  return NextResponse.json({ ideas: parsed.ideas.slice(0, 10) })
}
