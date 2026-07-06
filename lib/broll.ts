// ── B-roll for the Remotion-only edit (v6) ────────────────────────────────────
// Plans WHERE cutaways belong (LLM over the edited transcript, hard-validated),
// then sources real media:
//
//   1. Pexels (videos + photos)  — used when PEXELS_API_KEY is set. Free key,
//      no attribution required, the same library Submagic pulls from.
//   2. Openverse (CC0 images)    — keyless fallback so B-roll always works.
//      cc0/pdm licenses only, so no attribution obligations sneak in.
//
// Coverage follows the same Gemini-profile ceilings as the Submagic variants
// (brollableRichness → 20/30/40%), and the reference video's grammar: photo
// CARDS floating over the footage for most items, at most one full-screen cover.

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

const COVERAGE: Record<ContentProfile['brollableRichness'], number> = { none: 30, some: 35, rich: 40 }

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
): Promise<PlannedSlot[]> {
  if (media === 'none' || duration < 8 || editedWords.length < 10) return []
  // Adaptive cadence for EVERY flavor, driven by the Gemini profile's read of
  // the footage: rich content gets a cutaway every ~6.5s (≈ the reference
  // edits' density), a plain talking head still gets one every ~12s. The
  // viral flavor runs MUCH denser — its references cut away every few seconds
  // even over a static talking head (tuned up on feedback: more action).
  const CADENCE: Record<ContentProfile['brollableRichness'], number> =
    media === 'viral' ? { none: 7, some: 5.5, rich: 4.5 } : { none: 12, some: 8.5, rich: 6.5 }
  const targetCount = Math.min(
    media === 'viral' ? 10 : 6,
    Math.max(2, Math.round(duration / CADENCE[profile?.brollableRichness ?? 'some'])),
  )
  // Video-flavored variants can carry more full-screen moments; they're the
  // main place transitions (and their sounds) live.
  const maxCovers = media === 'video' ? 3 : media === 'viral' ? 10 : media === 'mixed' ? 2 : 1
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
          '- At least 2 seconds of talking-head between cutaways. No overlaps.',
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
    const start = Math.max(2.5, Math.max(lastEnd + 2.0, c.start as number))
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
      cursor = slot.start + FILL_DUR + 2.5  // breathe before the next filler
    }
    if (filled) {
      console.log(`[broll] gap-filled ${filled} slot(s) — planner delivered ${slots.length - filled}/${targetCount}`)
      slots.sort((a, b) => a.start - b.start)
    }
  }
  return slots
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
  const n = offset % arr.length
  return [...arr.slice(n), ...arr.slice(0, n)]
}

async function fetchPexelsVideo(query: string, dest: string, offset = 0): Promise<boolean> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait&size=medium`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    type PexelsVideo = { video_files?: Array<{ width: number; height: number; link: string }> }
    for (const video of rotated<PexelsVideo>(data.videos ?? [], offset)) {
      const file = (video.video_files ?? [])
        .filter((f: { width: number; height: number; link: string }) => f.height >= 1000 && f.height <= 2200)
        .sort((a: { height: number }, b: { height: number }) => a.height - b.height)[0]
      if (file?.link && await download(file.link, dest)) return true
    }
    return false
  } catch {
    return false
  }
}

async function fetchPexelsPhoto(query: string, dest: string, offset = 0): Promise<boolean> {
  const key = process.env.PEXELS_API_KEY
  if (!key) return false
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=portrait`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    type PexelsPhoto = { src?: { large2x?: string; large?: string } }
    for (const photo of rotated<PexelsPhoto>(data.photos ?? [], offset)) {
      const url = photo?.src?.large2x ?? photo?.src?.large
      if (url && await download(url, dest)) return true
    }
    return false
  } catch {
    return false
  }
}

// Keyless fallback: Openverse, cc0/public-domain only (no attribution needed).
async function fetchOpenverseImage(query: string, dest: string, offset = 0): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&license=cc0,pdm&category=photograph`,
      { headers: { 'User-Agent': 'OlympusEditor/1.0' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!res.ok) return false
    const data = await res.json()
    for (const result of rotated<{ url?: string }>(data.results ?? [], offset)) {
      if (result?.url && await download(result.url, dest)) return true
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
): Promise<BrollItem[]> {
  fs.mkdirSync(stageDir, { recursive: true })
  const items: BrollItem[] = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    let resolved = false

    for (const query of queryLadder(slot.query)) {
      // Mixed mode: covers are always video; cards flip a seeded coin so a
      // healthy share of cards carry motion too. The viral designed card is the
      // one viral slot that prefers a still (it drifts on the poster canvas).
      const wantsVideo = ((media === 'video' || media === 'viral') && !slot.design)
        || (media === 'mixed' && (slot.layout === 'cover' || (variation + i) % 2 === 0))
      if (wantsVideo) {
        const videoDest = path.join(stageDir, `broll-${i}.mp4`)
        if (await fetchPexelsVideo(query, videoDest, variation)) {
          items.push({ start: slot.start, duration: slot.duration, file: `${publicPrefix}/broll-${i}.mp4`, kind: 'video', layout: slot.layout, design: slot.design, query: slot.query })
          resolved = true
          break
        }
      }
      const photoDest = path.join(stageDir, `broll-${i}.jpg`)
      if (await fetchPexelsPhoto(query, photoDest, variation) || await fetchOpenverseImage(query, photoDest, variation)) {
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
  console.log(`[broll] resolved ${items.length}/${slots.length} slot(s) (${media})`)
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
): Promise<string[]> {
  fs.mkdirSync(stageDir, { recursive: true })
  const out: string[] = []
  for (let k = 0; k < count; k++) {
    const dest = path.join(stageDir, `${baseName}-x${k}.jpg`)
    if (await fetchPexelsPhoto(query, dest, variation + k + 1) || await fetchOpenverseImage(query, dest, variation + k + 1)) {
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
