import { NextRequest, NextResponse } from 'next/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'

// Hard character caps enforced both in the prompt and post-generation
const PLATFORM_CAPS: Record<string, number> = {
  instagram: 280,  // stays fully visible before "see more"
  facebook:  450,
  tiktok:    140,
  youtube:   100,
}

const PLATFORM_HASHTAG_RULE: Record<string, string> = {
  instagram: 'No hashtags.',
  facebook:  'No hashtags.',
  tiktok:    'No hashtags.',
  youtube:   'No hashtags.',
}

export async function POST(req: NextRequest) {
  const { hook, body, cta, platforms } = await req.json() as {
    hook: string
    body: string
    cta: string
    platforms: string[]
  }

  if (!platforms?.length) {
    return NextResponse.json({ error: 'No platforms specified.' }, { status: 400 })
  }

  const script = [hook, body, cta].filter(Boolean).join('\n\n')

  const platformSpecs = platforms.map(p => {
    const cap = PLATFORM_CAPS[p.toLowerCase()] ?? 200
    const hashtags = PLATFORM_HASHTAG_RULE[p.toLowerCase()] ?? 'No hashtags.'
    return `  "${p}": strict max ${cap} characters. ${hashtags}`
  }).join('\n')

  const prompt = `You are a social media copywriter. Write platform-specific captions from the script below.

SCRIPT:
${script}

RULES   apply to every caption:
- No emojis. None at all.
- No hashtags on any platform.
- No markdown formatting (no asterisks, no bold, no bullet points).
- Plain text only.
- Structure every caption in this order:
    1. HOOK   one punchy opening sentence that stops the scroll
    2. PROBLEM/SOLUTION or INSIGHT   1 to 2 sentences of value, proof, or context
    3. CALL TO ACTION   one clear, direct closing line
- Do not label the sections. Write it as flowing copy.

PLATFORM LIMITS (you must not exceed these   count every character including spaces and hashtags):
${platformSpecs}

Return ONLY a JSON object. Keys are the platform names exactly as given. No markdown, no extra text.
Example: {"instagram":"caption here","facebook":"caption here"}`

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.65,
      max_tokens: 600,
      json: true,
    })

    const captions = JSON.parse(raw) as Record<string, string>

    // Hard-truncate at cap as a safety net (shouldn't be needed, but guarantees it)
    for (const p of platforms) {
      const cap = PLATFORM_CAPS[p.toLowerCase()]
      if (cap && captions[p] && captions[p].length > cap) {
        // Truncate at the last space before the cap to avoid cutting mid-word
        captions[p] = captions[p].slice(0, cap).replace(/\s+\S*$/, '').trimEnd()
      }
    }

    return NextResponse.json({ captions })
  } catch (e) {
    return NextResponse.json({ error: `Caption generation failed: ${(e as Error).message}` }, { status: 500 })
  }
}
