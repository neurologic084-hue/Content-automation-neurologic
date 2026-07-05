// ── Eubank concept-graphics planner (v4) ──────────────────────────────────────
// The Alex Eubank grammar (lib/V4-EUBANK-PLAN.md): the edit VISUALIZES what the
// speaker says, the moment they say it. Five devices, all rendered by the
// Eubank pack in ShortEdit.tsx:
//
//   notes    — a spoken list builds as a Notes-app checklist card, one item per
//              spoken moment, yellow checkmark popping per line
//   equation — a comparison/priority claim becomes centered text ("Format > Concept")
//   crossout — do-this-not-that: the wrong option struck through, the right one
//              lands bold beneath it
//   cards    — a framework/verdict moment becomes translucent connected cards
//              over the dimmed, blurred speaker ("[ Winner ]" → labels)
//   keyword  — a key phrase flashes as clean white text as it's spoken
//
// Same design contract as the Koe planner: the LLM finds the moments and quotes
// the copy from the transcript; the CODE validates times, anchors every reveal
// to the words' real timings, caps density, and places graphics in the face-free
// band. Best-effort throughout — no graphics is a clean render, never a failure.

import { chatCompletion, MODELS } from './openrouter'
import { parseJsonLoose } from './json-loose'
import type { ContentProfile } from './video-analysis'
import type { EditedWord } from './edit-plan'
import type { SfxCue } from './render-kit'

export interface EubankGraphic {
  start: number      // edited-timeline seconds
  duration: number
  kind: 'notes' | 'equation' | 'crossout' | 'cards' | 'keyword' | 'hook'
  placement?: 'top' | 'bottom'
  title?: string             // notes header / quote text / cards verdict / method name
  items?: string[]           // notes items / cards labels
  itemAt?: number[]          // per-item reveal times (s, relative), spoken-synced
  eq?: { left: string; right: string }
  strike?: { wrong: string; right: string }
  icon?: string              // method scene icon key (EUBANK_ICONS in ShortEdit)
  // quote panel: which words inside `title` get the bold/colored treatment
  emphasis?: Array<{ word: string; tone?: 'good' | 'bad' | 'gold' }>
  stat?: string              // cards: spoken stat shown on the winner card ("1M views")
}

// Must mirror EUBANK_ICONS in ShortEdit.tsx.
const ICON_KEYS = ['brush', 'bulb', 'target', 'chart', 'pen', 'flame', 'dumbbell', 'clock', 'money', 'rocket'] as const

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)
// Word-boundary clip for anything that renders on screen — a mid-word
// character cut ("for already s") reads as a typo, never ship one.
const clipWords = (s: unknown, maxChars: number) => {
  const words = String(s ?? '').trim().split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) {
    if (out && `${out} ${w}`.length > maxChars) break
    out = out ? `${out} ${w}` : w.slice(0, maxChars)
  }
  return out
}
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')

// Anchor a copy string to the moment it's actually spoken, scanning forward
// from `searchFrom`. Multi-word copy must CLUSTER: at least two of its tokens
// within 4s of the candidate word — a lone match on a common word ("don't",
// "content") anchors phrases to the wrong breath entirely. Returns null when
// nothing matches — the caller drops or re-times the graphic, never guesses.
function anchorToSpeech(text: string, editedWords: EditedWord[], searchFrom: number): number | null {
  const tokens = [...new Set(text.split(/\s+/).map(norm).filter(t => t.length >= 3))]
  if (!tokens.length) return null
  const need = Math.min(2, tokens.length)
  for (let i = 0; i < editedWords.length; i++) {
    const w = editedWords[i]
    if (w.start < searchFrom) continue
    if (!tokens.includes(norm(w.text))) continue
    const seen = new Set([norm(w.text)])
    for (let j = i + 1; j < editedWords.length && editedWords[j].start - w.start < 4; j++) {
      const t = norm(editedWords[j].text)
      if (tokens.includes(t)) seen.add(t)
    }
    if (seen.size >= need) return w.start
  }
  return null
}

export async function planEubankGraphics(
  editedWords: EditedWord[],
  duration: number,
  profile: ContentProfile | null,
  // Windows already claimed by B-roll covers — graphics never fight footage.
  busy: Array<{ start: number; duration: number }> = [],
): Promise<EubankGraphic[]> {
  const graphics: EubankGraphic[] = []
  if (duration < 10 || editedWords.length < 15) return graphics

  // Text graphics go in the band the face ISN'T. Talking-head faces live in
  // the upper/middle bands almost always, so 'bottom' is the default — 'top'
  // only when the face genuinely sits low in frame.
  const placement: 'top' | 'bottom' = profile?.faceArea === 'lower' ? 'top' : 'bottom'
  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)

  let raw: {
    notes?: { title?: string; items?: string[] }
    equation?: { start?: number; left?: string; right?: string }
    crossout?: { start?: number; wrong?: string; right?: string; method?: string; icon?: string }
    cards?: { start?: number; title?: string; items?: string[]; stat?: string }
    quotes?: Array<{ start?: number; text?: string; emphasis?: Array<{ word?: string; tone?: string }> }>
  } = {}
  try {
    const out = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      max_tokens: 1200,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are planning on-screen concept graphics for a premium creator edit. The edit',
          'VISUALIZES what the speaker says, the moment they say it. This style is DENSE —',
          'aim to fill 4-5 of the devices below. Implicit moments count (a rejected approach',
          'is a crossout even without "don\'t"; two things that matter together are cards),',
          'but all COPY must come from the transcript wording. Only omit a device when',
          'genuinely nothing in the speech supports it.',
          `Video duration ${duration.toFixed(1)}s. Transcript with word start times:`,
          timed,
          '',
          'Return JSON with any of:',
          '1. "notes": the speaker enumerates or walks through 3-5 parallel things — give',
          '   {title: <2-4 word header for the list>, items: [<1-3 words each, as spoken>]}.',
          '2. "equation": the speaker values one thing over another (explicitly or implicitly) —',
          '   give {start, left, right} meaning "left > right" (each side 1-3 words, e.g. left',
          '   "Format", right "Concept" for "format is greater than concept").',
          '3. "crossout": the speaker rejects one approach and endorses another (do X not Y,',
          '   stop Y, "I don\'t want... I want...") — give',
          '   {start, wrong: <the rejected thing, 1-4 words>, right: <the endorsed thing, 1-4 words>,',
          `   icon: <the one of [${ICON_KEYS.join(', ')}] that best fits the topic>,`,
          '   method: <IF the speaker gives the technique a NAME of their own (e.g. "The 80/20',
          '   Method"), that name in Title Case, 2-4 words, quoted from their wording — else omit>}.',
          '4. "cards": the speaker names a framework/recipe/combination with 2-3 components,',
          '   even loosely ("concept plus hook") — give',
          '   {start, title: <1-2 word verdict like "Winner">, items: [<2-3 component names,',
          '   each 1-3 words>], stat: <IF the speaker states a result number near this moment',
          '   (views, followers, revenue), that figure exactly as spoken, <=12 chars — else omit>}.',
          '5. "quotes": up to 2 THESIS moments — the sentence that carries the video\'s core',
          '   claim or payoff, quoted verbatim (6-16 words): [{start, text,',
          '   emphasis: [{word, tone}]}] where emphasis lists the 2-4 single words inside the',
          '   text that deserve visual weight, each with tone "good" (wins/positives),',
          '   "bad" (failures/warnings), or "gold" (neutral key concept).',
          'Never invent content. JSON only.',
        ].join('\n'),
      }],
    })
    raw = parseJsonLoose(out)
  } catch (e) {
    console.warn('[eubank-graphics] planning failed, rendering without graphics:', (e as Error).message)
    return graphics
  }

  const fits = (start: number, dur: number) =>
    start > 2 && start + dur < duration - 1 &&
    !graphics.some(g => start < g.start + g.duration + 0.9 && start + dur > g.start - 0.9) &&
    !busy.some(b => start < b.start + b.duration + 0.8 && start + dur > b.start - 0.8)

  // notes — anchor every item to its spoken moment (same contract as Koe's list:
  // enough real anchors or the graphic is dropped, never evenly-spread reveals).
  const notes = raw.notes
  if (notes && Array.isArray(notes.items)) {
    const items = notes.items.map(i => clipWords(i, 22)).filter(Boolean).slice(0, 5)
    if (items.length >= 3) {
      const anchored: Array<number | null> = []
      let searchFrom = 0
      for (const item of items) {
        const at = anchorToSpeech(item, editedWords, searchFrom)
        anchored.push(at)
        if (at !== null) searchFrom = at + 0.2
      }
      const times = anchored.filter((t): t is number => t !== null)
      const windowOk = times.length < 2 || times[times.length - 1] - times[0] <= 18
      if (windowOk && times.length >= Math.max(2, items.length - 1)) {
        const spokenTimes: number[] = []
        for (let i = 0; i < anchored.length; i++) {
          if (anchored[i] !== null) { spokenTimes.push(anchored[i] as number); continue }
          const prev = spokenTimes[i - 1] ?? Math.max(0, (times[0] ?? 1) - 0.8)
          const nextKnown = anchored.slice(i + 1).find(t => t !== null) as number | undefined
          spokenTimes.push(nextKnown !== undefined ? (prev + nextKnown) / 2 : prev + 0.9)
        }
        const start = Number(Math.max(0, spokenTimes[0] - 0.5).toFixed(2))
        const dur = Math.min(10, spokenTimes[spokenTimes.length - 1] - start + 2.2)
        if (fits(start, dur)) {
          graphics.push({
            start, duration: dur, kind: 'notes', placement,
            title: clipWords(notes.title, 28) || 'Key Components',
            items,
            itemAt: spokenTimes.map(t => Number((t - start).toFixed(2))),
          })
        }
      } else {
        console.warn('[eubank-graphics] notes items not found at spoken times — skipping checklist')
      }
    }
  }

  // equation — re-anchor to the left word's spoken moment when findable.
  const eq = raw.equation
  if (eq && typeof eq.start === 'number' && eq.left && eq.right) {
    const left = clipWords(eq.left, 18)
    const right = clipWords(eq.right, 18)
    const at = anchorToSpeech(left, editedWords, Math.max(0, eq.start - 4)) ?? eq.start
    const start = Number(Math.max(0, at - 0.2).toFixed(2))
    const dur = 3.2
    if (left && right && fits(start, dur)) {
      graphics.push({ start, duration: dur, kind: 'equation', placement, eq: { left, right } })
    }
  }

  // crossout — the full method scene: anchored to the WRONG option being named
  // (the strike and swap follow the renderer's fixed rhythm). Icon validated
  // against the renderer's set; the method name is optional gold-script copy.
  const cx = raw.crossout
  if (cx && typeof cx.start === 'number' && cx.wrong && cx.right) {
    const wrong = clipWords(cx.wrong, 24)
    const right = clipWords(cx.right, 24)
    const at = anchorToSpeech(wrong, editedWords, Math.max(0, cx.start - 4)) ?? cx.start
    const start = Number(Math.max(0, at - 0.2).toFixed(2))
    const dur = 4.4
    if (wrong && right && fits(start, dur)) {
      // Gold script title: the named technique when the speaker gives one;
      // otherwise the video's hook in Title Case (max 4 words) — the scene's
      // crown piece should never be missing.
      const hookTitle = (profile?.suggestedHookTitle ?? '')
        .split(/\s+/).filter(Boolean).slice(0, 4)
        .map(w => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
        .join(' ')
      graphics.push({
        start, duration: dur, kind: 'crossout', placement,
        strike: { wrong, right },
        icon: (ICON_KEYS as readonly string[]).includes(cx.icon ?? '') ? cx.icon : undefined,
        title: cx.method ? clipWords(cx.method, 26) : (hookTitle ? clipWords(hookTitle, 26) : undefined),
      })
    }
  }

  // cards — the framework moment over the dimmed speaker. The stat only rides
  // along when it carries a digit (a spoken figure, never an invented one).
  const cards = raw.cards
  if (cards && typeof cards.start === 'number' && Array.isArray(cards.items)) {
    const items = cards.items.map(i => clipWords(i, 24)).filter(Boolean).slice(0, 3)
    if (items.length >= 2) {
      const at = anchorToSpeech(items[0], editedWords, Math.max(0, cards.start - 4)) ?? cards.start
      const start = Number(Math.max(0, at - 0.4).toFixed(2))
      const dur = Math.min(5.5, 2.6 + items.length * 1.1)
      if (fits(start, dur)) {
        const stat = clipWords(cards.stat, 12)
        graphics.push({
          start, duration: dur, kind: 'cards', placement,
          title: clipWords(cards.title, 18) || 'Winner',
          items,
          stat: /\d/.test(stat) ? stat : undefined,
        })
      }
    }
  }

  // quotes — the thesis sentence composed as a typographic panel. Whole words
  // only; duration scales with length so the build never outruns the speech.
  for (const q of (raw.quotes ?? []).slice(0, 2)) {
    if (typeof q?.start !== 'number' || !q.text) continue
    const qWords = String(q.text).trim().split(/\s+/).filter(Boolean).slice(0, 16)
    const text = qWords.join(' ')
    if (qWords.length < 4) continue
    const emphasis = (Array.isArray(q.emphasis) ? q.emphasis : [])
      .filter(e => typeof e?.word === 'string' && text.toLowerCase().includes(e.word.toLowerCase()))
      .slice(0, 4)
      .map(e => ({
        word: clip(e.word, 20),
        tone: (e.tone === 'good' || e.tone === 'bad' ? e.tone : 'gold') as 'good' | 'bad' | 'gold',
      }))
    const at = anchorToSpeech(text, editedWords, Math.max(0, q.start - 4)) ?? q.start
    const start = Number(Math.max(0, at - 0.15).toFixed(2))
    const dur = Math.min(5, Math.max(2.6, 1.3 + qWords.length * 0.26))
    if (fits(start, dur)) {
      graphics.push({ start, duration: dur, kind: 'keyword', placement, title: text, emphasis })
    }
  }

  // Guaranteed floor (feedback: too few animations on plain story clips): when
  // the LLM finds fewer than 3 device moments, top up with quote panels built
  // from the profile's emphasisPhrases — Gemini quoted those from the real
  // footage, and each still has to anchor to its spoken moment to run.
  if (graphics.length < 4) {
    for (const phrase of profile?.emphasisPhrases ?? []) {
      if (graphics.length >= 5) break
      const words = phrase.trim().split(/\s+/).filter(Boolean).slice(0, 16)
      if (words.length < 3) continue
      const text = words.join(' ')
      // Skip phrases an existing graphic already carries (2+ shared tokens) —
      // the same line twice reads as a glitch, not emphasis.
      const tokens = new Set(words.map(norm).filter(t => t.length >= 3))
      const dupe = graphics.some(g => {
        const gTokens = (g.title ?? '').split(/\s+/).map(norm)
        return gTokens.filter(t => tokens.has(t)).length >= 2
      })
      if (dupe) continue
      const at = anchorToSpeech(text, editedWords, 0)
      if (at === null) continue
      const start = Number(Math.max(0, at - 0.15).toFixed(2))
      const dur = Math.min(5, Math.max(2.6, 1.3 + words.length * 0.26))
      if (!fits(start, dur)) continue
      // Heuristic emphasis: the two longest content words carry gold weight.
      const emphasis = [...words]
        .filter(w => /\d/.test(w) || w.replace(/[^a-zA-Z]/g, '').length >= 5)
        .sort((a, b) => b.length - a.length)
        .slice(0, 2)
        .map(word => ({ word, tone: 'gold' as const }))
      graphics.push({ start, duration: dur, kind: 'keyword', placement, title: text, emphasis })
    }
  }

  // Opening hook (the reference's first seconds): title word doubled with the
  // cyan italic echo over falling dust. Deterministic — from the profile hook,
  // so the video always opens with a moment. Doesn't count against the cap.
  const hookWord = (profile?.suggestedHookTitle ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  const hook: EubankGraphic | null = hookWord
    ? { start: 0.25, duration: 2.8, kind: 'hook', title: clipWords(hookWord, 22) }
    : null

  // Density cap: at most 7 graphics per render, earliest first — the reference
  // averages a device every ~7s, but never two in the same breath.
  const sorted = [
    ...(hook ? [hook] : []),
    ...graphics.sort((a, b) => a.start - b.start).slice(0, 7),
  ]
  console.log(`[eubank-graphics] ${sorted.length} graphic(s): ${sorted.map(g => `${g.kind}@${g.start.toFixed(1)}s`).join(', ') || 'none'}`)
  return sorted
}

// Tactile per-event SFX, matched to the reference: pop + ding-per-check on the
// notes card, click on the equation with a soft boom as the ">" lands, shing on
// the cross-out strike, deep boom on the framework cards, pop on keywords.
export function planEubankSfxCues(graphics: EubankGraphic[]): SfxCue[] {
  const cues: SfxCue[] = []
  for (const g of graphics) {
    if (g.kind === 'notes') {
      cues.push({ start: Math.max(0, g.start - 0.05), peakAt: g.start + 0.12, category: 'pop', volume: 0.3 })
      g.items?.forEach((_, i) => {
        const at = g.start + (g.itemAt?.[i] ?? 0)
        cues.push({ start: at, peakAt: at + 0.05, category: 'ding', volume: 0.14 })
      })
    } else if (g.kind === 'equation') {
      cues.push({ start: Math.max(0, g.start - 0.05), peakAt: g.start + 0.1, category: 'click-digital', volume: 0.2 })
      // The ">" pops at ~0.5s in (renderer rhythm) — a soft boom under it.
      cues.push({ start: g.start + 0.3, peakAt: g.start + 0.55, category: 'boom-soft', volume: 0.26 })
    } else if (g.kind === 'crossout') {
      // Method scene: white-flash cut-in, shing as the strike draws (~32%),
      // a click as the replacement lands (~58%).
      cues.push({ start: Math.max(0, g.start - 0.08), peakAt: g.start + 0.06, category: 'flash-pop', volume: 0.3 })
      const strikeAt = g.start + g.duration * 0.32
      cues.push({ start: strikeAt - 0.15, peakAt: strikeAt + 0.1, category: 'shing', volume: 0.3 })
      const swapAt = g.start + g.duration * 0.58
      cues.push({ start: swapAt - 0.05, peakAt: swapAt + 0.05, category: 'click-digital', volume: 0.22 })
    } else if (g.kind === 'cards') {
      // Framework scene: boom on the blur-in, a pop per glowing label, a ding
      // as the winner card lands (~1.5s, matching the renderer's spring).
      cues.push({ start: Math.max(0, g.start - 0.1), peakAt: g.start + 0.15, category: 'boom-soft', volume: 0.32 })
      g.items?.slice(0, 3).forEach((_, i) => {
        const at = g.start + 0.25 + i * 0.75
        if (at < g.start + g.duration - 0.4) {
          cues.push({ start: at, peakAt: at + 0.06, category: 'pop', volume: 0.22 })
        }
      })
      const cardAt = g.start + 1.5
      if (cardAt < g.start + g.duration - 0.5) {
        cues.push({ start: cardAt - 0.05, peakAt: cardAt + 0.08, category: 'ding', volume: 0.14 })
      }
    } else if (g.kind === 'keyword') {
      // Quote panel: airy whoosh in; the words carry themselves.
      cues.push({ start: Math.max(0, g.start - 0.08), peakAt: g.start + 0.12, category: 'whoosh-airy', volume: 0.24 })
    } else if (g.kind === 'hook') {
      // Opening title: a soft sparkle pop as the doubled word lands.
      cues.push({ start: Math.max(0, g.start - 0.05), peakAt: g.start + 0.15, category: 'flash-pop', volume: 0.2 })
    }
  }
  return cues
}
