import { NextRequest, NextResponse } from 'next/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { PLATFORM_INSTRUCTIONS, PLATFORM_CAPS, enforceYouTubeLimits } from '@/lib/caption-platforms'

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

  const platformBlocks = platforms.map(p => {
    const key = p.toLowerCase()
    const instructions = PLATFORM_INSTRUCTIONS[key]
    const caps = PLATFORM_CAPS[key as keyof typeof PLATFORM_CAPS]
    const maxChars = caps ? ('max' in caps ? caps.max : 200) : 200
    if (!instructions) {
      return `Platform "${p}": Write a short, punchy caption under ${maxChars} characters. Plain text, conversational tone.`
    }
    return instructions
  }).join('\n\n---\n\n')

  const prompt = `You are a social media copywriter for a health and wellness creator who helps parents of kids with ADHD and adults dealing with nervous system dysregulation. The tone is personal, direct, and warm -- never clinical, never corporate.

The video script is below. Write one caption per platform. The video already shows the content -- your captions should complement it, not describe it.

SCRIPT:
${script}

PLATFORM INSTRUCTIONS:
${platformBlocks}

UNIVERSAL RULES:
- Plain text. No markdown, no asterisks, no bold.
- No em dashes. No en dashes. Use a comma or a period instead.
- Do not label sections (no "Hook:", "CTA:", etc.).
- Do not summarize or describe the video. The viewer is watching it.
- One clear CTA maximum per caption. Never more than one.
- Sound like a real person, not an AI assistant.

For YouTube, the JSON value must be: "TITLE | description #Shorts #tag" where TITLE is strictly under 60 characters.

Return ONLY a JSON object. Keys are the platform names exactly as given. No markdown, no extra text.
Example: {"instagram":"caption here","tiktok":"caption here"}`

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 800,
      json: true,
    })

    const captions = JSON.parse(raw) as Record<string, string>

    // Enforce limits per platform
    for (const p of platforms) {
      const key = p.toLowerCase()
      if (!captions[p]) continue

      if (key === 'youtube') {
        captions[p] = enforceYouTubeLimits(captions[p])
      } else {
        const caps = PLATFORM_CAPS[key as keyof typeof PLATFORM_CAPS]
        const maxChars = caps && 'max' in caps ? caps.max : 300
        if (captions[p].length > maxChars) {
          captions[p] = captions[p].slice(0, maxChars).replace(/\s+\S*$/, '').trimEnd()
        }
      }
    }

    return NextResponse.json({ captions })
  } catch (e) {
    return NextResponse.json({ error: `Caption generation failed: ${(e as Error).message}` }, { status: 500 })
  }
}
