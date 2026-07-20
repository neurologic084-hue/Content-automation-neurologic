// ── B-roll for the Remotion-only edit (v6) ────────────────────────────────────
// Plans WHERE cutaways belong (LLM over the edited transcript, hard-validated),
// then sources real media:
//
//   1. Pexels (videos + photos)  — used when PEXELS_API_KEY is set. Free key,
//      no attribution required, the same library Submagic pulls from.
//   2. Openverse (CC0 images)    — keyless fallback so B-roll always works.
//      cc0/pdm licenses only, so no attribution obligations sneak in.
//
// Coverage is either SMART (adaptive cadence from the Gemini profile's read of
// the footage, damped on sensitive content) or MANUAL (the studio's 0-50%
// slider, converted to a cutaway count), and follows the reference video's
// grammar: photo CARDS floating over the footage for most items, at most one
// full-screen cover (the viral flavor runs all covers).

import fs from 'fs'
import path from 'path'
import { chatCompletion, MODELS } from './openrouter'
import { parseJsonLoose } from './json-loose'
import type { ContentProfile } from './video-analysis'
import type { CaptionPage, EditedWord } from './edit-plan'
import type { TransitionStyle } from './sound-effects'

export interface BrollItem {
  start: number      // edited-timeline seconds
  duration: number
  file: string       // filename relative to remotion/public/
  kind: 'video' | 'image'
  // split: footage slides to the top ~55%, media fills the bottom, captions
  // ride the seam. panel: translucent rounded panel over the speaker. Both
  // are assigned pipeline-side (eubank layout rotation) — the planner itself
  // only emits card/cover.
  layout: 'card' | 'cover' | 'split' | 'panel'
  // Seconds into the source clip to start playing from (video kind only).
  // Lets a long creator clip yield different cuts: a 10s clip can fill one
  // slot with 0-2.5s and a later slot with its tail, instead of repeating
  // the same opening seconds.
  srcOffset?: number
  // Per-cover transition override (eubank combo rotation): each cover carries
  // its own move instead of the render's single global style.
  transition?: TransitionStyle
  // panel: which edge it slides in from.
  from?: 'left' | 'right' | 'top'
  // panel carousel (the reference's "bunch of B-roll" moment): 1-2 extra
  // stills rendered as additional translucent panels around the main media.
  extraFiles?: string[]
  // The stock query that resolved this item — kept so downstream treatments
  // (carousel extras) can fetch more media for the same moment.
  query?: string
  // Viral (v5) designed cover: instead of raw footage, the renderer builds an
  // animated editorial poster around this media — warm gradient canvas, the
  // image in a floating mask, and this text as the card's own headline.
  // Palette rotates per card so two posters in one video read differently.
  // file may be '' for a designed card: the poster renders typography-only.
  design?: { kicker: string; headline: string; palette?: 'champagne' | 'dusk' | 'blush' }
  // Collage scene (v7 test): AI-generated transparent cutouts springing in
  // over a dark editorial canvas, Vox-style. Carries its own type, so caption
  // pages under it are dropped (like the designed card). file stays '' — the
  // scene draws its own background. See lib/collage-scenes.ts.
  collage?: CollagePayload
}

// The render payload for one collage scene. Cutout files are transparent PNGs
// (chroma-keyed pipeline-side); the halftone/red-stroke print treatment is
// applied in-render so it stays tweakable without regenerating images.
export interface CollagePayload {
  kicker?: string      // small connector lead-in, spoken words ("It's the")
  headline?: string    // 2-4 word serif payoff, spoken words
  stat?: string        // optional big number as spoken ("$36 trillion")
  cutouts: Array<{ file: string; size: 'hero' | 'support' }>
}

interface PlannedSlot {
  start: number
  duration: number
  query: string
  layout: 'card' | 'cover'
  design?: { kicker: string; headline: string; palette?: 'champagne' | 'dusk' | 'blush' }
}

// 'none' = the variant carries no stock footage at all (Koe: graphics only).
export type BrollFlavor = 'image' | 'video' | 'mixed' | 'viral' | 'none'

// ── B-roll amount (user-facing knob, video studio) ───────────────────────────
// Picked once per job, applies to the Remotion variants (v4/v5/v6):
//   smart  — the pipeline decides coverage from the footage (Gemini profile:
//            richness drives cadence, sensitivity damps it)
//   manual — the user's slider percent (0-50) decides coverage directly
//   none   — no B-roll at all (stock OR custom), pure talking head
// Stored per-variant in the job's variants jsonb (like grade_mode), so it
// needs no schema migration.
export type BrollMode = 'smart' | 'manual' | 'none'

// WHERE cutaways come from, chosen per job alongside the amount. Only matters
// once the creator has supplied her own clips — before that everything is
// stock by definition.
//   both   — her clips first, stock fills whatever the target still wants
//   custom — her clips only; no stock, even if that means fewer cutaways
//   stock  — ignore her folder for this render and use stock only
// Previously supplying a folder silently forced 'custom', with no way back.
export type BrollSource = 'both' | 'custom' | 'stock'
export const BROLL_SOURCES: BrollSource[] = ['both', 'custom', 'stock']

export function normalizeBrollSource(raw: unknown): BrollSource {
  return BROLL_SOURCES.includes(raw as BrollSource) ? (raw as BrollSource) : 'both'
}
export const BROLL_MODES: BrollMode[] = ['smart', 'manual', 'none']
export const MAX_BROLL_PERCENT = 50

export interface BrollSetting {
  mode: BrollMode
  // Coverage percent for 'manual' (0-50, integer); null for smart/none.
  percent: number | null
}

// Untrusted input (request body / jsonb) → a safe setting. Manual without a
// usable number degrades to smart rather than guessing an amount.
export function normalizeBrollSetting(mode: unknown, percent: unknown): BrollSetting {
  const m: BrollMode = BROLL_MODES.includes(mode as BrollMode) ? (mode as BrollMode) : 'smart'
  if (m !== 'manual') return { mode: m, percent: null }
  const p = typeof percent === 'number' && Number.isFinite(percent)
    ? percent
    : typeof percent === 'string' && percent.trim() !== '' && Number.isFinite(Number(percent))
      ? Number(percent)
      : null
  if (p === null) return { mode: 'smart', percent: null }
  return { mode: 'manual', percent: Math.round(Math.min(MAX_BROLL_PERCENT, Math.max(0, p))) }
}

// Applies the job's B-roll setting to a Submagic submission. 'smart' keeps the
// caller's footage-adaptive knobs, 'manual' forces the exact percent (Submagic
// rejects 50+, so it caps at 49; 0 turns B-roll off), 'none' turns it off.
// One decision, used by every Submagic call site — keep them identical.
export function submagicBrollKnobs(
  setting: BrollSetting,
  adaptive: { magicBrolls: boolean; magicBrollsPercentage?: number },
): { magicBrolls: boolean; magicBrollsPercentage?: number } {
  if (setting.mode === 'none') return { magicBrolls: false, magicBrollsPercentage: undefined }
  if (setting.mode === 'manual') {
    const on = (setting.percent ?? 0) > 0
    return { magicBrolls: on, magicBrollsPercentage: on ? Math.min(setting.percent!, 49) : undefined }
  }
  return {
    magicBrolls: adaptive.magicBrolls,
    magicBrollsPercentage: adaptive.magicBrolls ? adaptive.magicBrollsPercentage : undefined,
  }
}

// Average planned cutaway length: covers run 2.0-3.8s, the gap-filler uses
// 2.6s — used to convert a coverage percent into a cutaway count.
const AVG_CUT_SECONDS = 2.8

// A coverage percent becomes a cutaway count: percent of the timeline under
// B-roll at the average cutaway length, bounded by what physically fits (2.5s
// head, 1.5s tail, minGap of talking head between cutaways). 0 is honest: a
// 5% ask on a short clip may round to no cutaways at all.
export function coverageTargetCount(duration: number, percent: number, minGap: number): number {
  const wanted = Math.round((duration * percent) / 100 / AVG_CUT_SECONDS)
  const fits = Math.floor((duration - 2.5 - 1.5 + minGap) / (AVG_CUT_SECONDS + minGap))
  return Math.max(0, Math.min(wanted, fits))
}

// ── Planning ──────────────────────────────────────────────────────────────────

// Per-variation planning personalities: multi-version runs should surface
// DIFFERENT moments and visual angles, not three copies of the obvious plan.
const VARIATION_NUDGE = [
  '- Pick the most literal, obvious visual moments. All cutaways as "card".',
  '- Pick slightly less obvious moments than the most literal ones, and use one "cover" for the most dramatic beat. Prefer atmospheric/environmental queries over literal ones.',
  '- Favor moments in the second half of the video, and metaphorical/conceptual queries (e.g. for money talk: "gold bars macro" rather than "stacks of cash").',
]

export async function planBrollSlots(
  editedWords: EditedWord[],
  duration: number,
  profile: ContentProfile | null,
  variation = 0,
  media: BrollFlavor = 'mixed',
  // Ryan's designed poster cards are a template choice (viral flavor only) —
  // Koe uses the viral density/covers but carries its own graphics instead.
  designs = true,
  // Windows already claimed by template graphics (Koe title/list/venn/rings):
  // graphics outrank stock footage, so B-roll steers around them.
  avoid: Array<{ start: number; duration: number }> = [],
  // Max-motion mode (v7 test): cutaway cadence tightens to every ~3-4s and
  // the talking-head gaps between cutaways shrink — the edit never sits still.
  dense = false,
  // Manual coverage percent from the studio slider (0-50). null = smart: the
  // adaptive cadence below decides. When set, it wins outright — the cadence
  // and its caps are bypassed so the slider is honored on any video length.
  coverage: number | null = null,
): Promise<PlannedSlot[]> {
  if (media === 'none' || duration < 8 || editedWords.length < 10) return []
  const minGap = dense ? 1.2 : 2.0
  // Adaptive cadence for EVERY flavor, driven by the Gemini profile's read of
  // the footage: rich content gets a cutaway every ~6.5s (≈ the reference
  // edits' density), a plain talking head still gets one every ~12s. The
  // viral flavor runs MUCH denser — its references cut away every few seconds
  // even over a static talking head (tuned up on feedback: more action).
  const CADENCE: Record<ContentProfile['brollableRichness'], number> =
    dense ? { none: 4.5, some: 3.8, rich: 3.2 }
    : media === 'viral' ? { none: 7, some: 5.5, rich: 4.5 } : { none: 12, some: 8.5, rich: 6.5 }
  // Sensitivity damper (smart mode): medical/emotional or personal footage
  // reads wrong under a wall of stock cutaways — stretch the cadence so the
  // speaker carries more of the video, same spirit as the Submagic pace gate.
  const sensitivityStretch = profile?.sensitivity === 'medical_emotional' ? 1.5
    : profile?.sensitivity === 'personal' ? 1.2 : 1
  const targetCount = coverage !== null
    ? coverageTargetCount(duration, coverage, minGap)
    : Math.min(
        dense ? 14 : media === 'viral' ? 10 : 6,
        Math.max(2, Math.round(duration / (CADENCE[profile?.brollableRichness ?? 'some'] * sensitivityStretch))),
      )
  if (targetCount === 0) return []
  // Video-flavored variants can carry more full-screen moments; they're the
  // main place transitions (and their sounds) live. A manual coverage ask can
  // exceed the default viral/dense caps, so those caps follow the target.
  const maxCovers = dense ? Math.max(14, targetCount) : media === 'video' ? 3 : media === 'viral' ? Math.max(10, targetCount) : media === 'mixed' ? 2 : 1
  // Longer viral videos earn a second designed Remotion poster card.
  const maxDesigns = media !== 'viral' || !designs ? 0 : duration > 45 ? 2 : 1
  const coverRule = media === 'video'
    ? '- Use "cover" (full-screen) for the one or two most visual moments; covers may run 2.2 to 3.8 seconds.'
    : media === 'viral' && maxDesigns === 0
    ? '- Everything is layout "cover" (full-screen stock video); covers run 2.0 to 3.8 seconds.'
    : media === 'viral'
    ? [
        '- Everything is layout "cover" (full-screen stock video); covers run 2.0 to 3.8 seconds.',
        `- Additionally, EXACTLY ${maxDesigns === 2 ? 'TWO cutaways are' : 'ONE cutaway is the'} DESIGNED poster card${maxDesigns === 2 ? 's' : ''}: the most`,
        '  important claim(s) of the video. For each such item add "design": {"kicker", "headline"}:',
        '  kicker = the 2-4 small lead-in words as spoken (e.g. "It\'s the"), headline = the',
        '  2-4 word payoff as spoken (e.g. "Highest Value Biomarker"). Both must come from the',
        '  transcript wording. Its "query" should describe a single bold OBJECT to illustrate',
        '  the claim (e.g. "anatomical heart illustration", "alarm clock closeup").',
      ].join('\n')
    : '- layout: "card" for most (photo card over the footage); at most one "cover" for the single most dramatic moment.'

  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)
  // Ground the planner in what the footage actually IS (the Gemini profile
  // watched the real video), not just the raw words.
  const contextLines = profile ? [
    `Video context: ${profile.format} content${profile.suggestedHookTitle ? ` — "${profile.suggestedHookTitle}"` : ''}.`,
    profile.emphasisPhrases.length ? `Key moments the speaker stresses: ${profile.emphasisPhrases.join('; ')}.` : '',
  ].filter(Boolean) : []
  let candidates: Partial<PlannedSlot>[] = []
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.3,
      max_tokens: 700,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'Place stock B-roll cutaways on a short-form talking-head video.',
          `Video duration: ${duration.toFixed(1)}s. Place exactly ${targetCount} cutaway(s).`,
          ...contextLines,
          'Transcript with word start times:',
          timed,
          '',
          'Rules:',
          '- Each cutaway illustrates a concrete, visual phrase — start at that phrase\'s time.',
          '- duration: 1.8 to 3.2 seconds. Never start before 2.5s, never end within the last 1.5s.',
          `- At least ${dense ? '1.2' : '2'} seconds of talking-head between cutaways. No overlaps.`,
          '- query: a 2-4 word STOCK-SEARCH query naming something FILMABLE — a person doing a',
          '  specific action, a physical object, or a place ("woman eating dinner", "hands',
          '  scrolling phone", "airport security line"). Stock libraries cannot match abstract',
          '  ideas: NEVER use words like "concept", "success", "quality", "strategy", "mindset".',
          '  BAD: "quality over quantity concept". GOOD: "craftsman polishing watch".',
          '- The query must fit what the SPEAKER MEANS at that moment in this specific video.',
          coverRule,
          VARIATION_NUDGE[variation % VARIATION_NUDGE.length],
          '- Return JSON only: {"items":[{"start":number,"duration":number,"query":string,"layout":"card"|"cover","design":{"kicker":string,"headline":string} (optional)}]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ items?: Partial<PlannedSlot>[] }>(raw)
    candidates = Array.isArray(parsed.items) ? parsed.items : []
  } catch (e) {
    console.warn('[broll] planning failed, skipping B-roll:', (e as Error).message)
    return []
  }

  // Hard validation: the model proposes, the code enforces. Abstract-noun
  // queries can't match stock footage — scrub the tokens the prompt bans so a
  // slip like "quality over quantity concept" degrades to searchable words.
  const ABSTRACT_RE = /\b(concept|conceptual|abstract|metaphor|symbolic?|idea|mindset|strategy|success)\b/gi
  for (const c of candidates) {
    if (typeof c.query === 'string') {
      const scrubbed = c.query.replace(ABSTRACT_RE, ' ').replace(/\s+/g, ' ').trim()
      if (scrubbed) c.query = scrubbed
    }
  }
  const slots: PlannedSlot[] = []
  let lastEnd = 0
  let coversUsed = 0
  let designsUsed = 0
  const maxDur = media === 'video' || media === 'viral' ? 3.8 : 3.2
  for (const c of candidates
    .filter(c => typeof c.start === 'number' && typeof c.duration === 'number' && typeof c.query === 'string' && c.query.trim())
    .sort((a, b) => (a.start as number) - (b.start as number))) {
    const start = Math.max(2.5, Math.max(lastEnd + minGap, c.start as number))
    const dur = Math.min(maxDur, Math.max(1.8, c.duration as number))
    if (start + dur > duration - 1.5) continue
    if (avoid.some(a => start < a.start + a.duration + 0.6 && start + dur > a.start - 0.6)) continue
    // Viral cutaways are always full-screen — once the cover budget is spent,
    // extra slots are dropped rather than demoted to floating cards (the
    // reference has no card grammar at all).
    const wantsCover = media === 'viral' || c.layout === 'cover'
    if (media === 'viral' && coversUsed >= maxCovers) continue
    const layout: PlannedSlot['layout'] = wantsCover && coversUsed < maxCovers ? 'cover' : 'card'
    if (layout === 'cover') coversUsed++
    const slot: PlannedSlot = { start: Number(start.toFixed(2)), duration: Number(dur.toFixed(2)), query: (c.query as string).trim().slice(0, 60), layout }
    // Designed posters: viral flavor only, capped, and only with sane copy.
    const d = c.design
    if (media === 'viral' && layout === 'cover' && designsUsed < maxDesigns && d
        && typeof d.kicker === 'string' && typeof d.headline === 'string'
        && d.headline.trim() && d.headline.trim().split(/\s+/).length <= 5) {
      const PALETTES = ['champagne', 'dusk', 'blush'] as const
      slot.design = {
        kicker: d.kicker.trim().slice(0, 40),
        headline: d.headline.trim().slice(0, 48),
        palette: PALETTES[(variation + designsUsed) % PALETTES.length],
      }
      // The designed card needs room for its text build.
      slot.duration = Math.max(slot.duration, 3.0)
      designsUsed++
    }
    slots.push(slot)
    lastEnd = start + slot.duration
    if (slots.length >= targetCount) break
  }

  // Deterministic gap-fill: on plain footage the model under-delivers against
  // the target and the edit reads static (one lonely cutaway in 37s). Fill the
  // free timeline with neutral creator-lifestyle queries at the same cadence —
  // generic stock beats a bare talking head, and the variation seed still
  // rotates which clips get pulled.
  if (slots.length < targetCount) {
    const FALLBACK_QUERIES: Record<string, string[]> = {
      story: ['man walking city street', 'podcast studio microphone closeup', 'city skyline golden hour', 'hands typing laptop', 'person looking out window', 'sunrise over rooftops'],
      educational: ['person writing notebook', 'hands typing laptop', 'library bookshelf', 'whiteboard marker writing', 'coffee cup on desk', 'person reading book closeup'],
      list: ['hands typing laptop', 'person writing notebook', 'busy city crosswalk', 'modern desk setup', 'sticky notes wall', 'person checking phone'],
      sales: ['business handshake meeting', 'person smiling at phone', 'city skyline golden hour', 'counting cash hands', 'signing contract closeup', 'storefront open sign'],
    }
    const pool = rotated(FALLBACK_QUERIES[profile?.format ?? 'story'] ?? FALLBACK_QUERIES.story, variation)
    const busy = [
      ...slots.map(s => ({ start: s.start, end: s.start + s.duration })),
      ...avoid.map(a => ({ start: a.start - 0.6, end: a.start + a.duration + 0.6 })),
    ].sort((a, b) => a.start - b.start)
    // Tight spacing on purpose: the reference runs a cutaway or graphic every
    // few seconds — 1.2s clearance from graphics and ~3.5s of talking head
    // between fillers is already MORE air than it gives.
    const FILL_DUR = 2.6
    let qi = 0
    let cursor = 3.0
    let filled = 0
    while (slots.length < targetCount && qi < pool.length && cursor + FILL_DUR <= duration - 1.5) {
      const hit = busy.find(b => cursor < b.end + 0.6 && cursor + FILL_DUR > b.start - 0.6)
      if (hit) { cursor = hit.end + 0.6; continue }
      const layout: PlannedSlot['layout'] =
        (media === 'viral' || media === 'video') && coversUsed < maxCovers ? 'cover' : 'card'
      if (layout === 'cover') coversUsed++
      const slot: PlannedSlot = { start: Number(cursor.toFixed(2)), duration: FILL_DUR, query: pool[qi++], layout }
      slots.push(slot)
      busy.push({ start: slot.start, end: slot.start + FILL_DUR })
      busy.sort((a, b) => a.start - b.start)
      filled++
      cursor = slot.start + FILL_DUR + (dense ? 1.3 : 2.5)  // breathe before the next filler
    }
    if (filled) {
      console.log(`[broll] gap-filled ${filled} slot(s) — planner delivered ${slots.length - filled}/${targetCount}`)
      slots.sort((a, b) => a.start - b.start)
    }
  }
  return slots
}

// ── Custom B-roll (user-provided clips) ──────────────────────────────────────
// When the creator supplies their OWN clips (Drive links on the job), stock
// sourcing is skipped entirely. The planner reads the timed transcript plus a
// one-line description of each clip (Gemini watched them) and assigns the
// best-fitting clip to each cutaway moment. Same timing guardrails as the
// stock planner: breathing room between cutaways, nothing over graphics,
// nothing at the very start or end.

export interface CustomClip {
  file: string          // staged filename relative to remotion/public/
  description: string   // one line of what the clip shows (Gemini)
  duration: number      // seconds
  // Index of this clip's row in the job's custom_broll entries. Clips that
  // fail staging are skipped, so positions do NOT line up — always map back
  // to entries through this, never through array position.
  entryIndex?: number
}

// A folder can hold more clips than one short video can use. Renders work
// from at most this many, chosen by content when the folder exceeds it.
export const MAX_CUSTOM_CLIPS_PER_RENDER = 12

// Picks the clips whose CONTENT best serves this transcript when the creator
// supplied more than `max`. One fast LLM pass over the vision descriptions —
// topical fit first, then variety. Falls back to the first `max` on failure
// (matching the old behavior). Returned clips keep their original order.
// Generic over the clip shape so it can also rank CANDIDATE windows that have
// been described but not yet cut to disk — the caller then only pays to stage
// the winners.
export async function selectBestClips<T extends { description: string; duration: number }>(
  clips: T[],
  editedWords: EditedWord[],
  max = MAX_CUSTOM_CLIPS_PER_RENDER,
): Promise<T[]> {
  if (clips.length <= max) return clips
  const transcript = editedWords.map(w => w.text).join(' ').slice(0, 4000)
  const clipLines = clips.map((c, i) => `${i}: (${c.duration.toFixed(1)}s) ${c.description}`)
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      max_tokens: 300,
      json: true,
      messages: [{
        role: 'user',
        content: [
          `A creator gave ${clips.length} of their own B-roll clips for a short talking-head video, but only ${max} can be used.`,
          'Clips (index: length, what the clip shows):',
          ...clipLines,
          '',
          'Transcript of what the creator says:',
          transcript,
          '',
          `Choose the ${max} clips whose content best matches moments in the transcript.`,
          'Prefer topical fit first, then visual variety (avoid near-duplicates).',
          `Return JSON only: {"keep":[${max} clip indices]}`,
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ keep?: number[] }>(raw)
    const keep = [...new Set((parsed.keep ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < clips.length))].slice(0, max)
    if (keep.length >= Math.min(3, max)) {
      const chosen = keep.sort((a, b) => a - b).map(i => clips[i])
      console.log(`[broll] selected ${chosen.length}/${clips.length} custom clip(s) by content`)
      return chosen
    }
  } catch (e) {
    console.warn('[broll] clip selection failed, using the first clips:', (e as Error).message)
  }
  return clips.slice(0, max)
}

export async function planCustomBrollSlots(
  editedWords: EditedWord[],
  duration: number,
  profile: ContentProfile | null,
  clips: CustomClip[],
  avoid: Array<{ start: number; duration: number }> = [],
  dense = false,
  // Manual coverage percent from the studio slider (0-50). null = smart.
  coverage: number | null = null,
): Promise<BrollItem[]> {
  if (!clips.length || duration < 8 || editedWords.length < 10) return []
  const minGap = dense ? 1.2 : 2.0

  // Same adaptive cadence as stock covers; each clip may appear up to twice
  // so short clip lists still cover a long video without going stale.
  const CADENCE: Record<ContentProfile['brollableRichness'], number> = dense
    ? { none: 4, some: 3.5, rich: 3 }
    : { none: 12, some: 9, rich: 6.5 }
  // CLIP-CENTRIC, not slot-centric. The creator uploaded these clips FOR this
  // video, so the job is "give each clip its best moment", not "here are N
  // slots, which clips win one". Slot-centric planning made clips compete and
  // silently dropped most of them (12 uploaded -> 2 used). So on 'smart' the
  // target is simply EVERY clip once, bounded by what the timeline physically
  // fits. The manual slider still overrides with an explicit coverage number.
  const fits = Math.floor((duration - 2.5 - 1.5 + minGap) / (AVG_CUT_SECONDS + minGap))
  const targetCount = coverage !== null
    ? coverageTargetCount(duration, coverage, minGap)
    : Math.max(1, Math.min(clips.length, fits))
  if (targetCount === 0) return []

  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)
  const clipLines = clips.map((c, i) => `${i}: (${c.duration.toFixed(1)}s) ${c.description}`)

  let candidates: Array<{ start?: number; duration?: number; clip?: number }> = []
  // Did we get a real placement decision back? Only a genuine planner FAILURE
  // (API error, or a response that isn't the expected shape) justifies the
  // force-spread fallback below. A planner that ran fine and chose to place few
  // or no cutaways is a judgment we respect — forcing in clips that don't match
  // reads as AI slop and breaks the "never AI-looking" bar.
  let plannerFailed = false
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.3,
      max_tokens: 600,
      json: true,
      messages: [{
        role: 'user',
        content: [
          "Place the creator's OWN B-roll clips as full-screen cutaways on a talking-head video.",
          `Video duration: ${duration.toFixed(1)}s. There are ${clips.length} clips and room for ${targetCount} cutaway(s).`,
          'YOUR JOB: give EACH clip its own best moment. Work clip by clip, not slot by slot.',
          'Available clips (index: length, what it shows):',
          ...clipLines,
          '',
          'Transcript with word start times:',
          timed,
          '',
          'IMPORTANT — these are the creator\'s OWN clips, filmed and hand-picked BY HER for',
          'THIS video. They are not random stock. Footage of her own space (rooms, hallways,',
          'a desk, diplomas, equipment, hands working) is ATMOSPHERIC: it sets place and',
          'breaks up a talking head, and it belongs in the video even when it does not',
          'literally depict the sentence being spoken. Judge relevance generously.',
          '',
          'How to decide (do this per clip):',
          '- A literal illustration is best: a laptop clip over "I opened my laptop".',
          '- A TOPICAL or ATMOSPHERIC fit is also good and normal: her clinic hallway while',
          '  she describes her practice, her equipment while she explains the method, a calm',
          '  room while she describes calming down. Use these.',
          '- Prefer cutting away during EXPLANATORY passages and holding on her face for the',
          '  hook, emotional beats and the call to action.',
          '- Go through the clips IN ORDER and give each one the best moment you can find',
          '  for it. Every clip should get a moment unless there is genuinely nowhere it',
          '  would not confuse the viewer — she uploaded all of them on purpose.',
          '- Spread them across the whole video rather than clustering them.',
          'Constraints for any cutaway you DO place:',
          '- Each clip may be used at most twice; prefer using every fitting clip once first.',
          '- duration: 3.0 to 4.0 seconds, and never longer than the clip itself.',
          '- Never start before 2.5s, never end within the last 1.5s of the video.',
          `- At least ${minGap} seconds of talking-head between cutaways. No overlaps.`,
          '- Return JSON only: {"items":[{"start":number,"duration":number,"clip":number}]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ items?: Array<{ start?: number; duration?: number; clip?: number }> }>(raw)
    if (Array.isArray(parsed.items)) candidates = parsed.items
    else plannerFailed = true   // model didn't answer in the expected shape — treat as a failure, not "nothing fits"
  } catch (e) {
    console.warn('[broll] custom-clip planning failed:', (e as Error).message)
    plannerFailed = true
  }

  // Enforce the rules in code (the model proposes, the code disposes), then
  // fall back to an even spread if the model under-delivers badly — the
  // creator gave us clips, so clips should appear.
  const items: BrollItem[] = []
  const uses = new Map<number, number>()
  let lastEnd = 0
  for (const c of candidates
    .filter(c => typeof c.start === 'number' && typeof c.duration === 'number' && typeof c.clip === 'number')
    .sort((a, b) => (a.start as number) - (b.start as number))) {
    const idx = Math.max(0, Math.min(clips.length - 1, Math.round(c.clip as number)))
    if ((uses.get(idx) ?? 0) >= 2) continue
    const clip = clips[idx]
    const start = Math.max(2.5, Math.max(lastEnd + minGap, c.start as number))
    const dur = Math.min(4.0, Math.min(clip.duration, Math.max(3.0, c.duration as number)))
    if (start + dur > duration - 1.5) continue
    if (avoid.some(a => start < a.start + a.duration + 0.6 && start + dur > a.start - 0.6)) continue
    // A long clip only ever needs `dur` seconds of itself. First use plays
    // from the top; a second use cuts to the clip's tail so the same footage
    // never repeats on screen.
    const nthUse = uses.get(idx) ?? 0
    const srcOffset = nthUse > 0 ? Math.max(0, Number((clip.duration - dur).toFixed(2))) : 0
    items.push({
      start: Number(start.toFixed(2)),
      duration: Number(dur.toFixed(2)),
      file: clip.file,
      kind: 'video',
      layout: 'cover',
      ...(srcOffset > 0 ? { srcOffset } : {}),
      query: clip.description.slice(0, 60),
    })
    uses.set(idx, (uses.get(idx) ?? 0) + 1)
    lastEnd = start + dur
    if (items.length >= targetCount) break
  }

  // Planner ran fine but matched nothing → respect it, keep the video clean
  // rather than forcing footage that doesn't fit what's being said.
  if (!items.length && !plannerFailed) {
    console.log('[broll] planner matched no custom clips to the transcript — leaving custom cutaways out')
  }

  // TOP-UP: the creator uploaded these clips for THIS video, so a planner that
  // places 2 cutaways out of a 12-cutaway target has under-delivered on her
  // intent, not protected the edit. Fill the gap with her UNUSED clips, spread
  // across the parts of the timeline that are still empty, respecting every
  // timing rule below. Only runs when the planner returned something (a real
  // failure still takes the fallback spread further down).
  // Deliberately a FLOOR, not a filler. The planner's judgement stays primary:
  // this only rescues the pathological case (2 cutaways out of a 12 target,
  // seen on real client clips) and stops well short of the ceiling, so weakly
  // matching clips are left out rather than forced in. Filling all the way to
  // the target used every clip and produced placements like an elevator door
  // over "is a mental" — exactly the AI-slop look we are avoiding.
  const TOP_UP_BELOW = 0.4   // only rescue when the planner clearly under-delivered
  const TOP_UP_TO = 0.6      // and only up to here, never the full target
  const topUpCeiling = Math.max(1, Math.floor(targetCount * TOP_UP_TO))
  if (!plannerFailed && items.length && items.length < Math.floor(targetCount * TOP_UP_BELOW)) {
    const unused = clips
      .map((c, idx) => ({ c, idx }))
      .filter(({ idx }) => (uses.get(idx) ?? 0) === 0)
    const gapOk = (start: number, dur: number) =>
      start >= 2.5 &&
      start + dur <= duration - 1.5 &&
      !items.some(it => start < it.start + it.duration + minGap && start + dur > it.start - minGap) &&
      !avoid.some(a => start < a.start + a.duration + 0.6 && start + dur > a.start - 0.6)

    const step = (duration - 4) / (targetCount + 1)
    for (const { c, idx } of unused) {
      if (items.length >= topUpCeiling) break
      const dur = Math.min(3.2, c.duration)
      // Walk candidate slots on the cadence grid and take the first that fits.
      for (let k = 1; k <= targetCount; k++) {
        const start = Number((2.5 + step * k).toFixed(2))
        if (!gapOk(start, dur)) continue
        items.push({
          start,
          duration: Number(dur.toFixed(2)),
          file: c.file,
          kind: 'video',
          layout: 'cover',
          query: c.description.slice(0, 60),
        })
        uses.set(idx, 1)
        break
      }
    }
    items.sort((a, b) => a.start - b.start)
    console.log(`[broll] topped up to ${items.length} cutaway(s) using the creator's unused clips`)
  }

  // Fallback spread: ONLY when the planner failed to return a usable answer
  // (API error / malformed response). The creator gave us clips and we couldn't
  // decide where they go, so spread them evenly as a safety net — each clip
  // lands once, evenly spaced, never more than the coverage target asked for.
  if (!items.length && plannerFailed) {
    const usable = Math.min(targetCount, clips.length, Math.max(1, Math.floor((duration - 6) / (3 + minGap))))
    const step = (duration - 6) / usable
    for (let i = 0; i < usable; i++) {
      const clip = clips[i]
      const start = Number((3 + i * step).toFixed(2))
      const dur = Math.min(3.2, clip.duration)
      if (start + dur > duration - 1.5) break
      items.push({ start, duration: Number(dur.toFixed(2)), file: clip.file, kind: 'video', layout: 'cover', query: clip.description.slice(0, 60) })
    }
    console.log(`[broll] custom-clip fallback spread: ${items.length} cutaway(s)`)
  }

  console.log(`[broll] ${items.length} custom cutaway(s): ${items.map(i => `${i.start}s`).join(', ')}`)
  return items
}

// ── Sourcing ──────────────────────────────────────────────────────────────────

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': 'OlympusEditor/1.0' } })
    if (!res.ok) return false
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    return fs.statSync(dest).size > 10_000
  } catch {
    return false
  }
}

// Rotates a result list so different variations pick different media for the
// same query (variation 1 starts from the 2nd result, etc.).
function rotated<T>(arr: T[], offset: number): T[] {
  if (!arr.length) return arr
  const n = ((offset % arr.length) + arr.length) % arr.length
  return [...arr.slice(n), ...arr.slice(0, n)]
}

// Media already claimed by an earlier slot in THIS render, keyed by stable
// provider id. Two slots whose queries collapse to the same ladder term used to
// receive byte-identical footage: the rotation offset was the render's single
// `variation` value, so "same query + same offset" always resolved to the same
// result. Threading one set through every fetcher makes a repeat impossible
// rather than merely unlikely.
export type UsedMedia = Set<string>

async function fetchPexelsVideo(query: string, dest: string, offset = 0, used?: UsedMedia): Promise<boolean> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait&size=medium`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    type PexelsVideo = { id?: number; video_files?: Array<{ width: number; height: number; link: string }> }
    for (const video of rotated<PexelsVideo>(data.videos ?? [], offset)) {
      const id = `pexels-video:${video.id ?? ''}`
      if (video.id && used?.has(id)) continue
      const file = (video.video_files ?? [])
        .filter((f: { width: number; height: number; link: string }) => f.height >= 1000 && f.height <= 2200)
        .sort((a: { height: number }, b: { height: number }) => a.height - b.height)[0]
      if (file?.link && await download(file.link, dest)) {
        if (video.id) used?.add(id)
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

async function fetchPexelsPhoto(query: string, dest: string, offset = 0, used?: UsedMedia): Promise<boolean> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    type PexelsPhoto = { id?: number; src?: { large2x?: string; large?: string } }
    for (const photo of rotated<PexelsPhoto>(data.photos ?? [], offset)) {
      const id = `pexels-photo:${photo.id ?? ''}`
      if (photo.id && used?.has(id)) continue
      const url = photo?.src?.large2x ?? photo?.src?.large
      if (url && await download(url, dest)) {
        if (photo.id) used?.add(id)
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

// Keyless fallback: Openverse, cc0/public-domain only (no attribution needed).
async function fetchOpenverseImage(query: string, dest: string, offset = 0, used?: UsedMedia): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&license=cc0,pdm&category=photograph`,
      { headers: { 'User-Agent': 'OlympusEditor/1.0' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    for (const result of rotated<{ id?: string; url?: string }>(data.results ?? [], offset)) {
      if (!result?.url) continue
      const id = `openverse:${result.id ?? result.url}`
      if (used?.has(id)) continue
      if (await download(result.url, dest)) {
        used?.add(id)
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

// A too-specific query shouldn't kill the slot — relax it word by word
// ("brainstorm meeting whiteboard" → "brainstorm meeting" → "brainstorm").
function queryLadder(query: string): string[] {
  const words = query.split(/\s+/).filter(Boolean)
  const ladder = [query]
  if (words.length > 2) ladder.push(words.slice(0, 2).join(' '))
  if (words.length > 1) ladder.push(words[words.length - 1], words[0])
  return [...new Set(ladder)]
}

// Resolve every planned slot to an actual downloaded file. Slots that find no
// media are dropped silently — a missing cutaway is invisible; a broken one isn't.
export async function resolveBrollMedia(
  slots: PlannedSlot[],
  stageDir: string,
  publicPrefix: string,
  variation = 0,
  // Per-variant B-roll flavor: 'image' = photo cards only (the reference look),
  // 'video' = motion clips wherever possible (cards can hold video too),
  // 'mixed' = video for full-screen covers, photos for cards,
  // 'viral' = full-screen video covers, except the designed poster card which
  //           wants a PHOTO to float on its gradient canvas.
  media: BrollFlavor = 'mixed',
  // Shared across every slot of one render so no clip is ever used twice. The
  // caller may pass its own set to also exclude media used elsewhere.
  used: UsedMedia = new Set(),
): Promise<BrollItem[]> {
  fs.mkdirSync(stageDir, { recursive: true })
  const items: BrollItem[] = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    let resolved = false
    // Per-SLOT rotation offset. `variation` alone is constant for the whole
    // render, so every slot started at the same index of its result list.
    const offset = variation + i

    for (const query of queryLadder(slot.query)) {
      // Mixed mode: covers are always video; cards flip a seeded coin so a
      // healthy share of cards carry motion too. The viral designed card is the
      // one viral slot that prefers a still (it drifts on the poster canvas).
      const wantsVideo = ((media === 'video' || media === 'viral') && !slot.design)
        || (media === 'mixed' && (slot.layout === 'cover' || (variation + i) % 2 === 0))
      if (wantsVideo) {
        const videoDest = path.join(stageDir, `broll-${i}.mp4`)
        if (await fetchPexelsVideo(query, videoDest, offset, used)) {
          items.push({ start: slot.start, duration: slot.duration, file: `${publicPrefix}/broll-${i}.mp4`, kind: 'video', layout: slot.layout, design: slot.design, query: slot.query })
          resolved = true
          break
        }
      }
      const photoDest = path.join(stageDir, `broll-${i}.jpg`)
      if (await fetchPexelsPhoto(query, photoDest, offset, used) || await fetchOpenverseImage(query, photoDest, offset, used)) {
        items.push({ start: slot.start, duration: slot.duration, file: `${publicPrefix}/broll-${i}.jpg`, kind: 'image', layout: slot.layout, design: slot.design, query: slot.query })
        resolved = true
        break
      }
    }
    if (!resolved) {
      // A designed poster still works without media — it degrades to a
      // typography-only animated card instead of silently vanishing.
      if (slot.design) {
        items.push({ start: slot.start, duration: slot.duration, file: '', kind: 'image', layout: slot.layout, design: slot.design })
        console.warn(`[broll] no media for designed card "${slot.query}" — rendering typography-only poster`)
      } else {
        console.warn(`[broll] no media found for "${slot.query}" — slot dropped`)
      }
    }
  }
  console.log(`[broll] resolved ${items.length}/${slots.length} slot(s) (${media}), ${used.size} distinct media`)
  return items
}

// Fetch up to `count` EXTRA stills for a query — distinct results via rotation
// offsets — for the eubank carousel moment (2-3 translucent panels at once).
// Best-effort: whatever resolves comes back; an empty array degrades the beat
// to a single panel or cover.
export async function resolveExtraImages(
  query: string,
  stageDir: string,
  publicPrefix: string,
  baseName: string,
  count: number,
  variation = 0,
  // Pass the render's set so a carousel pane can't repeat a cover's photo.
  used: UsedMedia = new Set(),
): Promise<string[]> {
  fs.mkdirSync(stageDir, { recursive: true })
  const out: string[] = []
  for (let k = 0; k < count; k++) {
    const dest = path.join(stageDir, `${baseName}-x${k}.jpg`)
    if (await fetchPexelsPhoto(query, dest, variation + k + 1, used) || await fetchOpenverseImage(query, dest, variation + k + 1, used)) {
      out.push(`${publicPrefix}/${baseName}-x${k}.jpg`)
    }
  }
  return out
}

// Viral pages sitting over a full-screen cover get the reference's poster
// treatment (big, centered); pages under the DESIGNED card are dropped outright
// — that card carries its own headline, and the reference shows no captions
// while it holds.
export function applyViralCoverTreatment(pages: CaptionPage[], broll: BrollItem[]): CaptionPage[] {
  const covers = broll.filter(b => b.layout === 'cover')
  return pages.filter(page => {
    const over = covers.find(b => page.start < b.start + b.duration && page.end > b.start)
    if (!over) return true
    const coverEnd = over.start + over.duration
    // Overlap FRACTION, not overlap-at-all: a page that merely grazes the
    // cover's edge spends most of its life over the raw footage, where the
    // centered poster treatment sits straight across the speaker's face. Those
    // pages keep their face-safe band; only pages truly inside the cover go big.
    const overlap = Math.min(page.end, coverEnd) - Math.max(page.start, over.start)
    const frac = overlap / Math.max(page.end - page.start, 0.01)
    if (over.design) return frac < 0.6
    if (frac < 0.6) return true
    page.big = true
    page.position = 'mid'
    // And never let the poster page outlive its cover — once the footage is
    // back, 'mid' IS the face band.
    page.end = Math.min(page.end, coverEnd + 0.15)
    return true
  })
}

// ── Caption interplay ─────────────────────────────────────────────────────────

// A centered photo card owns the middle of the frame — any caption page that
// overlaps it in time gets pushed to the bottom so the two never collide.
export function avoidCaptionCollisions(pages: CaptionPage[], broll: BrollItem[]): void {
  for (const page of pages) {
    if (page.position !== 'mid') continue
    const collides = broll.some(b =>
      b.layout === 'card' && page.start < b.start + b.duration && page.end > b.start
    )
    if (collides) page.position = 'low'
  }
}
