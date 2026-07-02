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

export type CaptionStyle = 'serif' | 'editorial' | 'impact'
export type BrollMedia = 'image' | 'video' | 'mixed'

export interface RemotionVariantIdentity {
  captionStyle: CaptionStyle
  brollMedia: BrollMedia
}

// The per-variant creative identity. Caption style never changes for a variant;
// that's what makes v4 vs v5 vs v6 recognizably different products.
export const REMOTION_IDENTITIES: Record<string, RemotionVariantIdentity> = {
  'our-v4': { captionStyle: 'editorial', brollMedia: 'image' },  // photo cards, calm amber accents
  'our-v5': { captionStyle: 'impact', brollMedia: 'video' },     // video B-roll, condensed caps
  'our-v6': { captionStyle: 'serif', brollMedia: 'mixed' },      // the UGC reference look
}

const FALLBACK_IDENTITY: RemotionVariantIdentity = { captionStyle: 'serif', brollMedia: 'mixed' }

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

export interface RenderKit {
  captionStyle: CaptionStyle
  brollMedia: BrollMedia
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
  const transitionStyle = seed !== undefined
    ? transitionStyleFor(seed)
    : pickTransitionSmart(profile)
  return {
    captionStyle: identity.captionStyle,
    brollMedia: identity.brollMedia,
    transitionStyle,
    variation,
  }
}

// ── Event-driven SFX plan ─────────────────────────────────────────────────────

export interface SfxCue {
  start: number        // edited-timeline seconds
  category: SfxCategory
  volume: number
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
}
const COVER_OUT: SfxCategory[] = ['whoosh-airy', 'whoosh']
const CARD_IN: SfxCategory[] = ['shutter', 'shutter-soft', 'pop']
const EMPHASIS: SfxCategory[] = ['pop', 'flash-pop']

export function planSfxCues(
  broll: BrollItem[],
  pages: CaptionPage[],
  transitionStyle: TransitionStyle,
  seed: number,
): SfxCue[] {
  const rnd = mulberry32(seed)
  const pick = (arr: SfxCategory[]) => arr[Math.floor(rnd() * arr.length)]
  const cues: SfxCue[] = []

  for (const b of broll) {
    if (b.layout === 'cover') {
      // Transition into the cover, and a softer release coming back out.
      cues.push({ start: Math.max(0, b.start - 0.08), category: pick(COVER_IN[transitionStyle]), volume: 0.3 })
      cues.push({ start: b.start + b.duration - 0.12, category: pick(COVER_OUT), volume: 0.2 })
    } else {
      cues.push({ start: Math.max(0, b.start - 0.04), category: pick(CARD_IN), volume: 0.38 })
    }
  }

  // Emphasis pops: ONLY pages whose accent words carry real numbers (the stats
  // that deserve a beat), capped at two per video so it never reads as random.
  const numberPages = pages.filter(p => p.words.some(w => w.accent && /\d/.test(w.t)))
  for (const p of numberPages.slice(0, 2)) {
    cues.push({ start: p.start, category: pick(EMPHASIS), volume: 0.12 })
  }

  return cues.sort((a, b) => a.start - b.start)
}
