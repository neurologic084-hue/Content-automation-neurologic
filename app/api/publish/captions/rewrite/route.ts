import { NextRequest, NextResponse } from 'next/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { PLATFORM_INSTRUCTIONS, PLATFORM_CAPS, enforceYouTubeLimits } from '@/lib/caption-platforms'
import { stripDashes } from '@/lib/humanizer'

export async function POST(req: NextRequest) {
  const { platform, currentCaption, feedback, script } = await req.json() as {
    platform: string
    currentCaption: string
    feedback: string
    script: { hook: string; body: string; cta: string }
  }

  if (!platform || !feedback?.trim()) {
    return NextResponse.json({ error: 'platform and feedback are required.' }, { status: 400 })
  }

  const key = platform.toLowerCase()
  const instructions = PLATFORM_INSTRUCTIONS[key]
  const caps = PLATFORM_CAPS[key as keyof typeof PLATFORM_CAPS]
  const maxChars = caps ? ('max' in caps ? caps.max : 200) : 200

  const scriptText = [script?.hook, script?.body, script?.cta].filter(Boolean).join('\n\n')

  const prompt = `You are a social media copywriter for a health and wellness creator who helps parents of kids with ADHD and adults dealing with nervous system dysregulation. The tone is personal, direct, and warm.

You wrote a caption for ${platform} and the creator has asked you to revise it based on their feedback. Rewrite the caption following the platform rules exactly.

ORIGINAL SCRIPT:
${scriptText}

CURRENT CAPTION:
${currentCaption}

FEEDBACK FROM CREATOR:
${feedback.trim()}

PLATFORM RULES:
${instructions ?? `Write a short, punchy caption under ${maxChars} characters. Plain text, conversational tone.`}

UNIVERSAL RULES:
- Plain text only. No markdown, no asterisks, no bold.
- No em dashes. No en dashes. Use a comma or a period instead.
- Do not label sections (no "Hook:", "CTA:", etc.).
- One CTA maximum. Sound like a real person.
${key === 'youtube' ? '- YouTube format: "TITLE | description #Shorts #tag" where TITLE is strictly under 60 characters and total is under 200 characters.' : ''}

Return ONLY the new caption text. No explanation, no intro sentence, no quotes around it.`

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.72,
      max_tokens: 350,
    })

    let caption = stripDashes(
      raw.trim()
        .replace(/^["']|["']$/g, '') // strip surrounding quotes if model added them
        .trim()
    )

    // Enforce limits
    if (key === 'youtube') {
      caption = enforceYouTubeLimits(caption)
    } else if (caption.length > maxChars) {
      caption = caption.slice(0, maxChars).replace(/\s+\S*$/, '').trimEnd()
    }

    return NextResponse.json({ caption })
  } catch (e) {
    return NextResponse.json({ error: `Rewrite failed: ${(e as Error).message}` }, { status: 500 })
  }
}
