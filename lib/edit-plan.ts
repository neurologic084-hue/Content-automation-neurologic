// ── Remotion-only edit engine: cut planning + caption pages + zoom plan ───────
// Replaces Submagic's removeSilence / removeBadTakes / captions / zooms for the
// v6 Remotion-only variant. Everything works on ONE word-level transcript:
//
//   1. planKeepSegments  — silence cuts are deterministic code (gaps between
//      words); retakes/fillers are an LLM pass whose output is hard-validated.
//   2. remapToEditedTimeline — pure arithmetic from source time → edited time,
//      so captions/zooms/SFX never drift after cutting (Submagic needed a full
//      re-transcription for this; we don't, because we made the cuts).
//   3. buildCaptionPages — reference-style caption pages (Title Case, 3-5 words,
//      accent words from the Gemini profile, floating position).
//   4. planZooms — subtle per-segment punch-ins/outs; emphasis moments zoom in.
//
// Design principle throughout: RESTRAINT. Subtle zooms, quick blur joins, one
// refined caption system — professional short-form, never "AI-generated" busy.

import { chatCompletion, MODELS } from './openrouter'
import { parseJsonLoose } from './json-loose'
import type { ContentProfile } from './video-analysis'
import type { WordTimestamp } from './caption-renderer'

export interface KeepSegment {
  start: number  // source seconds
  end: number    // source seconds
}

export interface EditedWord {
  text: string
  start: number  // EDITED-timeline seconds
  end: number
  segmentIndex: number
}

export interface CaptionWord {
  t: string
  accent: boolean
}

export interface CaptionPage {
  start: number  // edited seconds
  end: number
  position: 'low' | 'mid' | 'high'
  words: CaptionWord[]
}

export interface SegmentPlan {
  srcStart: number      // source seconds to start reading footage from
  duration: number      // seconds in the edited timeline
  zoom: 'in' | 'out' | 'none'
}

export interface EditPlan {
  segments: SegmentPlan[]
  pages: CaptionPage[]
  editedWords: EditedWord[]  // edited-timeline words, for downstream planners (B-roll)
  editedDuration: number
}

// ── 1. Cut planning ───────────────────────────────────────────────────────────

const GAP_CUT_THRESHOLD = 0.45   // silence longer than this gets cut
const SPEECH_PADDING = 0.16      // breathing room kept around speech
const MERGE_GAP = 0.30           // segments closer than this merge into one
const MIN_SEGMENT = 0.40         // drop fragments shorter than this

// Common pure-filler tokens safe to drop without meaning loss.
const FILLER_RE = /^(um+|uh+|erm+|hmm+)[.,!?]?$/i

// LLM pass: mark word ranges that are retakes/false starts. Silence cutting is
// NOT delegated to the model — that's deterministic. The model only judges
// semantic duplication, and its output is clamped hard.
async function detectRetakeRanges(words: WordTimestamp[]): Promise<Array<[number, number]>> {
  if (words.length < 12) return []
  const numbered = words.map((w, i) => `${i}:${w.text}`).join(' ')
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.1,
      max_tokens: 500,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are cleaning a talking-head video transcript. Words are numbered "index:word".',
          'Find RETAKES and FALSE STARTS: places where the speaker restarts a sentence and the',
          'earlier attempt is a near-duplicate of what follows. Mark the EARLIER (abandoned)',
          'attempt for removal — always keep the final take. Do NOT mark normal repetition used',
          'for emphasis. If unsure, mark nothing.',
          '',
          numbered.slice(0, 8000),
          '',
          'Return JSON only: {"drop":[[startIndex,endIndex],...]} (inclusive ranges). Empty array if none.',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ drop?: unknown }>(raw)
    const ranges = Array.isArray(parsed.drop) ? parsed.drop : []
    const valid: Array<[number, number]> = []
    let dropped = 0
    for (const r of ranges) {
      if (!Array.isArray(r) || r.length !== 2) continue
      const [a, b] = r as [number, number]
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= words.length || b < a) continue
      dropped += b - a + 1
      valid.push([a, b])
    }
    // Guardrail: a retake pass that wants >30% of the words gone is hallucinating.
    if (dropped > words.length * 0.3) {
      console.warn('[edit-plan] retake detection wanted too much removed — ignoring it')
      return []
    }
    return valid
  } catch (e) {
    console.warn('[edit-plan] retake detection failed, keeping all takes:', (e as Error).message)
    return []
  }
}

export async function planKeepSegments(
  words: WordTimestamp[],
  sourceDuration: number,
): Promise<KeepSegment[]> {
  if (!words.length) return [{ start: 0, end: sourceDuration }]

  const dropRanges = await detectRetakeRanges(words)
  const dropped = new Set<number>()
  for (const [a, b] of dropRanges) for (let i = a; i <= b; i++) dropped.add(i)
  words.forEach((w, i) => { if (FILLER_RE.test(w.text.trim())) dropped.add(i) })

  const kept = words.filter((_, i) => !dropped.has(i))
  if (!kept.length) return [{ start: 0, end: sourceDuration }]

  // Group kept words into segments wherever the gap is small enough.
  const segments: KeepSegment[] = []
  let cur: KeepSegment = { start: kept[0].start, end: kept[0].end }
  for (let i = 1; i < kept.length; i++) {
    const w = kept[i]
    if (w.start - cur.end > GAP_CUT_THRESHOLD) {
      segments.push(cur)
      cur = { start: w.start, end: w.end }
    } else {
      cur.end = Math.max(cur.end, w.end)
    }
  }
  segments.push(cur)

  // Pad, clamp, merge, and drop fragments.
  const padded = segments.map(s => ({
    start: Math.max(0, s.start - SPEECH_PADDING),
    end: Math.min(sourceDuration, s.end + SPEECH_PADDING),
  }))
  const merged: KeepSegment[] = []
  for (const s of padded) {
    const last = merged[merged.length - 1]
    if (last && s.start - last.end < MERGE_GAP) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }
  const final = merged.filter(s => s.end - s.start >= MIN_SEGMENT)
  return final.length ? final : [{ start: 0, end: sourceDuration }]
}

// ── 2. Timeline remap ─────────────────────────────────────────────────────────

export function remapToEditedTimeline(
  words: WordTimestamp[],
  segments: KeepSegment[],
): EditedWord[] {
  const out: EditedWord[] = []
  let offset = 0
  segments.forEach((seg, si) => {
    for (const w of words) {
      // Fillers are cut from the timeline plan, but segment padding can swallow
      // their little gap — never let them back into the captions.
      if (FILLER_RE.test(w.text.trim())) continue
      const mid = (w.start + w.end) / 2
      if (mid >= seg.start && mid <= seg.end) {
        out.push({
          text: w.text,
          start: offset + (Math.max(w.start, seg.start) - seg.start),
          end: offset + (Math.min(w.end, seg.end) - seg.start),
          segmentIndex: si,
        })
      }
    }
    offset += seg.end - seg.start
  })
  return out
}

// ── 3. Caption pages (reference style) ────────────────────────────────────────

function titleCase(word: string): string {
  if (!word) return word
  if (/^\d/.test(word)) return word
  return word[0].toUpperCase() + word.slice(1)
}

function accentTokens(profile: ContentProfile | null): Set<string> {
  const tokens = new Set<string>()
  if (!profile) return tokens
  for (const phrase of [...profile.emphasisPhrases, ...profile.keyNumbers]) {
    for (const t of phrase.toLowerCase().split(/\s+/)) {
      const clean = t.replace(/[^a-z0-9$%.]/gi, '')
      // Only content-bearing tokens become accents — short glue words never do.
      if (clean.length >= 4 || /\d/.test(clean)) tokens.add(clean)
    }
  }
  return tokens
}

export function buildCaptionPages(
  editedWords: EditedWord[],
  profile: ContentProfile | null,
  variation = 0,
): CaptionPage[] {
  const accents = accentTokens(profile)
  const pages: CaptionPage[] = []
  const POSITIONS: Array<CaptionPage['position']> =
    profile?.faceFraming === 'tight' ? ['low', 'low', 'high'] : ['low', 'mid', 'low', 'high']

  let page: EditedWord[] = []
  const flush = () => {
    if (!page.length) return
    const words = page.map(w => {
      const clean = w.text.toLowerCase().replace(/[^a-z0-9$%.]/gi, '')
      return { t: titleCase(w.text.trim()), accent: accents.has(clean) }
    })
    pages.push({
      start: page[0].start,
      end: page[page.length - 1].end + 0.12,
      // The variation seed rotates the position pattern so multi-version runs
      // put captions in visibly different places.
      position: POSITIONS[(pages.length + variation) % POSITIONS.length],
      words,
    })
    page = []
  }

  for (let i = 0; i < editedWords.length; i++) {
    const w = editedWords[i]
    const prev = page[page.length - 1]
    // New page on: segment change, notable pause, sentence end, or 4-word cap.
    if (prev && (
      w.segmentIndex !== prev.segmentIndex ||
      w.start - prev.end > 0.5 ||
      /[.!?]$/.test(prev.text) ||
      page.length >= 4
    )) flush()
    page.push(w)
  }
  flush()

  // Pages never overlap: clip each end to the next start.
  for (let i = 0; i < pages.length - 1; i++) {
    pages[i].end = Math.min(pages[i].end, pages[i + 1].start)
  }
  return pages.filter(p => p.end - p.start > 0.05)
}

// ── 4. Zoom plan ──────────────────────────────────────────────────────────────

export function planZooms(
  segments: KeepSegment[],
  editedWords: EditedWord[],
  profile: ContentProfile | null,
  variation = 0,
): SegmentPlan[] {
  const accents = accentTokens(profile)
  // Zooms read as jitter on tight framing — same guardrail as the Submagic path.
  const zoomsAllowed = profile?.faceFraming !== 'tight'

  let offset = 0
  return segments.map((seg, i) => {
    const duration = seg.end - seg.start
    const segWords = editedWords.filter(w => w.segmentIndex === i)
    const hasEmphasis = segWords.some(w =>
      accents.has(w.text.toLowerCase().replace(/[^a-z0-9$%.]/gi, ''))
    )
    let zoom: SegmentPlan['zoom'] = 'none'
    if (zoomsAllowed && duration >= 1.2) {
      // Emphasis pulls a punch-in; otherwise gently alternate so consecutive
      // segments feel like different "shots" (the multi-angle stand-in). The
      // variation seed shifts the pattern so versions move differently.
      const beat = (i + variation) % 3
      zoom = hasEmphasis ? 'in' : (beat === 1 ? 'out' : beat === 2 ? 'in' : 'none')
    }
    offset += duration
    return { srcStart: seg.start, duration, zoom }
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function buildEditPlan(
  words: WordTimestamp[],
  sourceDuration: number,
  profile: ContentProfile | null,
  variation = 0,
): Promise<EditPlan> {
  const segments = await planKeepSegments(words, sourceDuration)
  const editedWords = remapToEditedTimeline(words, segments)
  const pages = buildCaptionPages(editedWords, profile, variation)
  const plans = planZooms(segments, editedWords, profile, variation)
  const editedDuration = plans.reduce((a, s) => a + s.duration, 0)
  console.log(`[edit-plan] ${segments.length} segments, ${pages.length} caption pages, ${sourceDuration.toFixed(1)}s -> ${editedDuration.toFixed(1)}s`)
  return { segments: plans, pages, editedWords, editedDuration }
}
