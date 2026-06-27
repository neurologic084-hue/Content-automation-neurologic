// Shared caption platform config used by both generate and rewrite routes

export const PLATFORM_CAPS = {
  instagram: { visible: 125, max: 280 },
  facebook:  { visible: 150, max: 300 },
  tiktok:    { visible: 100, max: 140 },
  youtube:   { titleMax: 60, max: 200 },
} as const

export type PlatformKey = keyof typeof PLATFORM_CAPS

export const PLATFORM_INSTRUCTIONS: Record<string, string> = {
  instagram: `INSTAGRAM REELS
Purpose: complement the video, not describe it. Drive saves and shares.
The video already carries the content -- the caption's job is emotional resonance and action.

Format:
- Line 1 (hook): A curiosity gap, relatable observation, or contrarian take. Must land in under 125 characters. Do NOT summarize the video. Do NOT start with "I" or the creator's name.
- Lines 2-3 (optional): One sentence of context, perspective, or a question that deepens the hook. Skip if the hook stands alone.
- Final line: Exactly one of: "Save this." or "Share this with someone who needs it." or "Follow for more on this."
- NO hashtags.

Tone: Conversational. Like a message to a friend who would genuinely benefit.
Avoid: Describing what happens in the video. "In this video..." "Watch as..." "I show you..."
Emojis: 1-2 max, only if they genuinely fit.`,

  tiktok: `TIKTOK
Purpose: stop the scroll and invite participation. The video does the heavy lifting.

Format:
- One punchy sentence OR two very short lines. Total under 140 characters.
- Choose one framing: POV ("POV: you've been doing this wrong"), curiosity gap ("nobody talks about this but"), problem amplification (name a specific frustration precisely), or participation hook ("which one are you?").
- Do NOT write a summary of the video.
- NO hashtags.

Tone: Casual, direct, like texting. Match the energy of the video.
Emojis: 1-3, used like punctuation.`,

  facebook: `FACEBOOK REELS
Purpose: watch time, community engagement, and shares. 85% of Facebook video is watched without sound.

Format:
- Line 1: A relatable opener or observation that makes the viewer feel seen. Under 125 characters.
- Lines 2-3: 1-2 sentences of context or perspective that reinforces, not repeats, the video.
- Final line: "Share this with someone who needs to hear this." or "Save this for when you need it."
- NO hashtags.

Tone: Warm, accessible, genuine. A bit more personal than Instagram.
Avoid: Anything that sounds like an ad. Describing the video. Corporate language.
Emojis: 1-2 max.`,

  youtube: `YOUTUBE SHORTS
Purpose: search discovery and click-through. The title is the primary lever.

Format -- CRITICAL:
- TITLE (before the pipe |): keyword-rich, states the core benefit or insight clearly. STRICT MAX 60 characters including spaces. No clickbait -- be accurate. Count every character.
- DESCRIPTION (after the pipe |): 1-2 short sentences of context or CTA. Under 140 characters. NO hashtags.
- Separate title and description with exactly one pipe character: |
- Total length including title, pipe, and description: STRICT MAX 200 characters.

Example format: "Why your nervous system shuts down when overwhelmed | Most people fight it. Work with it instead."

Tone: Educational, clear. Benefit-focused.
No emojis in the title. One emoji max in description.`,
}

/**
 * Enforce YouTube's strict limits post-generation.
 * Input format: "TITLE | description"
 * Returns a caption where title <= 60 chars and total <= 200 chars.
 */
export function enforceYouTubeLimits(caption: string): string {
  const pipeIdx = caption.indexOf('|')

  let title: string
  let description: string

  if (pipeIdx >= 0) {
    title = caption.slice(0, pipeIdx).trim()
    description = caption.slice(pipeIdx + 1).trim()
  } else {
    title = caption.trim()
    description = ''
  }

  // Truncate title at word boundary if over 60
  if (title.length > 60) {
    title = title.slice(0, 60).replace(/\s+\S*$/, '').trim()
  }

  // Rebuild and check total
  const sep = description ? ' | ' : ''
  let result = `${title}${sep}${description}`.trim()

  // If still over 200, trim description at word boundary
  if (result.length > 200) {
    const budget = 200 - title.length - 3 // 3 = " | "
    description = description.slice(0, Math.max(0, budget)).replace(/\s+\S*$/, '').trim()
    result = description ? `${title} | ${description}` : title
  }

  return result
}
