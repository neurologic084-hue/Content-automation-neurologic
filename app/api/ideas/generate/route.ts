import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { buildHumanizerInstruction } from '@/lib/humanizer'
import { searchNicheNews } from '@/lib/tavily'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const avoidIdeas: Array<{ format: string; idea: string }> = body.avoid ?? []

  const supabase = await createClient()

  const { data: brand } = await supabase.from('brand_settings').select('*').eq('is_active', true).single()
  if (!brand) return NextResponse.json({ error: 'Brand settings not configured' }, { status: 400 })

  const toneList = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const icp = brand.audience_description || ''
  const positioning = brand.unique_angle || ''
  const offerings = brand.offerings || ''
  const background = brand.extra_context || ''
  const tagline = brand.tagline || ''
  const transformation = brand.audience_transformation || ''
  const socialProof = brand.social_proof || ''
  const contentPillars = brand.content_pillars || ''

  // Run news search + previous ideas fetch in parallel
  const nicheQuery = [
    positioning,
    offerings,
    icp,
  ].filter(Boolean).join(' ').slice(0, 300)

  const [newsItems, previousIdeasRes, approvedScriptsRes] = await Promise.allSettled([
    searchNicheNews(nicheQuery),
    supabase
      .from('ideas')
      .select('raw_idea')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('scripts')
      .select('hook, filming_plan, idea:ideas(raw_idea)')
      .eq('status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(15),
  ])

  const news = newsItems.status === 'fulfilled' ? newsItems.value : []
  const previousIdeas =
    previousIdeasRes.status === 'fulfilled'
      ? (previousIdeasRes.value.data ?? []).map((i: { raw_idea: string }) => i.raw_idea)
      : []

  type ApprovedScriptRow = { hook: string; filming_plan: { script_format?: string } | null; idea: { raw_idea: string } | { raw_idea: string }[] | null }
  const approvedScripts =
    approvedScriptsRes.status === 'fulfilled'
      ? (approvedScriptsRes.value.data ?? []) as ApprovedScriptRow[]
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

  const patternSection =
    approvedScripts.length > 0
      ? `WHAT THIS CREATOR HAS APPROVED BEFORE   study for pattern only, do NOT copy or rephrase any of these:
${approvedScripts
  .map((s) => {
    const ideaRow = Array.isArray(s.idea) ? s.idea[0] : s.idea
    const fmt = s.filming_plan?.script_format ?? ''
    return `• [${fmt || 'unknown'}] ${ideaRow?.raw_idea ?? s.hook}`
  })
  .join('\n')}

Use the list above only to notice patterns: which formats they keep approving, which angles, which level of specificity, what kind of hook lands for them. The new ideas below must be on entirely different topics   never repeat or lightly reword anything in this list.`
      : ''

  const avoidSection =
    avoidIdeas.length > 0
      ? `JUST SHOWN   these 10 ideas were just shown to the user and they clicked Regenerate. You MUST produce completely different ideas. Different topics, different angles, different formats where possible. Do NOT reuse any of these in any form:
${avoidIdeas.map((i) => `• [${i.format}] ${i.idea}`).join('\n')}

Think of new topics entirely. Approach the brand from a different angle than everything above.`
      : ''

  const systemMessage = `You are a viral short-form content strategist specialising in health, wellness, and high-performance brands. You generate content ideas that stop the scroll, create genuine resonance, and drive action.

${buildHumanizerInstruction()}`

  const brandBlock = [
    `CREATOR: ${brand.creator_name}${tagline ? `, ${tagline}` : ''}`,
    positioning ? `POSITIONING: ${positioning}` : '',
    background ? `BACKGROUND: ${background}` : '',
    icp ? `IDEAL CLIENT: ${icp}` : '',
    transformation ? `TRANSFORMATION THEY DELIVER: ${transformation}` : '',
    offerings ? `OFFERINGS: ${offerings}` : '',
    toneList ? `TONE: ${toneList}` : '',
    contentPillars ? `CONTENT PILLARS: ${contentPillars}` : '',
    socialProof ? `SOCIAL PROOF (use sparingly, only where it fits naturally): ${socialProof}` : '',
  ].filter(Boolean).join('\n')

  const userMessage = `Generate exactly 10 short-form video content ideas for this brand, split across 5 format categories (2 ideas per category).

${brandBlock}

${newsSection}

${patternSection}

${dedupSection}

${avoidSection}

CATEGORIES (exactly 2 ideas each):
- educational: counterintuitive insight, mechanism reveal, or myth-bust. The viewer learns something surprising about WHY something happens.
- tips_tricks: actionable numbered list. "X things / ways / steps." Viewer gets something they can do immediately.
- personal_story: a real moment or transformation. "I used to... until..." or "A client told me..." Specific, not abstract.
- myth_busting: one belief most people have that is wrong. Name the myth clearly, then flip it.
- lead_magnet: teases a free resource (checklist, guide, template). Viewer is driven to DM or click for the freebie.

IMPORTANT RULES:
- Draw on the full brand context above to make ideas feel specific to this creator, not generic
- Learn from the approved-before list only as a pattern signal (format, angle, specificity). Never repeat, rephrase, or lightly remix any idea from that list. Every idea below must be a genuinely new topic.
- Social proof and client results should only appear in ideas where it flows naturally (personal_story, occasionally tips_tricks). Never force it into educational or myth_busting
- Each idea is one sentence: what the video is about and the specific angle
- Plain conversational language, no jargon
- Specific not generic. "why you feel wired at 10pm but exhausted at 9am" not "talk about sleep"
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
