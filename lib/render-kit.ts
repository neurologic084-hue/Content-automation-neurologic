// ── Render kits for the Remotion-only variants (v4/v5/v6) ─────────────────────
// Each variant has a FIXED identity (caption style + B-roll flavor), while the
// style around it is SMART-RANDOMIZED per render: the transition is weighted by
// the footage's energy (flash is the house favorite), and the variation seed
// shuffles B-roll picks, caption positions, and zoom patterns.
//
// AUDIO DESIGN RULE — sound follows events, never a timer:
//   - plain jump cuts between segments are SILENT (real editors don't whoosh
//     every cut; the reference video hard-cuts)
//   - a full-screen B-roll cover gets a transition sound IN and a softer one
//     OUT — that's where the variant's transition style lives
//   - a B-roll card gets ONE entrance sound (shutter family)
//   - at most two emphasis pops, only on caption pages carrying real numbers
// Sounds are picked per-event from small families (seeded random), matched to
// the transition style, so no two events — or two renders — sound identical.

import type { ContentProfile } from './video-analysis'
import { transitionStyleFor, type SfxCategory, type TransitionStyle } from './sound-effects'
import type { BrollItem } from './broll'
import type { CaptionPage } from './edit-plan'

export type CaptionStyle = 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie' | 'eubank'
export type BrollMedia = 'image' | 'video' | 'mixed' | 'viral' | 'none'

// Per-variant TEMPLATE: every Remotion variant shares the same editing engine
// (audio cleaning, silence/filler cuts, transcription, captions, zooms, SFX,
// music) — a template only sets the creative knobs that make the variant a
// recognizable style. Add a new creator template by adding an entry here plus
// (if needed) a caption style / graphics pack in ShortEdit.tsx.
export interface RemotionVariantIdentity {
  captionStyle: CaptionStyle
  brollMedia: BrollMedia          // 'none' = no stock footage; graphics carry the visuals
  // When set, the variant always uses this transition — it IS the identity
  // (v5's slide push), so it's never smart-randomized away.
  lockedTransition?: TransitionStyle
  pace: 'natural' | 'punchy'      // punchy splits long takes into ~3s framing jumps
  maxPageWords: number            // caption page word cap
  captionCase: 'title' | 'sentence'
  insets: boolean                 // white inset-card beats (the Ryan grammar)
  textBehindHook: boolean         // subject matte behind the hook caption
  designedCards: boolean          // Ryan's poster-card covers (viral B-roll only)
  graphics?: 'koe' | 'eubank'     // context-driven Remotion animation pack
  grade?: 'cinematic'             // subtle segment-level color grade
  hookSpotlight?: boolean         // Julie's opening focus: dark edges, bright subject
  handheld?: boolean              // organic position/rotation drift on every shot
}

export const REMOTION_IDENTITIES: Record<string, RemotionVariantIdentity> = {
  // EUBANK — premium concept-driven edit (modeled on "Alex Eubank Sample.mp4",
  // see lib/V4-EUBANK-PLAN.md): clean Inter sentence-case captions with
  // SEMANTIC color accents (green = positive, red = negative, gold = neutral
  // emphasis) building word by word, big centered punchline pages, concept
  // graphics that visualize what's said (Notes-app checklist, on-screen
  // equation, cross-out, framework cards, quote panels), the viral full-screen
  // video B-roll system (same density/transitions as v5/v6, minus the poster
  // cards), ~3s punch-in framing jumps, constant handheld drift, and tactile
  // per-event SFX (pop/ding/shing/boom). Hard cuts between talking segments.
  'our-v4': {
    captionStyle: 'eubank', brollMedia: 'viral',
    pace: 'punchy', maxPageWords: 5, captionCase: 'sentence',
    insets: false, textBehindHook: false, designedCards: false,
    graphics: 'eubank', grade: 'cinematic', handheld: true,
  },
  // RYAN — viral podcast (modeled on "NEWEST viral editing style"): two-tier
  // captions (white sans + big gold italic serif / heavy block numbers),
  // full-screen video B-roll with designed poster cards, slide-push
  // transitions, white inset beats, matte behind the hook caption.
  'our-v5': {
    captionStyle: 'viral', brollMedia: 'viral', lockedTransition: 'slide',
    pace: 'punchy', maxPageWords: 6, captionCase: 'title',
    insets: true, textBehindHook: true, designedCards: true,
    grade: 'cinematic',
  },
  // DAN KOE — cinematic (modeled on "Dan Koe Sample.mp4"): dark moody grade,
  // tiny sentence-case captions, red-line name/CTA tag, full-screen video
  // B-roll at the adaptive v5 density (blur dissolves + the same peak-aligned
  // whooshes), and context-driven glowing graphics on top (floating serif
  // title with red rotating subtitle word, bright/dim word lists, red venn
  // circles, ambient rings on emphasis moments).
  'our-v6': {
    captionStyle: 'koe', brollMedia: 'viral', lockedTransition: 'blur',
    pace: 'punchy', maxPageWords: 3, captionCase: 'sentence',
    insets: false, textBehindHook: false, designedCards: false,
    graphics: 'koe', grade: 'cinematic',
  },
}

const FALLBACK_IDENTITY: RemotionVariantIdentity = {
  captionStyle: 'serif', brollMedia: 'mixed',
  pace: 'natural', maxPageWords: 4, captionCase: 'title',
  insets: false, textBehindHook: false, designedCards: false,
}

// Weighted smart-random transition pick. Flash is deliberately over-weighted
// (house preference); low-energy footage leans on the gentler blur dissolve.
export function pickTransitionSmart(
  profile: ContentProfile | null,
  rand: number = Math.random(),
): TransitionStyle {
  const energy = profile?.energy ?? 'medium'
  const weights: Array<[TransitionStyle, number]> =
    energy === 'high' ? [['flash', 0.45], ['punch', 0.35], ['blur', 0.2]]
    : energy === 'low' ? [['blur', 0.5], ['flash', 0.3], ['punch', 0.2]]
    : [['flash', 0.4], ['blur', 0.3], ['punch', 0.3]]
  let acc = 0
  for (const [style, w] of weights) {
    acc += w
    if (rand < acc) return style
  }
  return weights[weights.length - 1][0]
}

// The full template plus the per-render randomness — everything downstream
// reads its knobs from here.
export interface RenderKit extends RemotionVariantIdentity {
  transitionStyle: TransitionStyle
  variation: number
}

// Assemble the kit for one render. `seed` fixes the randomness for reproducible
// harness runs; omit it for the dashboard's fresh-every-time roll.
export function buildRenderKit(
  variantId: string,
  profile: ContentProfile | null,
  seed?: number,
): RenderKit {
  const identity = REMOTION_IDENTITIES[variantId] ?? FALLBACK_IDENTITY
  const variation = seed ?? Math.floor(Math.random() * 100_000)
  const transitionStyle = identity.lockedTransition
    ?? (seed !== undefined ? transitionStyleFor(seed) : pickTransitionSmart(profile))
  return { ...identity, transitionStyle, variation }
}

// ── Event-driven SFX plan ─────────────────────────────────────────────────────
// Built on the three-stage sound-design model:
//   stage 1 (motion)  — whooshes on every deliberate movement, PEAK-ALIGNED to
//                       the animation's point of maximum motion, never just
//                       started "at" the event
//   stage 2 (texture) — tiny digital clicks that ride text pops and landings,
//                       directing attention without reading as effects
//   stage 3 (payoff)  — a riser building INTO the designed poster card, its
//                       peak blended with a hit + click at the landing
// Plain jump cuts stay silent on purpose: real podcast edits (and the viral
// reference) hard-cut without audio, and whooshing every cut reads as amateur.

export interface SfxCue {
  start: number        // edited-timeline seconds (fallback if no peakAt)
  category: SfxCategory
  volume: number
  // When set, the staging step back-times the cue so the FILE'S LOUDEST SAMPLE
  // lands exactly here (start = peakAt - peakSec of the actual audio).
  peakAt?: number
}

// Deterministic tiny PRNG so a given seed always yields the same cue choices.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Sound families per event type, matched to the transition style so the audio
// and the visual read as one gesture.
const COVER_IN: Record<TransitionStyle, SfxCategory[]> = {
  flash: ['flash-pop', 'whoosh'],
  blur: ['whoosh-airy', 'whoosh'],
  punch: ['whoosh-snap', 'whoosh-deep'],
  slide: ['whoosh-snap', 'whoosh'],  // the viral push wants a tight whip swish
  zoom: ['whoosh-deep', 'whoosh'],   // zoom-through: deep sub-heavy rush
  whip: ['whoosh-snap', 'whoosh'],   // whip-pan: the tightest whip swish
}
// The transition-matched whoosh family, shared with the Submagic variants'
// cut-SFX pass (motion-renderer's mixTransitionSfx) so both pipelines speak
// the same sound grammar.
export function transitionSoundFamily(style: TransitionStyle): SfxCategory[] {
  return COVER_IN[style]
}

const COVER_OUT: SfxCategory[] = ['whoosh-airy', 'whoosh']
const CARD_IN: SfxCategory[] = ['shutter', 'shutter-soft', 'pop']
const EMPHASIS: SfxCategory[] = ['pop', 'flash-pop']

// Where each cover style's motion actually peaks, relative to the cover start.
// These mirror the easings in ShortEdit.tsx: the slide's strong ease-out moves
// fastest ~2 frames in; flash pops immediately; blur/punch resolve early.
const COVER_IN_PEAK: Record<TransitionStyle, number> = {
  slide: 0.07,
  flash: 0.03,
  blur: 0.05,
  punch: 0.05,
  zoom: 0.06,
  whip: 0.04,
}
const COVER_OUT_FRAMES = 7 / 30   // exit animation length in ShortEdit
const INSET_PEAK = 0.15           // 9-frame ease-in-out: max velocity mid-way

export function planSfxCues(
  broll: BrollItem[],
  pages: CaptionPage[],
  transitionStyle: TransitionStyle,
  seed: number,
  // Viral inset beats (scale-into-card moments) get a soft airy swish in/out.
  insets: Array<{ start: number; end: number }> = [],
  flavor: 'standard' | 'viral' = 'standard',
): SfxCue[] {
  const rnd = mulberry32(seed)
  const pick = (arr: SfxCategory[]) => arr[Math.floor(rnd() * arr.length)]
  const cues: SfxCue[] = []

  for (const b of broll) {
    // Per-cover transition (the eubank combo rotation) overrides the render's
    // global style — the sound must match the move the viewer actually sees.
    const style = b.transition ?? transitionStyle
    const inPeak = COVER_IN_PEAK[style]
    if (b.layout === 'cover') {
      const end = b.start + b.duration
      if (b.design) {
        // Stage 3 payoff: riser builds INTO the poster card (its peak IS the
        // landing), released by a soft hit with a click blended on top to
        // sharpen the riser's rough peak.
        cues.push({ start: Math.max(0, b.start - 1.8), peakAt: b.start, category: 'riser', volume: 0.16 })
        cues.push({ start: Math.max(0, b.start - 0.05), peakAt: b.start + 0.05, category: 'boom-soft', volume: 0.32 })
        cues.push({ start: b.start, peakAt: b.start + 0.03, category: 'click-digital', volume: 0.18 })
      } else {
        cues.push({ start: Math.max(0, b.start - 0.08), peakAt: b.start + inPeak, category: pick(COVER_IN[style]), volume: 0.3 })
      }
      cues.push({ start: end - 0.3, peakAt: end - COVER_OUT_FRAMES + inPeak, category: pick(COVER_OUT), volume: 0.2 })
    } else {
      cues.push({ start: Math.max(0, b.start - 0.04), category: pick(CARD_IN), volume: 0.38 })
    }
  }

  for (const inset of insets) {
    cues.push({ start: Math.max(0, inset.start - 0.1), peakAt: inset.start + INSET_PEAK, category: 'whoosh-airy', volume: 0.22 })
    cues.push({ start: Math.max(0, inset.end - 0.4), peakAt: inset.end - INSET_PEAK, category: 'whoosh-airy', volume: 0.16 })
  }

  if (flavor === 'viral') {
    // Stage 2 texture: a tiny digital click riding the accent-word scale pop —
    // only on the pages that already carry a visual beat (poster pages over
    // covers, block-font times/numbers, the hook), never on every page. Kept
    // clear of transition whooshes so two sounds never fight, min 1.2s apart,
    // capped at six per video.
    const beatPages = pages
      .filter(p => p.accentRange && (p.big || p.accentFont === 'block' || p.behind))
      .sort((a, b) => a.start - b.start)
    let lastClick = -Infinity
    let clicks = 0
    for (const p of beatPages) {
      if (clicks >= 8) break
      const accentAt = p.start + (p.accentRange![0] * 2) / 30
      if (accentAt - lastClick < 1.2) continue
      if (cues.some(c => Math.abs((c.peakAt ?? c.start) - accentAt) < 0.4)) continue
      cues.push({ start: accentAt, peakAt: accentAt + 0.02, category: 'click-digital', volume: 0.15 })
      lastClick = accentAt
      clicks++
    }
  } else {
    // Standard emphasis pops: ONLY pages whose accent words carry real numbers
    // (the stats that deserve a beat), capped at three per video.
    const numberPages = pages.filter(p => p.words.some(w => w.accent && /\d/.test(w.t)))
    for (const p of numberPages.slice(0, 3)) {
      cues.push({ start: p.start, category: pick(EMPHASIS), volume: 0.12 })
    }
  }

  return cues.sort((a, b) => a.start - b.start)
}
