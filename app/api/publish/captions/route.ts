import { NextRequest, NextResponse } from 'next/server'
import { chatCompletion, MODELS } from '@/lib/openrouter'
import { PLATFORM_INSTRUCTIONS, PLATFORM_CAPS, enforceYouTubeLimits } from '@/lib/caption-platforms'
import { parseJsonLoose } from '@/lib/json-loose'
import { stripDashesDeep, buildHumanizerInstruction } from '@/lib/humanizer'

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
- Do not label sections (no "Hook:", "CTA:", etc.).
- Do not summarize or describe the video. The viewer is watching it.
- One clear CTA maximum per caption. Never more than one.
- Sound like a real person, not an AI assistant.

${buildHumanizerInstruction()}

For YouTube, the JSON value must be: "TITLE | description" where TITLE is strictly under 60 characters. No hashtags.

Return ONLY a JSON object. Keys are the platform names exactly as given. No markdown, no extra text.
Example: {"instagram":"caption here","tiktok":"caption here"}`

  // The model is asked to use exact platform-name keys, but occasionally drifts on
  // casing (e.g. "Instagram" instead of "instagram") and silently drops a platform.
  // Normalize keys case-insensitively, and retry automatically if any are still missing
  // instead of making the user click "Generate" repeatedly.
  const maxAttempts = 3
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = await chatCompletion({
        model: MODELS.fast,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
        json: true,
      })

      const rawCaptions = stripDashesDeep(parseJsonLoose<Record<string, string>>(raw))
      const lowerCased = Object.fromEntries(
        Object.entries(rawCaptions).map(([k, v]) => [k.toLowerCase().trim(), v])
      )

      const captions: Record<string, string> = {}
      for (const p of platforms) {
        const key = p.toLowerCase()
        if (key in lowerCased) {
          // Key matched exactly. An empty value is a content problem, not a key
          // problem, fuzzy-matching another key wouldn't fix it, so leave it missing.
          if (lowerCased[key].trim()) captions[p] = lowerCased[key]
          continue
        }
        // Defensive fallback: the model occasionally returns a variant key
        // (e.g. "youtube_shorts" instead of "youtube"). Match on substring/normalized form.
        const normalized = key.replace(/[^a-z]/g, '')
        const fuzzyKey = Object.keys(lowerCased).find((k) => {
          const kNorm = k.replace(/[^a-z]/g, '')
          return kNorm.includes(normalized) || normalized.includes(kNorm)
        })
        if (fuzzyKey && lowerCased[fuzzyKey].trim()) captions[p] = lowerCased[fuzzyKey]
      }

      const missing = platforms.filter(p => !captions[p])
      if (missing.length > 0) {
        lastError = `Model omitted: ${missing.join(', ')}`
        if (attempt < maxAttempts) continue
        // Final attempt still missing platforms   fail loudly instead of
        // silently returning 200 with an incomplete captions object.
        return NextResponse.json({ error: `Caption generation failed: ${lastError}` }, { status: 500 })
      }

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
      lastError = (e as Error).message
      if (attempt < maxAttempts) continue
    }
  }

  return NextResponse.json({ error: `Caption generation failed: ${lastError}` }, { status: 500 })
}
