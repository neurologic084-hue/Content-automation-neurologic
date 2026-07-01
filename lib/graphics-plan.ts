import { chatCompletion, MODELS } from './openrouter'
import type { ContentProfile } from './video-analysis'

export interface MotionGraphic {
  type: 'intro_card' | 'lower_third' | 'keyword_callout' | 'stat' | 'list' | 'outro_card'
  text: string
  startSec: number
  durationSec: number
}

// Build the profile-derived guidance block. When Gemini has actually watched the
// footage we hand the planner grounded facts (real numbers, the lines the creator
// stressed, framing, tone) instead of letting it guess from the transcript alone.
function profileGuidance(profile: ContentProfile): { block: string; maxGraphics: number | null } {
  const lines: string[] = ['', 'What the footage actually shows (ground your plan in this):']

  if (profile.hasNumbers && profile.keyNumbers.length) {
    lines.push(`- Figures actually said (use ONLY these for any "stat" graphic, verbatim-ish): ${profile.keyNumbers.join(' | ')}`)
  } else {
    lines.push('- No real figures are stated. Do NOT use any "stat" graphic — never invent a number.')
  }
  if (profile.emphasisPhrases.length) {
    lines.push(`- Lines the speaker stresses (anchor lower_third / keyword_callout graphics to these): ${profile.emphasisPhrases.join(' | ')}`)
  }
  if (profile.suggestedHookTitle) {
    lines.push(`- Suggested intro title (grounded in what is said): "${profile.suggestedHookTitle}"`)
  }
  lines.push(`- Content format is "${profile.format}": ${
    profile.format === 'list' ? 'favor a "list" graphic for the enumerated points.'
    : profile.format === 'story' ? 'keep graphics sparse and atmospheric; let the story breathe.'
    : profile.format === 'sales' ? 'a confident intro + the key offer/number carry it.'
    : 'use tasteful lower_third / keyword_callout to reinforce teaching points.'
  }`)
  if (profile.faceFraming === 'tight') {
    lines.push('- Framing is TIGHT (face fills the frame): keep graphics minimal and expect them near the edges, never a full-screen block over the face.')
  }

  // Density scales with tone: calmer/more sensitive footage gets fewer graphics.
  const maxGraphics =
    profile.sensitivity === 'medical_emotional' ? 4
    : profile.energy === 'low' ? 5
    : null // null = keep the default duration-based cap

  return { block: lines.join('\n'), maxGraphics }
}

const SYSTEM = (
  'You are a motion-graphics director for Neuro Logic, Jessica Wendling\'s med-spa clinic. ' +
  'Plan tasteful, on-brand graphics that support the words. Front-load them; do not ' +
  'clutter the middle of the video, and never imply a medical claim or guarantee.'
)

// Mirrors OVRHAUL's editing/graphics_plan.py: front-load graphics in the first
// ~60s plus 1-2 near the end. Same manifest shape renders straight into
// remotion/src/compositions/Overlay.tsx via npx remotion render.
export async function planMotionGraphics(
  words: { text: string; start: number; end: number }[],
  hook: string,
  cta: string,
  moodTag: string | null,
  scriptFormat?: string,
  profile: ContentProfile | null = null,
): Promise<MotionGraphic[]> {
  if (!words.length) return []

  const text = words.map((w) => w.text).join(' ')
  const duration = words[words.length - 1]?.end ?? 0
  const guidance = profile ? profileGuidance(profile) : { block: '', maxGraphics: null }
  const maxGraphics = guidance.maxGraphics ?? (duration > 60 ? 8 : 6)

  const prompt = `Plan motion graphics for a short-form talking-head video (~${duration.toFixed(0)}s).
Hook: ${hook || '(none)'}
CTA: ${cta || '(none)'}
Mood: ${moodTag || 'unspecified'}
Format: ${scriptFormat || 'unspecified'}
${guidance.block}

Rules:
- Always start with an intro_card at startSec 0, durationSec 3. It overlays the footage (which is already playing) rather than blocking it - the card itself handles staying brief and out of the way, so just plan it like any other graphic.
- Add 2-4 lower_third, keyword_callout, stat, or list graphics in the first half, anchored to key phrases actually said in the transcript below.
- A "stat" graphic's text should lead with a short number or percentage, e.g. "3x Faster" or "98% Return Clients" (only use figures implied by the script - never invent a clinical statistic).
- A "list" graphic's text must be 2-3 short items separated by " | ", e.g. "No downtime | Numbing cream included | Results in days".
- Always end with an outro_card at startSec ${Math.max(duration - 3, duration * 0.88).toFixed(1)}, durationSec 3, using the CTA.
- Hard cap: ${maxGraphics} graphics total. Do not add graphics in the middle third.
- Keep text short: 4-8 words per graphic (list items can be shorter).
- Warm, premium, minimal tone - never em dashes, en dashes, or double-hyphens.

TRANSCRIPT: ${text.slice(0, 1600)}

Return ONLY valid JSON, no markdown:
{"graphics": [{"type": "intro_card", "text": "...", "startSec": 0, "durationSec": 3}, {"type": "keyword_callout", "text": "...", "startSec": 5, "durationSec": 3}]}`

  try {
    const raw = await chatCompletion({
      model: MODELS.script,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      json: true,
      max_tokens: 1200,
    })
    const data = JSON.parse(raw) as { graphics?: MotionGraphic[] }
    return (data.graphics ?? []).map((g) => {
      // IntroCard/OutroCard handle staying out of the way internally (quick
      // shrink-to-header / footage-stays-visible), but still clamp duration
      // so a misbehaving response can't park one on screen indefinitely.
      if (g.type === 'intro_card') return { ...g, durationSec: Math.min(Math.max(g.durationSec, 2.5), 3.5) }
      if (g.type === 'outro_card') return { ...g, durationSec: Math.min(Math.max(g.durationSec, 2), 3.5) }
      return g
    })
  } catch (e) {
    console.warn('[graphics-plan] planning failed, skipping motion graphics:', (e as Error).message)
    return []
  }
}
