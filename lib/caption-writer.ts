// One place that writes (and rewrites) social captions, so Generate and Rewrite
// behave identically: her brand voice and rules, the plain-language rules the
// scripts follow, the humanizer (checked, not just requested), and exact
// per-platform limits met by asking the model again, never by cutting a
// sentence in half.

import type { SupabaseClient } from '@supabase/supabase-js'
import { chatCompletion, MODELS } from './openrouter'
import { PLATFORM_INSTRUCTIONS, PLATFORM_CAPS, enforceYouTubeLimits } from './caption-platforms'
import { parseJsonLoose } from './json-loose'
import { stripDashes, stripDashesDeep, buildHumanizerInstruction, findBannedPhrases } from './humanizer'
import { buildPlainLanguageRules, buildBrandHardRules } from './prompts'
import type { BrandSettings } from './types'

export type CaptionScript = { hook: string; body: string; cta: string }

export function captionLimit(platform: string): number {
  const caps = PLATFORM_CAPS[platform.toLowerCase() as keyof typeof PLATFORM_CAPS]
  return caps && 'max' in caps ? caps.max : 200
}

export async function getActiveBrand(db: SupabaseClient): Promise<BrandSettings | null> {
  const { data } = await db.from('brand_settings').select('*').eq('is_active', true).limit(1).maybeSingle()
  return (data as BrandSettings | null) ?? null
}

// ── fitting ──────────────────────────────────────────────────────────────────

// A last-resort fit that keeps the opening line and the closing call to action
// and drops whole sentences from the middle. The old behaviour sliced at the
// limit, which shipped captions that stopped mid-sentence and lost the CTA.
export function fitCaption(platform: string, text: string): string {
  const key = platform.toLowerCase()
  const clean = text.replace(/\r/g, '').trim()
  if (key === 'youtube') return enforceYouTubeLimits(clean)
  const max = captionLimit(key)
  if (clean.length <= max) return clean

  const units: { text: string; block: number }[] = []
  clean.split(/\n{2,}/).forEach((block, bi) => {
    const parts = block.match(/[^.!?\n]+[.!?]+["')]*|[^.!?\n]+$/g) ?? [block]
    for (const p of parts) if (p.trim()) units.push({ text: p.trim(), block: bi })
  })
  const join = (u: typeof units) =>
    u.reduce((acc, cur, i) => (i === 0 ? cur.text : acc + (cur.block === u[i - 1].block ? ' ' : '\n\n') + cur.text), '')

  const hook = units[0]
  const closer = units.length > 2 && units[units.length - 1].text.length <= 90 ? units[units.length - 1] : null
  const keep = new Set<(typeof units)[number]>([hook, ...(closer ? [closer] : [])])
  const ordered = () => units.filter(u => keep.has(u))
  for (const u of units.slice(1, closer ? -1 : undefined)) {
    keep.add(u)
    if (join(ordered()).length > max) keep.delete(u)
  }
  const fitted = join(ordered())
  if (fitted.length <= max) return fitted
  // Even hook + closer is too long: keep the hook, ended cleanly at a word.
  const cut = hook.text.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '')
  return /[.!?]$/.test(cut) ? cut : `${cut}.`
}

// ── prompt ───────────────────────────────────────────────────────────────────

function brandBlock(brand: BrandSettings | null): string {
  if (!brand) {
    return 'You write social captions for a health and wellness creator. The tone is personal, direct, and warm, never clinical, never corporate.'
  }
  const bits = [
    `You write social captions in the voice of ${brand.creator_name}${brand.location ? `, based in ${brand.location}` : ''}.`,
    brand.tagline?.trim() && `Their line: ${brand.tagline.trim()}`,
    brand.tone_keywords?.length && `Tone: ${brand.tone_keywords.join(', ')}.`,
    brand.audience_description?.trim() && `Who is watching: ${brand.audience_description.trim().slice(0, 500)}`,
    brand.audience_transformation?.trim() && `What they want to change: ${brand.audience_transformation.trim().slice(0, 300)}`,
  ].filter(Boolean)
  return bits.join('\n')
}

function limitsTable(platforms: string[]): string {
  return platforms.map(p => {
    const k = p.toLowerCase()
    const caps = PLATFORM_CAPS[k as keyof typeof PLATFORM_CAPS]
    const extra = caps && 'visible' in caps ? ` (the first ${caps.visible} characters are what shows before "more")` : ''
    return `- ${k}: at most ${captionLimit(k)} characters in total, counting every character and line break${extra}`
  }).join('\n')
}

function platformBlocks(platforms: string[]): string {
  return platforms.map(p => {
    const key = p.toLowerCase()
    return PLATFORM_INSTRUCTIONS[key] ?? `Platform "${p}": a short, punchy caption under ${captionLimit(key)} characters. Plain text, conversational tone.`
  }).join('\n\n---\n\n')
}

function systemRules(brand: BrandSettings | null): string {
  const hard = brand ? buildBrandHardRules(brand) : ''
  return [
    brandBlock(brand),
    hard,
    buildPlainLanguageRules(brand ?? undefined),
    buildHumanizerInstruction(),
  ].filter(Boolean).join('\n\n')
}

const UNIVERSAL = `UNIVERSAL RULES:
- Plain text. No markdown, no asterisks, no bold, no hashtags.
- Do not label sections (no "Hook:", "CTA:").
- The video already shows the content. Do not summarize or describe it; add what the viewer takes away from it.
- Exactly one call to action per caption, never more.
- Sound like a person talking to a friend, not like an AI assistant or a brand.`

// ── generation ───────────────────────────────────────────────────────────────

function matchPlatforms(platforms: string[], raw: Record<string, unknown>): Record<string, string> {
  const lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase().trim(), typeof v === 'string' ? v : '']))
  const out: Record<string, string> = {}
  for (const p of platforms) {
    const key = p.toLowerCase()
    if (key in lower) { if (lower[key].trim()) out[p] = lower[key]; continue }
    // The model sometimes returns a variant key ("youtube_shorts" for "youtube").
    const norm = key.replace(/[^a-z]/g, '')
    const fuzzy = Object.keys(lower).find(k => { const n = k.replace(/[^a-z]/g, ''); return n.includes(norm) || norm.includes(n) })
    if (fuzzy && lower[fuzzy].trim()) out[p] = lower[fuzzy]
  }
  return out
}

function problemsFor(platform: string, text: string): string[] {
  const out: string[] = []
  const key = platform.toLowerCase()
  const max = captionLimit(key)
  if (key === 'youtube') {
    const title = text.split('|')[0].trim()
    if (title.length > 60) out.push(`the title is ${title.length} characters, it must be 60 or fewer`)
  }
  if (text.length > max) out.push(`it is ${text.length} characters, ${text.length - max} over the ${max} limit`)
  const banned = findBannedPhrases(text)
  if (banned.length) out.push(`it uses banned words: ${banned.join(', ')}`)
  return out
}

export async function writeCaptions(opts: { script: CaptionScript; platforms: string[]; brand: BrandSettings | null }): Promise<Record<string, string>> {
  const { script, platforms, brand } = opts
  const scriptText = [script.hook, script.body, script.cta].filter(Boolean).join('\n\n')
  const prompt = `${systemRules(brand)}

THE VIDEO SCRIPT:
${scriptText}

PLATFORMS TO WRITE FOR:
${platformBlocks(platforms)}

HARD LIMITS (a caption over its limit is rejected):
${limitsTable(platforms)}

${UNIVERSAL}
For YouTube the value must be "TITLE | description" with the title at most 60 characters.

Return ONLY a JSON object. Keys are the platform names exactly as given: ${platforms.map(p => `"${p.toLowerCase()}"`).join(', ')}.`

  let captions: Record<string, string> = {}
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletion({
      model: MODELS.script, // Sonnet: captions are what the audience reads first, and the call is tiny
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1200,
      json: true,
    })
    captions = matchPlatforms(platforms, stripDashesDeep(parseJsonLoose<Record<string, unknown>>(raw)))
    if (platforms.every(p => captions[p])) break
    if (attempt === 2) throw new Error(`Model omitted: ${platforms.filter(p => !captions[p]).join(', ')}`)
  }

  // One targeted repair for anything over its limit or using banned words.
  const broken = platforms.map(p => ({ p, issues: problemsFor(p, captions[p]) })).filter(x => x.issues.length)
  if (broken.length) {
    try {
      const fixPrompt = `${systemRules(brand)}

Fix these captions. Change only what is needed to fix the listed problem. Keep the opening line, keep the single call to action at the end, and finish on a complete sentence.

${broken.map(b => `${b.p.toLowerCase()} (limit ${captionLimit(b.p)} characters):\n${captions[b.p]}\nPROBLEM: ${b.issues.join('; ')}`).join('\n\n')}

${UNIVERSAL}
Return ONLY a JSON object with the keys ${broken.map(b => `"${b.p.toLowerCase()}"`).join(', ')} and the corrected captions as values.`
      const fixedRaw = await chatCompletion({ model: MODELS.script, messages: [{ role: 'user', content: fixPrompt }], temperature: 0.3, max_tokens: 900, json: true })
      const fixed = matchPlatforms(broken.map(b => b.p), stripDashesDeep(parseJsonLoose<Record<string, unknown>>(fixedRaw)))
      for (const b of broken) if (fixed[b.p]) captions[b.p] = fixed[b.p]
    } catch (e) {
      console.warn('[captions] repair pass failed, fitting locally instead:', (e as Error).message)
    }
  }

  for (const p of platforms) captions[p] = fitCaption(p, stripDashes(captions[p]))
  return captions
}

export async function rewriteCaption(opts: {
  platform: string
  currentCaption: string
  feedback: string
  script: Partial<CaptionScript>
  brand: BrandSettings | null
}): Promise<string> {
  const { platform, currentCaption, feedback, script, brand } = opts
  const scriptText = [script.hook, script.body, script.cta].filter(Boolean).join('\n\n')
  const prompt = `${systemRules(brand)}

You wrote a caption for ${platform} and the creator wants it changed. Rewrite it so it does what they ask, while following the platform rules exactly.

THE VIDEO SCRIPT:
${scriptText}

CURRENT CAPTION:
${currentCaption}

WHAT THE CREATOR WANTS CHANGED (this comes first, ahead of everything else except the hard limit):
${feedback.trim()}

The current caption is ${currentCaption.trim().length} characters. Do what was asked literally: if they want it shorter, the new caption must be clearly shorter than that; if they want it longer or fuller, longer (inside the limit); if they name an angle or a word to lead with, open with it.

PLATFORM RULES:
${platformBlocks([platform])}

HARD LIMIT: at most ${captionLimit(platform)} characters in total.

${UNIVERSAL}
${platform.toLowerCase() === 'youtube' ? 'Format: "TITLE | description" with the title at most 60 characters.' : ''}

Return ONLY the new caption text. No explanation, no quotes around it.`

  let caption = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await chatCompletion({ model: MODELS.script, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 500 })
    caption = stripDashes(raw.trim().replace(/^["']|["']$/g, '').trim())
    if (caption && problemsFor(platform, caption).length === 0) break
  }
  return fitCaption(platform, caption)
}
