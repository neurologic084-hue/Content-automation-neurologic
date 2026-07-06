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
  // Eubank (v4) semantic accent color: the reference color-codes emphasis by
  // MEANING — green for wins/positives, red for warnings/negatives, gold for
  // neutral emphasis. Only set when accent is true; absent for other styles.
  tone?: 'good' | 'bad' | 'gold'
}

// Accent treatments for the viral caption system (v5). Font: 'serif' is the
// big italic editorial serif (the "Perfect Sleep" look), 'block' is the heavy
// grotesk used for times/numbers (the "10PM" look). Colors mirror the
// reference's rotation: warm gold, peach copper, hot orange, violet, and one
// orange-to-violet gradient sweep.
export type ViralAccentFont = 'serif' | 'block'
export type ViralAccentColor = 'gold' | 'copper' | 'orange' | 'purple' | 'gradient'

export interface CaptionPage {
  start: number  // edited seconds
  end: number
  position: 'low' | 'mid' | 'high'
  words: CaptionWord[]
  // ── viral-style (v5) extras — absent for every other caption style ─────────
  // Inclusive [from, to] indices into `words` marking the emphasized phrase.
  // Words before it render as the small sans "kicker" line, words after as the
  // small sans tail — the reference's two-tier stacked layout.
  accentRange?: [number, number]
  accentFont?: ViralAccentFont
  accentColor?: ViralAccentColor
  // Poster treatment: page sits over a full-screen B-roll cover, so it renders
  // bigger and centered (the "If your bed time is 10PM" look). Eubank reuses it
  // for big centered punchline pages ("every single time.").
  big?: boolean
  // Hook page rendered behind the speaker (needs the subject matte staged).
  behind?: boolean
  // Eubank (v4) horizontal variety: the reference occasionally left-aligns a
  // caption block. Default (absent) is centered.
  align?: 'left' | 'center'
}

export interface SegmentPlan {
  srcStart: number      // source seconds to start reading footage from
  duration: number      // seconds in the edited timeline
  zoom: 'in' | 'out' | 'none'
  // 'inset' shrinks this whole segment into a white-framed card on an off-white
  // canvas (the reference's scale-into-card beat), then scales back out.
  frame?: 'inset'
}

export interface EditPlan {
  segments: SegmentPlan[]
  pages: CaptionPage[]
  editedWords: EditedWord[]  // edited-timeline words, for downstream planners (B-roll)
  editedDuration: number
}

// ── 1. Cut planning ───────────────────────────────────────────────────────────

// Two cut profiles. NOTE the interaction: a pause only truly disappears when
// (gap - 2×padding) > mergeGap, so the natural profile's real cut floor is
// ~0.62s — fine for calm variants. The tight profile (v5 viral) floors at
// ~0.42s and keeps far less breathing room around speech.
interface CutParams {
  gapCut: number      // silence longer than this gets cut
  padding: number     // breathing room kept around speech
  mergeGap: number    // segments closer than this (after padding) merge back
  minSegment: number  // drop fragments shorter than this
  silenceSplit: number // energy-detected silence inside a segment longer than this gets cut out
}
const CUT_NATURAL: CutParams = { gapCut: 0.45, padding: 0.16, mergeGap: 0.30, minSegment: 0.40, silenceSplit: 0.60 }
const CUT_TIGHT: CutParams = { gapCut: 0.30, padding: 0.09, mergeGap: 0.18, minSegment: 0.35, silenceSplit: 0.42 }

// Common pure-filler tokens safe to drop without meaning loss. Covers the
// transcriber's spelling variants: um/umm/uhm, uh/uhh, ah/ahh, er/erm, hmm/mhm/mm.
const FILLER_RE = /^(u+h*m+|u+h+|erm*|hm+|mhm+|mm+|a+h+)[.,!?…]*$/i

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

export interface CutOptions {
  tight?: boolean
  // Energy-detected silence intervals in SOURCE time (ffmpeg silencedetect on
  // the cleaned audio). The second signal that catches what the transcript
  // can't: Scribe word timings often stretch across real pauses, so gap-based
  // cutting alone leaves dead air the words claim to cover.
  silences?: Array<[number, number]>
}

export async function planKeepSegments(
  rawWords: WordTimestamp[],
  sourceDuration: number,
  opts: CutOptions = {},
): Promise<KeepSegment[]> {
  if (!rawWords.length) return [{ start: 0, end: sourceDuration }]
  const P = opts.tight ? CUT_TIGHT : CUT_NATURAL

  // Token sanitation: Scribe sometimes stretches a word's end across a long
  // pause that follows it (observed: a 3.7s "fact,"), which hides the pause
  // from gap detection entirely. Clamp absurd spans so the real gap shows.
  const words = rawWords.map(w =>
    w.end - w.start > 1.2 ? { ...w, end: w.start + 0.9 } : w
  )

  const dropRanges = await detectRetakeRanges(words)
  const dropped = new Set<number>()
  for (const [a, b] of dropRanges) for (let i = a; i <= b; i++) dropped.add(i)
  words.forEach((w, i) => {
    const t = w.text.trim()
    // Fillers, transcriber sound events ("(sighs)", "(rustling sound)"), and
    // trailing-dash stutter fragments ("a-") are all non-speech: drop them
    // from the edit, not just the captions.
    if (FILLER_RE.test(t) || /^\(.+\)$/.test(t) || /^\S+-$/.test(t)) dropped.add(i)
  })

  // Stutter duplicates ("matter of fact... fact, if"): the same word repeated
  // across a real pause is a restart, not emphasis — drop the FIRST take.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')
  for (let i = 0; i + 1 < words.length; i++) {
    if (dropped.has(i) || dropped.has(i + 1)) continue
    const a = norm(words[i].text)
    if (a.length >= 3 && a === norm(words[i + 1].text) && words[i + 1].start - words[i].end >= 0.25) {
      dropped.add(i)
    }
  }

  const kept = words.filter((_, i) => !dropped.has(i))
  if (!kept.length) return [{ start: 0, end: sourceDuration }]

  // Group kept words into segments wherever the gap is small enough.
  const segments: KeepSegment[] = []
  let cur: KeepSegment = { start: kept[0].start, end: kept[0].end }
  for (let k = 1; k < kept.length; k++) {
    const w = kept[k]
    if (w.start - cur.end > P.gapCut) {
      segments.push(cur)
      cur = { start: w.start, end: w.end }
    } else {
      cur.end = Math.max(cur.end, w.end)
    }
  }
  segments.push(cur)

  // Pad, clamp, merge, and drop fragments.
  const padded = segments.map(s => ({
    start: Math.max(0, s.start - P.padding),
    end: Math.min(sourceDuration, s.end + P.padding),
  }))
  const merged: KeepSegment[] = []
  for (const s of padded) {
    const last = merged[merged.length - 1]
    if (last && s.start - last.end < P.mergeGap) last.end = Math.max(last.end, s.end)
    else merged.push({ ...s })
  }

  // Carve refinement. Two kinds of interval get cut OUT of the merged
  // segments — crucially AFTER padding and merging, so neither step can
  // bridge them back in (the bug that let mid-sentence "uh"s survive):
  //   1. dropped-word spans (fillers, retakes, stutters) — carved at word
  //      boundaries with a hair of margin
  //   2. energy-detected silences the transcript hid inside a word span
  // A dropped run is carved from just before its first token to just before
  // the NEXT kept word — Scribe times fillers tight (an audible "uh," can be
  // an 0.08s token) and the hesitation air after one belongs to it, so
  // carving only the token span leaves both the tail and the dead air behind.
  const droppedSpans: Array<[number, number]> = []
  for (let i = 0; i < words.length; i++) {
    if (!dropped.has(i)) continue
    let j = i
    while (j + 1 < words.length && dropped.has(j + 1)) j++
    let prevKept = i - 1
    while (prevKept >= 0 && dropped.has(prevKept)) prevKept--
    let nextKept = j + 1
    while (nextKept < words.length && dropped.has(nextKept)) nextKept++
    const carveStart = Math.max(
      words[i].start - 0.02,
      prevKept >= 0 ? words[prevKept].end + 0.03 : 0,
    )
    const carveEnd = Math.min(
      nextKept < words.length ? words[nextKept].start - 0.04 : sourceDuration,
      words[j].end + 1.0,
    )
    if (carveEnd - carveStart >= 0.06) droppedSpans.push([carveStart, carveEnd])
    i = j
  }
  const carves: Array<[number, number, number]> = [
    // [start, end, minInteriorOverlap]
    ...droppedSpans.map(([a, b]): [number, number, number] => [a, b, 0.04]),
    ...(opts.silences ?? []).map(([a, b]): [number, number, number] => [a + P.padding, b - P.padding, P.silenceSplit]),
  ]
  let pieces: KeepSegment[] = merged
  for (const [cStart, cEnd, minOverlap] of carves) {
    const next: KeepSegment[] = []
    for (const piece of pieces) {
      const overlapStart = Math.max(piece.start, cStart)
      const overlapEnd = Math.min(piece.end, cEnd)
      if (overlapEnd - overlapStart > minOverlap) {
        if (overlapStart - piece.start > 0.05) next.push({ start: piece.start, end: overlapStart })
        if (piece.end - overlapEnd > 0.05) next.push({ start: overlapEnd, end: piece.end })
      } else {
        next.push(piece)
      }
    }
    pieces = next
  }

  const final = pieces.filter(s => s.end - s.start >= P.minSegment)
  return final.length ? final : [{ start: 0, end: sourceDuration }]
}

// Viral pace: the references punch the framing every ~2-2.5 seconds even while
// the speech runs continuously. Long keep-segments get split into sub-segments
// (pure source-time arithmetic — the edited timeline is unchanged) so every
// join becomes a silent hard cut where the zoom level jumps, reading as a
// multi-angle edit. Chunk lengths rotate so the rhythm never turns metronomic.
export function splitSegmentsForPunch(segments: KeepSegment[], variation = 0): KeepSegment[] {
  const CHUNKS = [2.4, 1.9, 2.9]
  const out: KeepSegment[] = []
  let beat = variation
  for (const seg of segments) {
    let cursor = seg.start
    while (seg.end - cursor > 3.6) {
      const len = CHUNKS[beat++ % CHUNKS.length]
      out.push({ start: cursor, end: cursor + len })
      cursor += len
    }
    out.push({ start: cursor, end: seg.end })
  }
  return out
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
      // Fillers/sound-events/stutters are cut from the timeline plan, but
      // segment edges can graze them — never let them back into the captions.
      const t = w.text.trim()
      if (FILLER_RE.test(t) || /^\(.+\)$/.test(t) || /^\S+-$/.test(t)) continue
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
  // The viral style reads best with longer two-tier pages (kicker + accent),
  // so v5 raises this to 6; everything else keeps the snappy 4-word pages.
  maxWords = 4,
  // 'sentence' keeps the transcriber's natural casing (the Dan Koe look);
  // 'title' capitalizes every word (the Ryan/UGC look).
  caseStyle: 'title' | 'sentence' = 'title',
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
      const t = caseStyle === 'title' ? titleCase(w.text.trim()) : w.text.trim()
      return { t, accent: accents.has(clean) }
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
    // Stutter fragments the transcriber marks with a trailing dash ("Qual-")
    // stay in the audio but never in the captions — on screen they read as a
    // typo, not a human restart.
    if (/^\S+-$/.test(w.text.trim())) continue
    const prev = page[page.length - 1]
    // New page on: segment change, notable pause, sentence end, or the word cap.
    if (prev && (
      w.segmentIndex !== prev.segmentIndex ||
      w.start - prev.end > 0.5 ||
      /[.!?]$/.test(prev.text) ||
      page.length >= maxWords
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
      // Emphasis pulls a punch-in; otherwise alternate so consecutive segments
      // feel like different "shots" (the multi-angle stand-in). EVERY segment
      // moves — a static beat between two zooms reads as a dropped frame, and
      // the references never hold a dead framing. The variation seed shifts
      // the pattern so versions move differently.
      const beat = (i + variation) % 3
      zoom = hasEmphasis ? 'in' : (beat === 1 ? 'out' : 'in')
    }
    offset += duration
    return { srcStart: seg.start, duration, zoom }
  })
}

// ── Viral caption planning (v5) ───────────────────────────────────────────────
// Decorates the deterministic caption pages with the reference edit's two-tier
// grammar: per page, ONE contiguous phrase becomes the big accent line (italic
// serif, or heavy block for times/numbers) while the surrounding words stay as
// the small sans kicker/tail. An LLM picks the phrase (it's a judgement call);
// the code validates indices and owns all styling decisions. Falls back to the
// Gemini emphasis-token heuristic so v5 never blocks on the LLM.

// Glue words that should never carry the accent on their own.
const GLUE_RE = /^(the|a|an|and|or|but|of|to|in|on|at|for|is|are|was|were|it|its|it's|i|i'm|you|your|we|so|like|that|this|with|my|me|be|have|has|had|can|will|just|kind|really)$/i

function fallbackAccentRanges(pages: CaptionPage[], profile: ContentProfile | null): void {
  const accents = accentTokens(profile)
  for (const page of pages) {
    if (page.accentRange) continue
    let from = -1
    let to = -1
    page.words.forEach((w, i) => {
      const clean = w.t.toLowerCase().replace(/[^a-z0-9$%.]/gi, '')
      if (accents.has(clean) || /\d/.test(clean)) {
        if (from === -1) from = i
        to = i
      }
    })
    // Last resort: accent the trailing content words so the two-tier look
    // still shows up (the reference styles nearly every page).
    if (from === -1) {
      const content = page.words
        .map((w, i) => ({ i, clean: w.t.toLowerCase().replace(/[^a-z0-9$%.']/gi, '') }))
        .filter(x => x.clean.length >= 3 && !GLUE_RE.test(x.clean))
      if (content.length) {
        to = content[content.length - 1].i
        from = to
        // Extend left over adjacent content words (max 3-word accent).
        for (let k = content.length - 2; k >= 0 && to - content[k].i <= 2 && content[k].i === from - 1; k--) {
          from = content[k].i
        }
      }
    }
    if (from !== -1) page.accentRange = [from, Math.min(to, from + 3)]
  }
}

export async function planViralCaptions(
  pages: CaptionPage[],
  profile: ContentProfile | null,
  variation = 0,
): Promise<void> {
  if (!pages.length) return

  const numbered = pages
    .map((p, i) => `${i}: ${p.words.map(w => w.t).join(' | ')}`)
    .join('\n')
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      // Long clips can carry 50+ pages; the picks array must never truncate.
      max_tokens: 3000,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are styling captions for a viral podcast clip. Each numbered line below is one',
          'caption page; words are separated by " | " (word indices start at 0).',
          'For each page, pick the ONE contiguous phrase that deserves visual emphasis — the',
          'concrete noun phrase, number, time, or payoff the sentence is really about',
          '(e.g. in "What\'s the | 30,000ft | view | on" pick "30,000ft"; in "Lower | Your |',
          'Resting | Heart | Rate" pick "Resting Heart Rate"). Filler-only pages get no pick.',
          'Most pages SHOULD get a pick — that is this style\'s signature. Spans are 1-4 words.',
          '',
          numbered,
          '',
          'Return JSON only: {"picks":[{"p":pageIndex,"a":firstWordIndex,"b":lastWordIndex},...]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ picks?: Array<{ p?: number; a?: number; b?: number }> }>(raw)
    let applied = 0
    for (const pick of parsed.picks ?? []) {
      const { p, a, b } = pick
      if (!Number.isInteger(p) || !Number.isInteger(a) || !Number.isInteger(b)) continue
      const page = pages[p as number]
      if (!page) continue
      if ((a as number) < 0 || (b as number) >= page.words.length || (b as number) < (a as number)) continue
      if ((b as number) - (a as number) > 3) continue
      page.accentRange = [a as number, b as number]
      applied++
    }
    // The two-tier look IS the identity — if the model under-delivered, top up
    // the unstyled pages heuristically instead of leaving them plain.
    if (applied < pages.length * 0.5) fallbackAccentRanges(pages, profile)
  } catch (e) {
    console.warn('[edit-plan] viral accent planning failed, using emphasis heuristic:', (e as Error).message)
    fallbackAccentRanges(pages, profile)
  }

  // Styling is deterministic code, never the model: times/numbers get the heavy
  // block treatment with the orange/violet/gradient rotation; everything else
  // gets the italic serif with gold dominant (like the reference). The variation
  // seed shifts both rotations so multi-version runs color differently.
  const SERIF_COLORS: ViralAccentColor[] = ['gold', 'gold', 'copper', 'orange']
  const BLOCK_COLORS: ViralAccentColor[] = ['orange', 'gradient', 'purple']
  let serifBeat = variation
  let blockBeat = variation
  for (const page of pages) {
    if (!page.accentRange) continue
    const [from, to] = page.accentRange
    const text = page.words.slice(from, to + 1).map(w => w.t).join(' ')
    if (/\d/.test(text)) {
      page.accentFont = 'block'
      page.accentColor = BLOCK_COLORS[blockBeat++ % BLOCK_COLORS.length]
    } else {
      page.accentFont = 'serif'
      page.accentColor = SERIF_COLORS[serifBeat++ % SERIF_COLORS.length]
    }
  }

  // Positions move in RUNS of pages (the reference holds a spot for a beat,
  // then relocates), not on every page — per-page rotation reads as churn.
  // The run is FACE-AWARE (the same profile signal v4 uses): it only rotates
  // through bands the face does not occupy, so a relocation never lands on
  // the speaker. 'mid' (top 44%) IS the face band for a centered talking
  // head — it only enters the rotation when the face sits clearly high or
  // low in frame. Tight framing leaves no safe band to relocate to, so it
  // holds the one furthest from the face, like v4's stable home.
  const RUN_POSITIONS: Array<CaptionPage['position']> =
    profile?.faceFraming === 'tight'
      ? (profile?.faceArea === 'lower' ? ['high'] : ['low'])
      : profile?.faceArea === 'upper' ? ['low', 'mid', 'low']
      : profile?.faceArea === 'lower' ? ['high', 'mid', 'high']
      // Centered face (the common talking-head framing): the top band is the
      // only spot fully clear of the person, so it anchors the rotation.
      : ['high', 'low', 'high']
  pages.forEach((page, i) => {
    page.position = RUN_POSITIONS[(Math.floor(i / 3) + variation) % RUN_POSITIONS.length]
  })

  // Hook: the reference opens with the caption sitting BEHIND the speaker in a
  // muted copper serif. Mark every page inside the first ~2.8s; the renderer
  // only honors the flag when a subject matte was actually staged.
  for (const page of pages) {
    if (page.start < 2.8) {
      page.behind = true
      page.position = 'mid'
      if (page.accentRange) {
        page.accentFont = 'serif'
        page.accentColor = 'copper'
      }
    }
  }
}

// ── Eubank caption planning (v4) ──────────────────────────────────────────────
// The reference's caption grammar (see lib/V4-EUBANK-PLAN.md): clean sentence-
// case pages whose emphasis words are BOLD and color-coded by MEANING — green
// for wins/positives, red for warnings/negatives, gold for neutral emphasis.
// Short punchlines render big and centered. An LLM makes the semantic calls
// (which words, which tone, which pages punch); the code validates everything
// and owns position/alignment, so a failed call still yields styled captions.

export async function planEubankCaptions(
  pages: CaptionPage[],
  profile: ContentProfile | null,
  variation = 0,
): Promise<void> {
  if (!pages.length) return

  const numbered = pages
    .map((p, i) => `${i}: ${p.words.map(w => w.t).join(' | ')}`)
    .join('\n')
  let applied = 0
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      max_tokens: 3000,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are styling captions for a premium fitness-creator edit. Each numbered line below',
          'is one caption page; words are separated by " | " (word indices start at 0).',
          'For each page pick the ONE contiguous phrase (1-3 words) that deserves emphasis — the',
          'concrete noun, number, or payoff the sentence is about — plus its semantic tone:',
          '- "good": wins, growth, positives ("outperform", "winners", "$5,000")',
          '- "bad": failures, warnings, negatives ("mediocre", "burnt out", "worst mistake")',
          '- "gold": neutral emphasis — key concepts that are neither win nor warning',
          'Filler-only pages get no pick. Most pages SHOULD get a pick.',
          'Additionally flag up to 3 pages total as "punch": short punchline pages (<=3 words,',
          'a payoff or verdict like "every single time.") that should render big and centered.',
          '',
          numbered,
          '',
          'Return JSON only:',
          '{"picks":[{"p":pageIndex,"a":firstWordIndex,"b":lastWordIndex,"tone":"good|bad|gold","punch":false},...]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ picks?: Array<{ p?: number; a?: number; b?: number; tone?: string; punch?: boolean }> }>(raw)
    let punches = 0
    for (const pick of parsed.picks ?? []) {
      const { p, a, b } = pick
      if (!Number.isInteger(p) || !Number.isInteger(a) || !Number.isInteger(b)) continue
      const page = pages[p as number]
      if (!page) continue
      if ((a as number) < 0 || (b as number) >= page.words.length || (b as number) < (a as number)) continue
      if ((b as number) - (a as number) > 2) continue
      const tone: CaptionWord['tone'] = pick.tone === 'good' || pick.tone === 'bad' ? pick.tone : 'gold'
      for (let i = a as number; i <= (b as number); i++) {
        page.words[i].accent = true
        page.words[i].tone = tone
      }
      // Punch pages: only genuinely short pages, capped, never the very first
      // page (the hook caption should read before the style starts shouting).
      if (pick.punch && punches < 3 && (p as number) > 0 && page.words.length <= 3) {
        page.big = true
        punches++
      }
      applied++
    }
  } catch (e) {
    console.warn('[edit-plan] eubank caption planning failed, using emphasis heuristic:', (e as Error).message)
  }

  // Heuristic top-up: pages the model skipped still get the profile's emphasis
  // tokens (gold) so the identity holds without the LLM.
  if (applied < pages.length * 0.4) {
    const accents = accentTokens(profile)
    for (const page of pages) {
      if (page.words.some(w => w.accent)) continue
      for (const w of page.words) {
        const clean = w.t.toLowerCase().replace(/[^a-z0-9$%.]/gi, '')
        if (accents.has(clean) || /\d/.test(clean)) {
          w.accent = true
          w.tone = 'gold'
        }
      }
    }
  }

  // Position is deliberately STABLE (feedback: per-page position churn read as
  // messy). Regular pages hold ONE flattering band — low-center, or high when
  // the face sits low in frame — punch pages pop center, and the pipeline
  // moves pages to the upper third only while full-screen B-roll owns the
  // frame. Movement is the exception, never the rhythm.
  const home: CaptionPage['position'] = profile?.faceArea === 'lower' ? 'high' : 'low'
  pages.forEach(page => {
    page.position = page.big ? 'mid' : home
  })
}

// Pick which talking-head segments shrink into the white inset card. The
// reference does this on conversational asides (~every 10-12s, 1.5-3.5s long).
// Deterministic: no LLM, seeded by the variation.
export function planInsetSegments(
  segments: SegmentPlan[],
  broll: Array<{ start: number; duration: number }>,
  editedDuration: number,
  variation = 0,
): void {
  const maxInsets = editedDuration > 30 ? 3 : editedDuration > 18 ? 2 : 1
  let placed = 0
  let lastInsetEnd = -Infinity
  let offset = 0
  const offsets = segments.map(s => { const o = offset; offset += s.duration; return o })

  for (let n = 0; n < segments.length && placed < maxInsets; n++) {
    // Rotate the scan start so different variations inset different beats, but
    // never the opening hook segment.
    const i = 1 + ((n + variation) % Math.max(1, segments.length - 1))
    const seg = segments[i]
    if (!seg || seg.frame) continue
    if (seg.duration < 1.5 || seg.duration > 4.5) continue
    const segStart = offsets[i]
    if (segStart < 6 || segStart - lastInsetEnd < 6) continue
    // Don't fight a B-roll cover for the same moment.
    const overlaps = broll.some(b => segStart < b.start + b.duration && segStart + seg.duration > b.start)
    if (overlaps) continue
    seg.frame = 'inset'
    lastInsetEnd = segStart + seg.duration
    placed++
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function buildEditPlan(
  words: WordTimestamp[],
  sourceDuration: number,
  profile: ContentProfile | null,
  variation = 0,
  opts: { pace?: 'natural' | 'punchy'; maxPageWords?: number; caseStyle?: 'title' | 'sentence'; silences?: Array<[number, number]> } = {},
): Promise<EditPlan> {
  let segments = await planKeepSegments(words, sourceDuration, {
    tight: opts.pace === 'punchy',
    silences: opts.silences,
  })
  // Punchy (viral) pace: split long takes so the framing can jump every ~3s.
  if (opts.pace === 'punchy') segments = splitSegmentsForPunch(segments, variation)
  const editedWords = remapToEditedTimeline(words, segments)
  const pages = buildCaptionPages(editedWords, profile, variation, opts.maxPageWords ?? 4, opts.caseStyle ?? 'title')
  const plans = planZooms(segments, editedWords, profile, variation)
  const editedDuration = plans.reduce((a, s) => a + s.duration, 0)
  console.log(`[edit-plan] ${segments.length} segments, ${pages.length} caption pages, ${sourceDuration.toFixed(1)}s -> ${editedDuration.toFixed(1)}s`)
  return { segments: plans, pages, editedWords, editedDuration }
}
