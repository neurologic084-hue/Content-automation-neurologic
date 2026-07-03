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

export interface BrollItem {
  start: number      // edited-timeline seconds
  duration: number
  file: string       // filename relative to remotion/public/
  kind: 'video' | 'image'
  layout: 'card' | 'cover'
}

interface PlannedSlot {
  start: number
  duration: number
  query: string
  layout: 'card' | 'cover'
}

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
  media: 'image' | 'video' | 'mixed' = 'mixed',
): Promise<PlannedSlot[]> {
  if (duration < 8 || editedWords.length < 10) return []
  const pct = COVERAGE[profile?.brollableRichness ?? 'some']
  const targetCount = Math.min(6, Math.max(1, Math.round((duration * pct / 100) / 2.75)))
  // Video-flavored variants can carry more full-screen moments; they're the
  // main place transitions (and their sounds) live.
  const maxCovers = media === 'video' ? 2 : 1
  const coverRule = media === 'video'
    ? '- Use "cover" (full-screen) for the one or two most visual moments; covers may run 2.2 to 3.8 seconds.'
    : '- layout: "card" for most (photo card over the footage); at most one "cover" for the single most dramatic moment.'

  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)
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
          'Transcript with word start times:',
          timed,
          '',
          'Rules:',
          '- Each cutaway illustrates a concrete, visual phrase — start at that phrase\'s time.',
          '- duration: 1.8 to 3.2 seconds. Never start before 2.5s, never end within the last 1.5s.',
          '- At least 2.5 seconds of talking-head between cutaways. No overlaps.',
          '- query: a 2-4 word STOCK-SEARCH query, generic and visual ("film production set", "team whiteboard meeting", "stacks of cash"). No names, no brands.',
          coverRule,
          VARIATION_NUDGE[variation % VARIATION_NUDGE.length],
          '- Return JSON only: {"items":[{"start":number,"duration":number,"query":string,"layout":"card"|"cover"}]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ items?: Partial<PlannedSlot>[] }>(raw)
    candidates = Array.isArray(parsed.items) ? parsed.items : []
  } catch (e) {
    console.warn('[broll] planning failed, skipping B-roll:', (e as Error).message)
    return []
  }

  // Hard validation: the model proposes, the code enforces.
  const slots: PlannedSlot[] = []
  let lastEnd = 0
  let coversUsed = 0
  const maxDur = media === 'video' ? 3.8 : 3.2
  for (const c of candidates
    .filter(c => typeof c.start === 'number' && typeof c.duration === 'number' && typeof c.query === 'string' && c.query.trim())
    .sort((a, b) => (a.start as number) - (b.start as number))) {
    const start = Math.max(2.5, Math.max(lastEnd + 2.5, c.start as number))
    const dur = Math.min(maxDur, Math.max(1.8, c.duration as number))
    if (start + dur > duration - 1.5) continue
    const layout: PlannedSlot['layout'] = c.layout === 'cover' && coversUsed < maxCovers ? 'cover' : 'card'
    if (layout === 'cover') coversUsed++
    slots.push({ start: Number(start.toFixed(2)), duration: Number(dur.toFixed(2)), query: (c.query as string).trim().slice(0, 60), layout })
    lastEnd = start + dur
    if (slots.length >= targetCount) break
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
  // 'mixed' = video for full-screen covers, photos for cards.
  media: 'image' | 'video' | 'mixed' = 'mixed',
): Promise<BrollItem[]> {
  fs.mkdirSync(stageDir, { recursive: true })
  const items: BrollItem[] = []
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    let resolved = false

    for (const query of queryLadder(slot.query)) {
      // Mixed mode: covers are always video; cards flip a seeded coin so a
      // healthy share of cards carry motion too.
      const wantsVideo = media === 'video'
        || (media === 'mixed' && (slot.layout === 'cover' || (variation + i) % 2 === 0))
      if (wantsVideo) {
        const videoDest = path.join(stageDir, `broll-${i}.mp4`)
        if (await fetchPexelsVideo(query, videoDest, variation)) {
          items.push({ start: slot.start, duration: slot.duration, file: `${publicPrefix}/broll-${i}.mp4`, kind: 'video', layout: slot.layout })
          resolved = true
          break
        }
      }
      const photoDest = path.join(stageDir, `broll-${i}.jpg`)
      if (await fetchPexelsPhoto(query, photoDest, variation) || await fetchOpenverseImage(query, photoDest, variation)) {
        items.push({ start: slot.start, duration: slot.duration, file: `${publicPrefix}/broll-${i}.jpg`, kind: 'image', layout: slot.layout })
        resolved = true
        break
      }
    }
    if (!resolved) console.warn(`[broll] no media found for "${slot.query}" — slot dropped`)
  }
  console.log(`[broll] resolved ${items.length}/${slots.length} slot(s) (${media})`)
  return items
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
