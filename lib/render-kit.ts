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

export type CaptionStyle = 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie' | 'eubank' | 'glow'
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
  grade?: 'cinematic' | 'warm'    // subtle segment-level color grade
  hookSpotlight?: boolean         // Julie's opening focus: dark edges, bright subject
  handheld?: boolean              // organic position/rotation drift on every shot
  // AI-generated editorial collage scenes (Vox-style layered cutouts, kie.ai)
  // replacing some stock covers — see lib/collage-scenes.ts. v7 test flag.
  collageScenes?: boolean
  // Max-motion mode (v7 test): denser cutaway cadence, more collage scenes,
  // tighter talking-head gaps — the edit should feel like it never sits still.
  denseMotion?: boolean
  // Drop the opening koe TITLE graphic (glowing serif hook + red rotating word).
  // v7 uses viral captions that carry their own hook, so the title double-stacks.
  hideTitleGraphic?: boolean
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
    graphics: 'eubank', grade: 'warm', handheld: true,
  },
  // RYAN — viral podcast (modeled on "NEWEST viral editing style"): two-tier
  // captions (white sans + big gold italic serif / heavy block numbers),
  // full-screen video B-roll with designed poster cards, slide-push
  // transitions, white inset beats, matte behind the hook caption.
  'our-v5': {
    captionStyle: 'viral', brollMedia: 'viral', lockedTransition: 'slide',
    pace: 'punchy', maxPageWords: 6, captionCase: 'title',
    insets: true, textBehindHook: true, designedCards: true,
    grade: 'warm',
  },
  // DAN KOE — cinematic (modeled on "Dan Koe Sample.mp4"): dark moody grade,
  // tiny sentence-case captions, red-line name/CTA tag, full-screen video
  // B-roll at the adaptive v5 density (blur dissolves + the same peak-aligned
  // whooshes), and context-driven glowing graphics on top (floating serif
  // title with red rotating subtitle word, bright/dim word lists, red venn
  // circles, ambient rings on emphasis moments).
  'our-v6': {
    // GLOW caption look: sentence-case phrases that build word by word in a
    // heavy rounded sans, keywords highlighted in a bright glowing sky-blue
    // (see GlowCaptionPage). Accent words come from the shared viral/julie LLM
    // picker (motion-renderer maps them to word.accent). No on-screen graphics —
    // the reference is captions over footage + B-roll only.
    captionStyle: 'glow', brollMedia: 'viral', lockedTransition: 'blur',
    pace: 'punchy', maxPageWords: 5, captionCase: 'sentence',
    insets: false, textBehindHook: false, designedCards: false,
    grade: 'cinematic',
  },
  // V7 TEST — AI-generated collage scenes in MAX-MOTION trim: dense cutaway
  // cadence, 5 collage scenes per video, handheld drift so no frame ever sits
  // still. Captions are the v5 VIRAL system (two-tier white sans + gold italic
  // serif accents — per feedback, the caption look Daniel prefers) over the
  // Koe dark grade + glowing graphics. When approved, fold into v6.
  'our-v7': {
    captionStyle: 'viral', brollMedia: 'viral', lockedTransition: 'blur',
    pace: 'punchy', maxPageWords: 6, captionCase: 'title',
    insets: false, textBehindHook: false, designedCards: false,
    graphics: 'koe', grade: 'cinematic', handheld: true,
    collageScenes: true, denseMotion: true, hideTitleGraphic: true,
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

// A B-roll beat gets ONE sound, on the way in. The exit gets none: returning to
// the talking head is not an event the viewer needs announced, and the old exit
// whoosh was on its own roughly a third of every render's cue count.
//
// CARD_IN is down to 'pop' — 'shutter' and 'shutter-soft' were cut from the
// library, and a mechanical shutter never suited a card that simply fades up.
const CARD_IN: SfxCategory[] = ['pop']
const EMPHASIS: SfxCategory[] = ['pop', 'flash-pop']

// Every authored volume below is an APPARENT level: sfx-stage.ts trims each
// file toward LOUDNESS_TARGET_DB before applying it, so 0.20 sounds like 0.20
// whichever file the allocator happens to pick.
const VOL = {
  coverIn: 0.20,      // the single B-roll entrance accent
  designedIn: 0.20,   // designed poster card / v7 collage scene landing
  splitIn: 0.16,
  panelIn: 0.16,
  cardIn: 0.20,
  insetIn: 0.14,
  click: 0.10,        // accent-word taps
  emphasis: 0.10,
} as const

const MAX_CLICKS = 3        // accent-word clicks per video (was 8)
const CLICK_MIN_GAP = 2.5   // seconds between them (was 1.2)

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
// (COVER_OUT_FRAMES lived here to back-time the cover EXIT whoosh. Exits are
// silent now, so nothing needs the exit animation's length.)
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
      if (b.design || b.collage) {
        // The poster card / collage scene lands on a single soft hit. This used
        // to be a three-sound stack (riser + boom + click) firing on one frame —
        // the riser alone measured ~15 dB hotter than anything else in the mix.
        cues.push({ start: Math.max(0, b.start - 0.05), peakAt: b.start + 0.05, category: 'boom-soft', volume: VOL.designedIn })
      } else {
        cues.push({ start: Math.max(0, b.start - 0.08), peakAt: b.start + inPeak, category: pick(COVER_IN[style]), volume: VOL.coverIn })
      }
    } else if (b.layout === 'split') {
      // The stage slide + media rising from below: one airy swish on the way in.
      cues.push({ start: Math.max(0, b.start - 0.08), peakAt: b.start + 0.17, category: 'whoosh-airy', volume: VOL.splitIn })
    } else if (b.layout === 'panel') {
      // Translucent panel: one soft pop as the beat arrives. Carousels used to
      // fire a pop per pane — three taps in half a second read as a rattle.
      cues.push({ start: Math.max(0, b.start - 0.04), peakAt: b.start + 0.1, category: pick(CARD_IN), volume: VOL.panelIn })
    } else {
      cues.push({ start: Math.max(0, b.start - 0.04), category: pick(CARD_IN), volume: VOL.cardIn })
    }
  }

  // Viral insets: a whisper of air on the scale-in, nothing on the way out.
  for (const inset of insets) {
    cues.push({ start: Math.max(0, inset.start - 0.1), peakAt: inset.start + INSET_PEAK, category: 'whoosh-airy', volume: VOL.insetIn })
  }

  if (flavor === 'viral') {
    // Texture: a tiny digital click riding the accent-word scale pop — only on
    // pages that already carry a visual beat (poster pages over covers,
    // block-font times/numbers, the hook), never on every page. Kept clear of
    // transition whooshes so two sounds never fight, min 2.5s apart, capped at
    // three per video. It was eight, which made the click the most-repeated
    // sound in a v5 render and the reason the texture stopped reading as texture.
    const beatPages = pages
      .filter(p => p.accentRange && (p.big || p.accentFont === 'block' || p.behind))
      .sort((a, b) => a.start - b.start)
    let lastClick = -Infinity
    let clicks = 0
    for (const p of beatPages) {
      if (clicks >= MAX_CLICKS) break
      const accentAt = p.start + (p.accentRange![0] * 2) / 30
      if (accentAt - lastClick < CLICK_MIN_GAP) continue
      if (cues.some(c => Math.abs((c.peakAt ?? c.start) - accentAt) < 0.4)) continue
      cues.push({ start: accentAt, peakAt: accentAt + 0.02, category: 'click-digital', volume: VOL.click })
      lastClick = accentAt
      clicks++
    }
  } else {
    // Standard emphasis pops: ONLY pages whose accent words carry real numbers
    // (the stats that deserve a beat), capped at three per video.
    const numberPages = pages.filter(p => p.words.some(w => w.accent && /\d/.test(w.t)))
    for (const p of numberPages.slice(0, 3)) {
      cues.push({ start: p.start, category: pick(EMPHASIS), volume: VOL.emphasis })
    }
  }

  return cues.sort((a, b) => a.start - b.start)
}
