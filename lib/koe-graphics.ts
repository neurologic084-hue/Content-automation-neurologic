// ── Dan Koe graphics planner (v6) ─────────────────────────────────────────────
// The Koe template carries no stock B-roll: its visual interest comes from
// context-driven glowing graphics rendered by Remotion over the (dimmed)
// footage, modeled on "Dan Koe Sample.mp4":
//
//   title — the opening hook: glowing italic-serif line + grey sans subtitle
//           whose final word cycles in red ("Learning how to learn/think/earn")
//   list  — words stack in the air as the speaker enumerates them; the current
//           word is bright white, previous ones dim to grey
//   venn  — two glowing red circles with labels + inner words that slide
//           together until the intersection fills red (contrast → merge)
//
// An LLM finds the enumeration/contrast moments and quotes the copy from the
// transcript; the code validates times, sizes, and copy lengths. Title is
// deterministic (profile hook), so the video always opens with a graphic.

import { chatCompletion, MODELS } from './openrouter'
import { parseJsonLoose } from './json-loose'
import type { ContentProfile } from './video-analysis'
import type { EditedWord } from './edit-plan'
import type { SfxCue } from './render-kit'

export interface KoeGraphic {
  start: number      // edited-timeline seconds
  duration: number
  kind: 'title' | 'list' | 'venn'
  // Face-aware vertical placement: text blocks go in the band the face isn't in.
  placement?: 'top' | 'bottom'
  // title
  title?: string
  subtitleBase?: string      // "Learning how to"
  subtitleWords?: string[]   // ["learn", "think", "earn"] — cycled in red
  // list
  items?: string[]
  // Seconds (relative to start) each item appears — matched to the exact
  // moment the word is SPOKEN, never distributed evenly.
  itemAt?: number[]
  // venn
  left?: { label: string; items: string[] }
  right?: { label: string; items: string[] }
}

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)

export async function planKoeGraphics(
  editedWords: EditedWord[],
  duration: number,
  profile: ContentProfile | null,
  // Windows already claimed by B-roll covers — graphics never fight footage.
  busy: Array<{ start: number; duration: number }> = [],
): Promise<KoeGraphic[]> {
  const graphics: KoeGraphic[] = []
  // Put text where the face isn't: face high in frame → graphics low, else top.
  const placement: 'top' | 'bottom' = profile?.faceArea === 'upper' ? 'bottom' : 'top'

  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)

  // LLM pass: hook subtitle + enumeration/contrast moments, all quoted from
  // the speech. Best-effort — on failure the video still opens with a title.
  let raw: {
    subtitleBase?: string; subtitleWords?: string[]
    list?: { start?: number; items?: string[] }
    venn?: { start?: number; leftLabel?: string; leftItems?: string[]; rightLabel?: string; rightItems?: string[] }
  } = {}
  try {
    const out = await chatCompletion({
      model: MODELS.planner,
      temperature: 0.2,
      max_tokens: 700,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are planning minimal motion graphics for a dark, cinematic talking-head edit.',
          `Video duration ${duration.toFixed(1)}s. Transcript with word start times:`,
          timed,
          '',
          'Return JSON with:',
          '1. "subtitleBase" + "subtitleWords": a subtitle for the opening title card. base is a short',
          '   lead-in phrase (2-4 words) and subtitleWords are 2-3 single words that complete it in',
          '   rotation, capturing the video\'s promise (e.g. base "Learning how to", words',
          '   ["learn","think","earn"]). Ground it in what is actually said.',
          '2. "list": IF the speaker enumerates 3-4 short parallel things (e.g. "marketing, sales,',
          '   writing, speaking"), give {start: <time first item is spoken>, items: [...]} quoting the',
          '   spoken words (each item 1-2 words). Omit if no clean enumeration exists.',
          '3. "venn": IF the speaker CONTRASTS two archetypes/approaches and implies combining them,',
          '   give {start, leftLabel, leftItems, rightLabel, rightItems} — labels ≤3 words, 1-2 inner',
          '   items each, all grounded in the speech. Omit if no clean contrast exists.',
          'Never invent content. JSON only.',
        ].join('\n'),
      }],
    })
    raw = parseJsonLoose(out)
  } catch (e) {
    console.warn('[koe-graphics] planning failed, title-only graphics:', (e as Error).message)
  }

  // Title: always, from the profile hook (deterministic).
  const hook = profile?.suggestedHookTitle?.trim()
  if (hook) {
    const subtitleWords = Array.isArray(raw.subtitleWords)
      ? raw.subtitleWords.map(w => clip(w, 14)).filter(Boolean).slice(0, 3)
      : []
    graphics.push({
      start: 0.25,
      duration: Math.min(3.6, Math.max(2.6, duration * 0.08)),
      kind: 'title',
      placement,
      title: clip(hook, 42),
      subtitleBase: clip(raw.subtitleBase, 26) || undefined,
      subtitleWords: subtitleWords.length >= 2 ? subtitleWords : undefined,
    })
  }

  const fits = (start: number, dur: number) =>
    start > 4 && start + dur < duration - 1 &&
    !graphics.some(g => start < g.start + g.duration + 1.5 && start + dur > g.start - 1.5) &&
    !busy.some(b => start < b.start + b.duration + 0.8 && start + dur > b.start - 0.8)

  const list = raw.list
  if (list && typeof list.start === 'number' && Array.isArray(list.items)) {
    const listStart = list.start
    const items = list.items.map(i => clip(i, 16)).filter(Boolean).slice(0, 4)
    if (items.length >= 3) {
      // Anchor every item to the moment its first word is actually SPOKEN —
      // the LLM's start estimate drifts, and evenly-spread reveals read as
      // out-of-sync. Search the edited words around the estimate.
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')
      // Sequential search over the WHOLE transcript — the LLM's start estimate
      // drifts too much to trust as a window. Any of an item's words can
      // anchor it (the LLM paraphrases leading verbs); order must hold.
      const anchored: Array<number | null> = []
      let searchFrom = 0
      for (const item of items) {
        const tokens = item.split(/\s+/).map(norm).filter(t => t.length >= 3)
        const hit = editedWords.find(w => w.start >= searchFrom && tokens.includes(norm(w.text)))
        anchored.push(hit ? hit.start : null)
        if (hit) searchFrom = hit.start + 0.2
      }
      // The whole enumeration must sit inside a tight window to be real.
      const times = anchored.filter((t): t is number => t !== null)
      if (times.length >= 2 && times[times.length - 1] - times[0] > 16) anchored.fill(null)
      // Enough real anchors → interpolate the paraphrased ones between neighbors.
      const anchorCount = anchored.filter(t => t !== null).length
      const spokenTimes: number[] = []
      if (anchorCount >= Math.max(2, items.length - 1)) {
        for (let i = 0; i < anchored.length; i++) {
          if (anchored[i] !== null) { spokenTimes.push(anchored[i] as number); continue }
          const prev = spokenTimes[i - 1] ?? listStart
          const nextKnown = anchored.slice(i + 1).find(t => t !== null) as number | undefined
          spokenTimes.push(nextKnown !== undefined ? (prev + nextKnown) / 2 : prev + 0.8)
        }
      }
      if (spokenTimes.length === items.length) {
        const start = Number(Math.max(0, spokenTimes[0] - 0.35).toFixed(2))
        // Cap must exceed the last spoken reveal or the final item never shows.
        const dur = Math.min(12, spokenTimes[spokenTimes.length - 1] - start + 2.0)
        if (fits(start, dur)) {
          graphics.push({
            start, duration: dur, kind: 'list', placement, items,
            itemAt: spokenTimes.map(t => Number((t - start).toFixed(2))),
          })
        }
      } else {
        console.warn('[koe-graphics] list items not found at spoken times — skipping list graphic')
      }
    }
  }

  const venn = raw.venn
  if (venn && typeof venn.start === 'number' && venn.leftLabel && venn.rightLabel) {
    const dur = 5.2
    if (fits(venn.start, dur)) {
      graphics.push({
        start: Number(venn.start.toFixed(2)),
        duration: dur,
        kind: 'venn',
        placement,
        left: { label: clip(venn.leftLabel, 20), items: (venn.leftItems ?? []).map(i => clip(i, 14)).filter(Boolean).slice(0, 2) },
        right: { label: clip(venn.rightLabel, 20), items: (venn.rightItems ?? []).map(i => clip(i, 14)).filter(Boolean).slice(0, 2) },
      })
    }
  }

  // (Ambient rings were tried here and removed on feedback — they read as
  // clutter rather than the reference's intentional diagram moments.)

  console.log(`[koe-graphics] ${graphics.length} graphic(s): ${graphics.map(g => `${g.kind}@${g.start.toFixed(1)}s`).join(', ') || 'none'}`)
  return graphics.sort((a, b) => a.start - b.start)
}

// Event-driven SFX for the graphics, matched to the reference's sound design:
// airy whoosh on the title, a click per list item, whoosh on the venn draw and
// a deep whoosh at the merge.
export function planKoeSfxCues(graphics: KoeGraphic[]): SfxCue[] {
  const cues: SfxCue[] = []
  for (const g of graphics) {
    if (g.kind === 'title') {
      cues.push({ start: Math.max(0, g.start - 0.05), peakAt: g.start + 0.15, category: 'whoosh-airy', volume: 0.16 })
    } else if (g.kind === 'list') {
      // Clicks land exactly on each item's spoken reveal — first four only, so a
      // long list never turns into a typewriter.
      g.items?.slice(0, 4).forEach((_, i) => {
        const at = g.start + (g.itemAt?.[i] ?? 0)
        cues.push({ start: at, peakAt: at + 0.02, category: 'click-digital', volume: 0.10 })
      })
    } else if (g.kind === 'venn') {
      cues.push({ start: Math.max(0, g.start - 0.05), peakAt: g.start + 0.2, category: 'whoosh-airy', volume: 0.14 })
      // The merge lands at ~62% through (see KoeVenn timing in ShortEdit).
      const mergeAt = g.start + g.duration * 0.62
      cues.push({ start: mergeAt - 0.3, peakAt: mergeAt, category: 'whoosh-deep', volume: 0.16 })
    }
  }
  return cues
}
