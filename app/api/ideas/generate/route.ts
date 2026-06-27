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
  const icp = brand.audience_description || ''
  const positioning = brand.unique_angle || ''
  const offerings = brand.offerings || ''

  // Run news search + previous ideas fetch in parallel
  const nicheQuery = [
    positioning,
    offerings,
    icp,
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
      ? `RECENT NEWS IN THIS NICHE   use these to inspire fresh, timely angles (you don't have to quote them, just draw on what's new and relevant):
${news.map((n, i) => `${i + 1}. ${n.title}   ${n.snippet}`).join('\n')}`
      : ''

  const dedupSection =
    previousIdeas.length > 0
      ? `ALREADY COVERED   do NOT generate ideas about the same topic or angle as any of these:
${previousIdeas.slice(0, 30).map((t) => `• ${t}`).join('\n')}`
      : ''

  const systemMessage = `You are a viral short-form content strategist specialising in health, wellness, and high-performance brands. You generate content ideas that stop the scroll, create genuine resonance, and drive action.

${buildHumanizerInstruction()}`

  const userMessage = `Generate exactly 10 short-form video content ideas for this brand, split across 5 format categories (2 ideas per category).

BRAND: ${brand.creator_name}
POSITIONING: ${positioning}
IDEAL CLIENT: ${icp}
OFFERINGS: ${offerings}
TONE: ${toneList}

${newsSection}

${dedupSection}

CATEGORIES (exactly 2 ideas each):
- educational: counterintuitive insight, mechanism reveal, or myth-bust. The viewer learns something surprising about WHY something happens.
- tips_tricks: actionable numbered list. "X things / ways / steps." Viewer gets something they can do immediately.
- personal_story: a real moment or transformation. "I used to... until..." or "A client told me..." Specific, not abstract.
- myth_busting: one belief most people have that is wrong. Name the myth clearly, then flip it.
- lead_magnet: teases a free resource (checklist, guide, template). Viewer is driven to DM or click for the freebie.

Each idea:
- One sentence: what the video is about, the specific angle
- Plain conversational language, no jargon
- Specific not generic   "why you feel wired at 10pm but exhausted at 9am" not "talk about sleep"
- No em dashes, no scripting notes, no "Hook:" labels

Where possible tie 3-5 ideas to something from the recent news above.

Respond ONLY with raw JSON, no markdown:
{
  "ideas": [
    { "format": "educational", "idea": "..." },
    { "format": "educational", "idea": "..." },
    { "format": "tips_tricks", "idea": "..." },
    { "format": "tips_tricks", "idea": "..." },
    { "format": "personal_story", "idea": "..." },
    { "format": "personal_story", "idea": "..." },
    { "format": "myth_busting", "idea": "..." },
    { "format": "myth_busting", "idea": "..." },
    { "format": "lead_magnet", "idea": "..." },
    { "format": "lead_magnet", "idea": "..." }
  ]
}`

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

  let parsed: { ideas: Array<{ format: string; idea: string } | string> }
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.ideas)) throw new Error('bad shape')
  } catch {
    return NextResponse.json({ error: 'Failed to parse generated ideas' }, { status: 500 })
  }

  // Normalise: support both old string[] and new {format, idea}[]
  const ideas = parsed.ideas.slice(0, 10).map((item) =>
    typeof item === 'string'
      ? { format: 'educational', idea: item }
      : { format: item.format ?? 'educational', idea: item.idea ?? String(item) }
  )

  return NextResponse.json({ ideas })
}
