// ── ShortEdit: the Remotion-only full edit (v4/v5/v6) ─────────────────────────
// One composition renders the entire edited short: cut segments of the source
// footage (silences/retakes already planned out), per-segment zooms, B-roll,
// event-driven SFX, and one of four caption identities.
//
// v6 serif / v4 editorial keep the original restrained grammar. v5 "viral" is
// modeled on the reference edit ("NEWEST viral editing style"): two-tier
// captions (small white sans kicker + big gold italic-serif accent, heavy block
// for times/numbers), full-screen video B-roll with slide-push transitions, one
// designed poster card, white inset-card beats, and — when a subject matte is
// staged — the hook caption sitting BEHIND the speaker.
//
// Design rule: RESTRAINT everywhere except where the identity demands a beat.

import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { loadFont } from '@remotion/fonts'
import { FONT_DATA } from '../fonts-data'

// Embedded data URI instead of staticFile() — the render-server font fetch
// hangs on long sandbox renders (delayRender "Loading font …" never clears).
const fontUrl = (file: string) => FONT_DATA[file]

const BASE_FONT = 'EditCapBase'
const ACCENT_FONT = 'EditCapAccent'
const BOLD_FONT = 'EditCapBold'
const IMPACT_FONT = 'EditCapImpact'
// Viral (v5) family: neutral grotesk for the small tiers (the reference's
// Helvetica-like base), upright display serif for poster headlines, and a
// heavy block grotesk for times/numbers.
const VIRAL_SANS = 'EditViralSans'
const VIRAL_SANS_STRONG = 'EditViralSansStrong'
const VIRAL_SERIF_UP = 'EditViralSerifUp'
const VIRAL_BLOCK = 'EditViralBlock'

loadFont({ family: BASE_FONT, url: fontUrl('Poppins-SemiBold.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: ACCENT_FONT, url: fontUrl('PlayfairDisplay-Italic.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: BOLD_FONT, url: fontUrl('Poppins-Bold.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: IMPACT_FONT, url: fontUrl('Anton-Regular.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: VIRAL_SANS, url: fontUrl('Inter-Medium.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: VIRAL_SANS_STRONG, url: fontUrl('Inter-SemiBold.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: VIRAL_SERIF_UP, url: fontUrl('PlayfairDisplay-Bold.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: VIRAL_BLOCK, url: fontUrl('ArchivoBlack-Regular.ttf'), format: 'truetype' }).catch(() => undefined)
// Dan Koe (v6) family: heavy italic serif for the glowing floating titles,
// bold neutral sans for captions/labels, mono for the red-line tag.
const KOE_SERIF = 'EditKoeSerif'
const KOE_SANS = 'EditKoeSans'
const KOE_MONO = 'EditKoeMono'
const KOE_MONO_BOLD = 'EditKoeMonoBold'
loadFont({ family: KOE_SERIF, url: fontUrl('PlayfairDisplay-ExtraBoldItalic.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: KOE_SANS, url: fontUrl('Inter-Bold.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: KOE_MONO, url: fontUrl('SpaceMono-Regular.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: KOE_MONO_BOLD, url: fontUrl('SpaceMono-Bold.ttf'), format: 'truetype' }).catch(() => undefined)
// Koe collage captions (v6 Sample look): Fraunces variable — the soft
// high-contrast serif with the blobby ball terminals the reference's huge
// lowercase payoff words and giant section numerals are set in. Registered
// across the full weight range; weight is picked per use via
// fontVariationSettings (opsz 144 = the display cut).
const KOE_DISPLAY = 'EditKoeDisplay'
loadFont({ family: KOE_DISPLAY, url: fontUrl('Fraunces-Variable.ttf'), format: 'truetype', weight: '100 900' }).catch(() => undefined)
const KOE_DISPLAY_VARIATION = "'opsz' 144, 'SOFT' 40, 'WONK' 0, 'wght' 640"
const KOE_NUMERAL_VARIATION = "'opsz' 144, 'SOFT' 60, 'WONK' 0, 'wght' 560"
// Koe collage connector text: Space Grotesk — a geometric grotesque with real
// character (distinctive a/g/numerals), so the small sans line never reads as
// a generic Arial default. Kept separate from the viral sans so only v6 moves.
const KOE_CONNECTOR = 'EditKoeConnector'
loadFont({ family: KOE_CONNECTOR, url: fontUrl('SpaceGrotesk-Variable.ttf'), format: 'truetype', weight: '300 700' }).catch(() => undefined)
// Julie (v4) accent: heavy italic geometric sans for the two-tone keywords.
const JULIE_ACCENT = 'EditJulieAccent'
loadFont({ family: JULIE_ACCENT, url: fontUrl('Poppins-BoldItalic.ttf'), format: 'truetype' }).catch(() => undefined)
// Eubank (v4) extras: calligraphic script for the gold method titles (the
// "Picasso Method" look), light geometric sans for thin quote/label text.
const EUBANK_SCRIPT = 'EditEubankScript'
const EUBANK_LIGHT = 'EditEubankLight'
loadFont({ family: EUBANK_SCRIPT, url: fontUrl('GreatVibes-Regular.ttf'), format: 'truetype' }).catch(() => undefined)
loadFont({ family: EUBANK_LIGHT, url: fontUrl('Poppins-Light.ttf'), format: 'truetype' }).catch(() => undefined)

const KOE_RED = '#F03A32'

export type ShortEditSegment = {
  srcStart: number               // seconds into the SOURCE footage
  duration: number               // seconds on the edited timeline
  zoom: 'in' | 'out' | 'none'
  frame?: 'inset'                // viral: shrink this beat into a white card
}

export type ShortEditPage = {
  start: number                  // edited-timeline seconds
  end: number
  position: 'low' | 'mid' | 'high'
  // tone: eubank's semantic accent color (good=green, bad=red, gold=neutral).
  words: { t: string; accent: boolean; tone?: 'good' | 'bad' | 'gold' }[]
  // Viral two-tier grammar (see lib/edit-plan.ts). Inclusive word-index range.
  accentRange?: [number, number]
  accentFont?: 'serif' | 'block'
  accentColor?: 'gold' | 'copper' | 'orange' | 'purple' | 'gradient'
  big?: boolean                  // poster treatment over a cover / eubank punch page
  behind?: boolean               // hook page rendered behind the subject matte
  align?: 'left' | 'center' | 'right'  // eubank/koe: horizontal lean of the block
  // ── koe editorial-collage (v6) — see lib/edit-plan.ts for full docs ─────────
  koeGroup?: number              // pages sharing a group accumulate as one collage
  koeDimFrom?: number            // accent word index where the dim serif echo starts
  koeSwap?: boolean              // accent line replaces the previous one in place
  koeRewrite?: string            // compact display form of the accent ("$10k")
  koeColor?: 'white' | 'gold' | 'coral' | 'sky' | 'mint' | 'lilac'  // serif payoff hue
}

// Koe (v6) giant persistent section numeral ("3" while the speaker walks the
// three sentences), planned pipeline-side.
export type KoeMotifProp = {
  text: string
  start: number
  end: number
  align: 'left' | 'center' | 'right'
  band: 'low' | 'high'
}

export type ShortEditBroll = {
  start: number                  // edited-timeline seconds
  duration: number
  file: string                   // filename inside remotion/public/
  kind: 'video' | 'image'
  // split: footage slides to the top ~55%, media fills the bottom, captions
  // ride the seam. panel: translucent rounded panel over the speaker.
  layout: 'card' | 'cover' | 'split' | 'panel'
  // Per-cover transition (eubank combo rotation) — overrides transitionStyle.
  transition?: 'blur' | 'flash' | 'punch' | 'slide' | 'zoom' | 'whip'
  // panel: which edge it slides in from (rotated by the planner).
  from?: 'left' | 'right' | 'top'
  // panel carousel: extra stills rendered as more translucent panels.
  extraFiles?: string[]
  // Designed poster card (viral): media floats on a gradient canvas with this
  // copy as the card's own headline. file may be '' — the poster then renders
  // as a typography-only animation. Palette rotates per card.
  design?: { kicker: string; headline: string; palette?: 'champagne' | 'dusk' | 'blush' }
  // Collage scene (v7 test): AI-generated transparent cutouts spring in over a
  // dark editorial canvas with the spoken claim as type — the Vox-explainer
  // grammar in the Koe palette. file stays ''; cutout files are transparent
  // PNGs staged pipeline-side (lib/collage-scenes.ts). The halftone/red-stroke
  // print treatment is applied here so it stays tweakable without regenerating.
  collage?: {
    kicker?: string
    headline?: string
    stat?: string
    cutouts: Array<{ file: string; size: 'hero' | 'support' }>
  }
}

// NOTE: must stay a `type` (not `interface`) — Remotion's <Composition> props
// generic requires assignability to Record<string, unknown>, which interfaces
// don't satisfy.
export type ShortEditProps = {
  videoFile: string              // filename inside remotion/public/
  width?: number
  height?: number
  fps?: number
  segments: ShortEditSegment[]
  pages: ShortEditPage[]
  broll?: ShortEditBroll[]
  // Visual grammar for full-screen B-roll covers (in/out). Plain segment cuts
  // are always silent hard cuts — transitions only happen where they mean
  // something (entering/leaving a cover). 'slide' is the viral push.
  transitionStyle?: 'blur' | 'flash' | 'punch' | 'slide'
  captionStyle?: 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie' | 'eubank'
  // Transparent-webm foreground of the speaker for the first seconds; lets the
  // hook caption render behind them (best-effort, staged pipeline-side).
  matte?: { file: string; durationSec: number }
  // Optional guest credit, bottom-left over the early footage (viral style).
  credit?: { name: string; title: string }
  // Context-driven graphics, planned pipeline-side: Koe kinds (title/list/venn,
  // lib/koe-graphics.ts) and Eubank kinds (notes/equation/crossout/cards/keyword,
  // lib/eubank-graphics.ts) share this one prop.
  graphics?: Array<{
    start: number
    duration: number
    kind: 'title' | 'list' | 'venn' | 'notes' | 'equation' | 'crossout' | 'cards' | 'keyword' | 'hook'
    placement?: 'top' | 'bottom'   // face-aware: text goes where the face isn't
    title?: string                 // koe title / notes header / keyword text / cards verdict
    subtitleBase?: string
    subtitleWords?: string[]
    items?: string[]               // koe list / notes items / cards labels
    itemAt?: number[]              // per-item reveal times (s, relative), spoken-synced
    left?: { label: string; items: string[] }
    right?: { label: string; items: string[] }
    eq?: { left: string; right: string }         // eubank equation ("left > right")
    strike?: { wrong: string; right: string }    // eubank cross-out
    icon?: string                                // eubank method scene: icon key
    // eubank quote panel: words to emphasize inside `title`, with their tone
    emphasis?: Array<{ word: string; tone?: 'good' | 'bad' | 'gold' }>
    stat?: string                                // eubank cards: grounded stat ("1M views")
  }>
  // Koe red-line tag (name or CTA), mono type with a drawn red vertical rule.
  tag?: { line1: string; line2?: string; start: number; durationSec: number }
  // Subtle cinematic grade + vignette on the footage.
  grade?: 'cinematic'
  // Julie's opening focus effect: edges darken, subject stays bright (~2.4s).
  hookSpotlight?: boolean
  // Eubank: tiny organic position/rotation drift on every shot — the reference
  // never lets a frame sit perfectly still.
  handheld?: boolean
  // Split-screen windows (derived from broll items with layout 'split'): the
  // footage stage slides to the top ~55% while the media fills the bottom.
  splits?: Array<{ start: number; end: number }>
  // Which vertical band the face occupies — the split crop keeps that band on
  // screen when the stage shrinks.
  faceArea?: 'upper' | 'middle' | 'lower'
  // Koe (v6): giant persistent serif numerals marking counted sections.
  koeMotifs?: KoeMotifProp[]
  // Event-driven audio cues, fully planned and peak-aligned pipeline-side
  // (lib/render-kit.ts + lib/sfx-stage.ts). durationSec is the real file
  // length so long sounds (risers) never get clipped mid-build.
  sfx?: Array<{ file: string; start: number; volume: number; durationSec?: number }>
}

// ── Viral palette ───────────────────────────────────────────────────────────
const VIRAL_COLORS: Record<string, { color: string; glow: string }> = {
  gold: { color: '#F5C542', glow: 'rgba(245, 197, 66, 0.55)' },
  copper: { color: '#E8A06B', glow: 'rgba(232, 160, 107, 0.45)' },
  orange: { color: '#FF9A2E', glow: 'rgba(255, 154, 46, 0.5)' },
  purple: { color: '#8A5CFF', glow: 'rgba(138, 92, 255, 0.5)' },
}
const INSET_BG = '#F1EEE8'

// One cut of the source footage. Joins between segments are SILENT HARD CUTS —
// like the reference video's angle changes. Non-viral styles keep the original
// slow creep; viral alternates PUNCHED framings so consecutive segments read
// as different shots. Viral extras live inside the same zoom transform so they
// track the footage exactly: the behind-subject caption pages and the
// transparent foreground matte above them.
const SegmentClip: React.FC<{
  videoFile: string
  seg: ShortEditSegment
  durationInFrames: number
  viral: boolean
  koe?: boolean
  eubank?: boolean
  handheld?: boolean
  grade?: 'cinematic'
  widthPx: number
  matte?: { file: string; durationSec: number }
  behindPages?: ShortEditPage[]
}> = ({ videoFile, seg, durationInFrames, viral, koe, eubank, handheld, grade, widthPx, matte, behindPages = [] }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Eubank: the reference jumps 1.15-1.25x between "shots" — the strongest
  // punched framing of the set. Viral: punched-in bases with a whisper of
  // drift (the cut itself is the "zoom"); koe: the same alternating-framing
  // idea but gentler, always drifting IN; others: the original slow creep.
  const zoomRange: [number, number] = eubank
    ? seg.zoom === 'in' ? [1.18, 1.225] : seg.zoom === 'out' ? [1.0, 1.035] : [1.08, 1.105]
    : viral
    ? seg.zoom === 'in' ? [1.13, 1.17] : seg.zoom === 'out' ? [1.0, 1.025] : [1.055, 1.08]
    : koe
    ? seg.zoom === 'in' ? [1.09, 1.125] : seg.zoom === 'out' ? [1.0, 1.03] : [1.045, 1.075]
    : seg.zoom === 'in' ? [1.03, 1.1] : seg.zoom === 'out' ? [1.1, 1.03] : [1.0, 1.0]
  const drift = interpolate(frame, [0, durationInFrames], zoomRange, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  // Every cut lands with a small spring overshoot — the hand-cut "punch" that
  // separates an edit from a filter pass. Blink-length segments skip it so
  // rapid-fire cuts don't wobble.
  const punch = durationInFrames > 14
    ? 1 + 0.035 * (1 - spring({ frame, fps, config: { damping: 16, stiffness: 190, mass: 0.7 } }))
    : 1
  const scale = drift * punch

  // Handheld drift (eubank): two slow incommensurate sines per axis plus a hair
  // of rotation — organic, deterministic, and small enough to never crop badly
  // (the punched zoom base always covers the excursion). Seeded per segment so
  // consecutive cuts don't share a phase.
  const hh = handheld
    ? {
        x: Math.sin(frame * 0.041 + seg.srcStart * 7.3) * 3.2 + Math.sin(frame * 0.013 + seg.srcStart * 3.1) * 2.2,
        y: Math.cos(frame * 0.033 + seg.srcStart * 5.7) * 2.6 + Math.sin(frame * 0.017 + seg.srcStart * 2.3) * 1.8,
        r: Math.sin(frame * 0.021 + seg.srcStart * 4.9) * 0.14,
      }
    : { x: 0, y: 0, r: 0 }

  const inner = (
    <AbsoluteFill
      style={{
        scale: String(scale),
        transformOrigin: '50% 32%',
        translate: hh.x || hh.y ? `${hh.x.toFixed(2)}px ${hh.y.toFixed(2)}px` : undefined,
        rotate: hh.r ? `${hh.r.toFixed(3)}deg` : undefined,
      }}
    >
      <OffthreadVideo
        src={staticFile(videoFile)}
        startFrom={Math.round(seg.srcStart * fps)}
        // Tone mapping needs ffmpeg zscale/tonemap filters that the bare
        // sandbox VM's compositor lacks — leaving it on makes frame extraction
        // 500 ("Could not extract frame from compositor"). Our footage is SDR,
        // so tone mapping is a no-op visually; turning it off is free here.
        toneMapping={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: grade === 'cinematic' ? 'contrast(1.07) saturate(0.86) brightness(0.96)' : undefined,
        }}
      />
      {grade === 'cinematic' ? (
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 42%, transparent 55%, rgba(4, 6, 10, 0.42) 100%)' }} />
      ) : null}
      {behindPages.map((page, i) => {
        const from = Math.round(page.start * fps)
        const dur = Math.max(2, Math.round((page.end - page.start) * fps))
        return (
          <Sequence key={`behind-${i}`} from={from} durationInFrames={dur}>
            <ViralCaptionPage page={page} widthPx={widthPx} />
          </Sequence>
        )
      })}
      {matte ? (
        <Sequence from={0} durationInFrames={Math.max(2, Math.round(matte.durationSec * fps))}>
          <OffthreadVideo
            src={staticFile(matte.file)}
            muted
            transparent
            toneMapping={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  )

  if (seg.frame !== 'inset') return inner

  // The reference's white-card beat: the footage shrinks into a framed card on
  // an off-white canvas, holds, and scales back out to full screen.
  const IN = 9
  const outStart = Math.max(IN, durationInFrames - 9)
  const t = interpolate(frame, [0, IN, outStart, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.33, 0, 0.2, 1),
  })
  const cardScale = 1 - t * 0.34
  const radius = t * 20
  return (
    <AbsoluteFill style={{ backgroundColor: INSET_BG }}>
      <AbsoluteFill style={{ scale: String(cardScale) }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: radius,
            overflow: 'hidden',
            boxShadow: t > 0.05 ? `0 ${24 * t}px ${70 * t}px rgba(40, 30, 15, 0.35)` : undefined,
            position: 'relative',
          }}
        >
          {inner}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// Split-screen stage (the "One Shot" reference's signature layout move): during
// a split window the whole footage stack shrinks to the top ~55% of the frame
// (cropped, face band kept in view), a thin white divider draws the seam, and
// the split B-roll fills the bottom. Everything animates over ~10 frames.
const FootageStage: React.FC<{
  splits: Array<{ start: number; end: number }>
  faceArea?: 'upper' | 'middle' | 'lower'
  children: React.ReactNode
}> = ({ splits, faceArea = 'middle', children }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  let amt = 0
  for (const w of splits) {
    if (t < w.start || t > w.end) continue
    const inT = interpolate(t, [w.start, w.start + 0.33], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    const outT = interpolate(t, [w.end - 0.33, w.end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    amt = Math.max(amt, Math.min(inT, outT))
  }
  if (amt <= 0.001) return <AbsoluteFill>{children}</AbsoluteFill>

  const stageH = 1 - 0.45 * amt   // 100% -> 55% of the frame
  // Keep the face band on screen as the stage crops, with a strong TOP bias —
  // talking-head faces sit above center far more often than the profile's
  // coarse bands suggest, and a cut-off forehead reads as a bug (feedback).
  // upper: keep the very top; middle: barely shift (headroom absorbs it);
  // lower: shift partway, never the full crop.
  const shiftPct =
    faceArea === 'upper' ? 0
    : faceArea === 'lower' ? -(1 - stageH) * 60
    : -(1 - stageH) * 18

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${(stageH * 100).toFixed(2)}%`, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: `${(100 / stageH).toFixed(2)}%`,
            translate: `0px ${shiftPct.toFixed(2)}%`,
          }}
        >
          {children}
        </div>
      </div>
      {/* soft falloff under the stage — the split card's scrim completes the
          blend, so no hard divider line (feedback: smoother reads better) */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          width: '100%',
          top: `${(stageH * 100 - 3).toFixed(2)}%`,
          height: '6%',
          background: 'linear-gradient(180deg, transparent, rgba(3, 4, 7, 0.6))',
          opacity: amt,
        }}
      />
    </AbsoluteFill>
  )
}

// Poster palettes: each designed card in a video gets a different one so two
// posters never read as copies. Same structure, different temperature.
type PosterPaletteName = 'champagne' | 'dusk' | 'blush'
const POSTER_PALETTES: Record<PosterPaletteName, {
  gradient: string; beam: string; dot: string; blob1: string; blob2: string
  headline: string; kicker: string; wash: string
}> = {
  champagne: {
    gradient: 'linear-gradient(160deg, #F2E4CA 0%, #E4CBA2 46%, #CBA87C 100%)',
    beam: 'rgba(255, 250, 238, 0.65)',
    dot: 'rgba(90, 60, 20, 0.10)',
    blob1: 'rgba(63, 41, 20, 0.5)',
    blob2: 'rgba(96, 84, 40, 0.45)',
    headline: '#453421',
    kicker: '#6E5B40',
    wash: 'rgba(245, 233, 209, 0.92)',
  },
  dusk: {
    gradient: 'linear-gradient(160deg, #E7EAF4 0%, #C8CEE3 46%, #A3ADCB 100%)',
    beam: 'rgba(246, 248, 255, 0.7)',
    dot: 'rgba(35, 45, 85, 0.10)',
    blob1: 'rgba(30, 38, 70, 0.45)',
    blob2: 'rgba(70, 80, 120, 0.4)',
    headline: '#2C3352',
    kicker: '#565E82',
    wash: 'rgba(232, 236, 248, 0.92)',
  },
  blush: {
    gradient: 'linear-gradient(160deg, #F7E6DE 0%, #EBC9BB 46%, #D5A38F 100%)',
    beam: 'rgba(255, 245, 240, 0.65)',
    dot: 'rgba(95, 45, 25, 0.10)',
    blob1: 'rgba(80, 35, 22, 0.45)',
    blob2: 'rgba(120, 70, 50, 0.4)',
    headline: '#4C2C21',
    kicker: '#7A5245',
    wash: 'rgba(249, 231, 223, 0.92)',
  },
}

// Animated halftone + light canvas behind the designed poster card.
const PosterCanvas: React.FC<{ palette: PosterPaletteName }> = ({ palette }) => {
  const frame = useCurrentFrame()
  const p = POSTER_PALETTES[palette]
  const sweep = interpolate(frame, [0, 120], [-30, 25], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: p.gradient }}>
      {/* drifting light beam */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(${115 + sweep * 0.2}deg, transparent 30%, ${p.beam} 47%, transparent 64%)`,
          translate: `${sweep}px 0px`,
        }}
      />
      {/* halftone texture */}
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${p.dot} 1.1px, transparent 1.6px)`,
          backgroundSize: '13px 13px',
        }}
      />
      {/* soft depth blobs framing top and bottom, like the reference's blurred foreground */}
      <div style={{ position: 'absolute', top: '-12%', left: '-14%', width: '55%', height: '26%', background: p.blob1, borderRadius: '50%', filter: 'blur(70px)' }} />
      <div style={{ position: 'absolute', bottom: '-14%', right: '-8%', width: '65%', height: '30%', background: p.blob2, borderRadius: '50%', filter: 'blur(80px)' }} />
    </AbsoluteFill>
  )
}

// Designed poster cover (viral): media floating on the warm canvas with the
// card's own kicker + serif headline building in.
const DesignedCover: React.FC<{
  item: ShortEditBroll
  durationInFrames: number
  widthPx: number
}> = ({ item, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const drift = interpolate(frame, [0, durationInFrames], [1.0, 1.09], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  const float = Math.sin((frame / 30) * Math.PI * 0.55) * 6
  const palette = POSTER_PALETTES[item.design?.palette ?? 'champagne']
  const hasMedia = !!item.file
  const media = !hasMedia ? null : item.kind === 'video'
    ? <OffthreadVideo src={staticFile(item.file)} muted toneMapping={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <Img src={staticFile(item.file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  const kickerIn = interpolate(frame, [4, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  // The planner quotes the speech verbatim; the poster wants editorial Title Case.
  const words = (item.design?.headline ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))

  return (
    <AbsoluteFill>
      <PosterCanvas palette={item.design?.palette ?? 'champagne'} />
      {/* floating media, tilted rounded card, halftone-washed */}
      {hasMedia ? (
        <div
          style={{
            position: 'absolute',
            right: '-7%',
            top: '30%',
            width: '58%',
            height: '40%',
            rotate: '-4deg',
            translate: `0px ${float}px`,
            borderRadius: 44,
            overflow: 'hidden',
            boxShadow: '0 30px 80px rgba(70, 45, 15, 0.38)',
          }}
        >
          <div style={{ width: '100%', height: '100%', scale: String(drift) }}>{media}</div>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(rgba(60, 35, 10, 0.14) 1px, transparent 1.5px)',
              backgroundSize: '9px 9px',
              mixBlendMode: 'multiply',
            }}
          />
        </div>
      ) : null}
      {/* Giant ghost initial behind the text block — editorial depth so the
          poster never reads as words floating in empty space. Drifts slowly. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: hasMedia ? '-4%' : '50%',
          top: hasMedia ? '18%' : '26%',
          translate: hasMedia ? `0px ${float * 0.6}px` : `-50% ${float * 0.6}px`,
          fontFamily: VIRAL_SERIF_UP,
          fontSize: widthPx * 0.52,
          lineHeight: 1,
          color: palette.headline,
          opacity: 0.07,
          pointerEvents: 'none',
        }}
      >
        {(words[0] ?? 'A')[0]}
      </div>
      {/* text block, left-aligned like the reference poster; a soft light wash
          behind the words keeps them readable where they cross the media.
          Typography-only posters center a bigger headline instead. */}
      <div style={{ position: 'absolute', left: hasMedia ? '7%' : '8%', top: hasMedia ? '31%' : '34%', width: hasMedia ? '62%' : '84%', textAlign: hasMedia ? 'left' : 'center' }}>
        <div
          style={{
            position: 'absolute',
            inset: '-16% -10%',
            background: `radial-gradient(ellipse at ${hasMedia ? '38%' : '50%'} 50%, ${palette.wash} 32%, transparent 74%)`,
            filter: 'blur(5px)',
          }}
        />
        <div
          style={{
            position: 'relative',
            fontFamily: VIRAL_SANS_STRONG,
            fontSize: widthPx * 0.026,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: palette.kicker,
            opacity: kickerIn,
            marginBottom: '0.7em',
          }}
        >
          {item.design?.kicker ?? ''}
        </div>
        {/* Accent rule draws in under the kicker */}
        <div
          style={{
            position: 'relative',
            height: 3,
            width: `${interpolate(frame, [6, 16], [0, hasMedia ? 18 : 9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })}%`,
            background: palette.kicker,
            borderRadius: 2,
            margin: hasMedia ? '0 0 0.9em 0' : '0 auto 0.9em',
            opacity: 0.85,
          }}
        />
        <div
          style={{
            position: 'relative',
            fontFamily: VIRAL_SERIF_UP,
            fontSize: widthPx * (hasMedia ? 0.082 : 0.118),
            lineHeight: 1.02,
            color: palette.headline,
            textShadow: '0 2px 14px rgba(74, 56, 38, 0.18)',
          }}
        >
          {words.map((w, i) => {
            const at = 8 + i * 3
            const o = interpolate(frame, [at, at + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            const rise = interpolate(frame, [at, at + 6], [16, 0], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
            })
            // Last word lands in the kicker color — one deliberate accent.
            const accented = i === words.length - 1 && words.length > 1
            return (
              <span key={i} style={{ display: 'inline-block', opacity: o, translate: `0px ${rise}px`, paddingRight: '0.24em', color: accented ? palette.kicker : undefined }}>
                {w}
              </span>
            )
          })}
        </div>
      </div>
      {/* Corner ticks — the small print-poster framing marks */}
      {([['7%', '6%'], ['93%', '6%'], ['7%', '94%'], ['93%', '94%']] as const).map(([x, y], i) => (
        <div
          key={i}
          aria-hidden
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: 14,
            height: 14,
            translate: '-50% -50%',
            borderLeft: `2px solid ${palette.kicker}`,
            borderTop: `2px solid ${palette.kicker}`,
            rotate: `${i * 90}deg`,
            opacity: kickerIn * 0.5,
          }}
        />
      ))}
    </AbsoluteFill>
  )
}

// B-roll cutaway. Grammars:
//   card   — a rounded photo/video card floating over the footage (v4/v6).
//   cover  — full-screen insert that OWNS the transition (blur/flash/punch, or
//            the viral slide push). Designed covers render the poster instead.
// ── Collage scene (v7 test) ───────────────────────────────────────────────────
// The Vox-explainer cutout grammar in the Koe palette: a dark editorial canvas,
// AI-generated cutouts (transparent PNGs) springing in staggered with a
// halftone print texture and an offset red stroke, the spoken claim set in the
// Fraunces display serif on top. Renders inside BrollClip's cover branch, so
// the blur transition + riser SFX apply exactly like any other cover.

// Halftone dot field masked to the cutout's own alpha — the "printed in a
// magazine" texture that keeps generated imagery from reading as AI-glossy.
// Mask geometry must mirror the Img underneath (contain, bottom-anchored).
const CollageHalftone: React.FC<{ file: string }> = ({ file }) => {
  const mask: React.CSSProperties = {
    WebkitMaskImage: `url(${staticFile(file)})`,
    WebkitMaskSize: 'contain',
    WebkitMaskPosition: 'center bottom',
    WebkitMaskRepeat: 'no-repeat',
    maskImage: `url(${staticFile(file)})`,
    maskSize: 'contain',
    maskPosition: 'center bottom',
    maskRepeat: 'no-repeat',
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(circle, rgba(8, 9, 12, 0.5) 1.1px, transparent 1.6px)',
        backgroundSize: '7px 7px',
        opacity: 0.55,
        ...mask,
      }}
    />
  )
}

// One treated cutout: grayscale print look + offset red silhouette stroke
// (drop-shadow on the transparent PNG), halftone masked on top, organic drift.
const CollageCutout: React.FC<{
  file: string
  delay: number          // frames before the spring starts
  flip?: boolean         // mirror the red offset + drift for the support cutout
}> = ({ file, delay, flip }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const inS = frame >= delay
    ? spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 130, mass: 0.9 } })
    : 0
  const drift = Math.sin((frame + (flip ? 60 : 0)) * 0.025) * 3
  const dir = flip ? -1 : 1
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: Math.min(1, inS * 1.5),
        translate: `0px ${(1 - inS) * 90 + drift}px`,
        scale: String(0.86 + 0.14 * inS),
        rotate: `${dir * (2.2 - inS * 2.2 + 0.6)}deg`,
      }}
    >
      <Img
        src={staticFile(file)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center bottom',
          filter: `grayscale(1) contrast(1.14) brightness(1.05) drop-shadow(${dir * 12}px 14px 0 rgba(240, 58, 50, 0.85))`,
        }}
      />
      <CollageHalftone file={file} />
    </div>
  )
}

const CollageScene: React.FC<{
  item: ShortEditBroll
  durationInFrames: number
  widthPx: number
}> = ({ item, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const c = item.collage!
  const hero = c.cutouts.find(k => k.size === 'hero')
  const support = c.cutouts.find(k => k.size === 'support')

  // The big offset accent ring behind the hero — the collage's one drawn shape.
  const ringIn = spring({ frame: Math.max(0, frame - 2), fps, config: { damping: 16, stiffness: 110, mass: 1 } })
  // Whole-scene slow push so the canvas never sits dead still.
  const push = interpolate(frame, [0, durationInFrames], [1.0, 1.045], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  const textAt = 12
  const textIn = frame >= textAt
    ? spring({ frame: frame - textAt, fps, config: { damping: 15, stiffness: 140, mass: 0.8 } })
    : 0

  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0C10', overflow: 'hidden' }}>
      <AbsoluteFill style={{ scale: String(push) }}>
        {/* canvas: dark radial wash + a faint global dot field (paper) */}
        <AbsoluteFill style={{ background: 'radial-gradient(120% 85% at 50% 28%, #1B1C22 0%, #0B0C10 72%)' }} />
        <AbsoluteFill
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.4px)',
            backgroundSize: '9px 9px',
          }}
        />
        {/* offset red ring behind the hero */}
        <div
          style={{
            position: 'absolute',
            left: '14%',
            top: '34%',
            width: '72%',
            height: '52%',
            border: `${Math.max(2, widthPx * 0.004)}px solid rgba(240, 58, 50, 0.55)`,
            borderRadius: '50%',
            rotate: '-8deg',
            scale: String(0.7 + 0.3 * ringIn),
            opacity: Math.min(0.9, ringIn),
          }}
        />

        {/* cutout layer: hero bottom-anchored, support smaller on the side */}
        {hero ? (
          <div style={{ position: 'absolute', left: support ? '2%' : '13%', bottom: '4%', width: '74%', height: '64%' }}>
            <CollageCutout file={hero.file} delay={4} />
          </div>
        ) : null}
        {support ? (
          <div style={{ position: 'absolute', right: '2%', bottom: '18%', width: '42%', height: '42%' }}>
            <CollageCutout file={support.file} delay={10} flip />
          </div>
        ) : null}

        {/* type block: connector kicker, Fraunces headline, red stat */}
        <div
          style={{
            position: 'absolute',
            left: '8%',
            width: '84%',
            top: '6.5%',
            opacity: Math.min(1, textIn * 1.4),
            translate: `0px ${(1 - textIn) * 26}px`,
          }}
        >
          {c.kicker ? (
            <div
              style={{
                fontFamily: KOE_CONNECTOR,
                fontVariationSettings: "'wght' 480",
                fontSize: widthPx * 0.03,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: '#9AA1AA',
                marginBottom: '0.55em',
              }}
            >
              {c.kicker}
            </div>
          ) : null}
          {c.headline ? (
            <div
              style={{
                fontFamily: KOE_DISPLAY,
                fontVariationSettings: KOE_DISPLAY_VARIATION,
                fontSize: widthPx * 0.078,
                lineHeight: 1.04,
                color: '#FFFFFF',
                textShadow: '0 0 30px rgba(255,255,255,0.4), 0 2px 10px rgba(0,0,0,0.5)',
              }}
            >
              {c.headline}
            </div>
          ) : null}
          {c.stat ? (
            <div
              style={{
                fontFamily: KOE_DISPLAY,
                fontVariationSettings: KOE_NUMERAL_VARIATION,
                fontSize: widthPx * 0.115,
                lineHeight: 1,
                marginTop: '0.18em',
                color: KOE_RED,
                textShadow: '0 0 34px rgba(240, 58, 50, 0.45)',
              }}
            >
              {c.stat}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>

      {/* vignette so the scene sits in the same dark room as the footage */}
      <AbsoluteFill style={{ background: 'radial-gradient(130% 100% at 50% 45%, transparent 58%, rgba(0,0,0,0.5) 100%)' }} />
    </AbsoluteFill>
  )
}

const BrollClip: React.FC<{
  item: ShortEditBroll
  durationInFrames: number
  transitionStyle: 'blur' | 'flash' | 'punch' | 'slide' | 'zoom' | 'whip'
  widthPx: number
}> = ({ item, durationInFrames, transitionStyle: globalStyle, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Per-cover transition (eubank combos) beats the render's global style.
  const transitionStyle = item.transition ?? globalStyle
  const appear = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })
  const kenBurns = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  // file may be '' for typography-only designed posters (DesignedCover guards).
  const media = !item.file ? null : item.kind === 'video'
    ? <OffthreadVideo src={staticFile(item.file)} muted toneMapping={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <Img src={staticFile(item.file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  // Split: FootageStage carries the footage to the top while the media rises
  // into the bottom as a slightly TILTED rounded card over a dark gradient
  // scrim (the reference's smooth slide-in, no hard divider line).
  if (item.layout === 'split') {
    const inT = interpolate(frame, [0, 11], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    const outT = interpolate(frame, [durationInFrames - 11, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) })
    const vis = Math.min(inT, outT)
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {/* dark scrim blending the lower half into the card */}
        <AbsoluteFill
          style={{
            opacity: vis,
            background: 'linear-gradient(180deg, transparent 44%, rgba(3, 4, 7, 0.55) 56%, rgba(3, 4, 7, 0.92) 72%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '1%',
            bottom: '1.5%',
            width: '98%',
            height: '42%',
            overflow: 'hidden',
            borderRadius: 20,
            rotate: '-2.4deg',
            translate: `0px ${((1 - vis) * 110).toFixed(2)}%`,
            boxShadow: '0 -14px 60px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div style={{ width: '100%', height: '100%', scale: String(kenBurns) }}>{media}</div>
        </div>
      </AbsoluteFill>
    )
  }

  // Panel: translucent media over the speaker (the reference's collage
  // moments). With extra stills it becomes the CAROUSEL — 2-3 tall ghost
  // panels across the top half sliding in staggered, the speaker visible
  // through them. A single panel hugs the face-free side instead.
  if (item.layout === 'panel') {
    const outP = interpolate(frame, [durationInFrames - 9, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

    const files = [item.file, ...(item.extraFiles ?? [])].filter(Boolean)
    if (files.length >= 2) {
      // Carousel: left / center-tall / right panes, staggered entrances from
      // above with a slow drift while they hold.
      const PANES: Array<{ left: string; top: string; w: string; h: string; delay: number }> = [
        { left: '1.5%', top: '7%', w: '29%', h: '36%', delay: 5 },
        { left: '32.5%', top: '2.5%', w: '35%', h: '48%', delay: 0 },
        { left: '69.5%', top: '9%', w: '29%', h: '34%', delay: 9 },
      ]
      const mediaFor = (f: string) =>
        f.endsWith('.mp4')
          ? <OffthreadVideo src={staticFile(f)} muted toneMapping={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Img src={staticFile(f)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          {PANES.slice(0, Math.min(3, files.length === 2 ? 2 : 3)).map((p, i) => {
            const f = files[i % files.length]
            const inP = frame >= p.delay
              ? spring({ frame: frame - p.delay, fps, config: { damping: 15, stiffness: 120, mass: 0.9 } })
              : 0
            const drift = Math.sin((frame + i * 40) * 0.02) * 4
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: p.left,
                  top: p.top,
                  width: p.w,
                  height: p.h,
                  translate: `0px ${(1 - inP) * -60 + drift}px`,
                  opacity: 0.5 * Math.min(1, inP * 1.4) * outP,
                  borderRadius: 14,
                  overflow: 'hidden',
                  boxShadow: '0 14px 44px rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                }}
              >
                <div style={{ width: '100%', height: '100%', scale: String(kenBurns) }}>{mediaFor(f)}</div>
              </div>
            )
          })}
        </AbsoluteFill>
      )
    }

    const from = item.from ?? 'right'
    const inP = spring({ frame, fps, config: { damping: 14, stiffness: 150, mass: 0.8 } })
    const slide = (1 - inP) * 110
    const place: React.CSSProperties =
      from === 'left' ? { left: '3%', top: '5%', translate: `${-slide}% 0%` }
      : from === 'top' ? { left: '24%', top: '3.5%', translate: `0% ${-slide}%` }
      : { right: '3%', top: '5%', translate: `${slide}% 0%` }
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            width: '52%',
            height: '23%',
            ...place,
            opacity: 0.55 * Math.min(1, inP * 1.4) * outP,
            borderRadius: 22,
            overflow: 'hidden',
            boxShadow: '0 18px 50px rgba(0, 0, 0, 0.35)',
            border: '1px solid rgba(255, 255, 255, 0.35)',
          }}
        >
          <div style={{ width: '100%', height: '100%', scale: String(kenBurns) }}>{media}</div>
        </div>
      </AbsoluteFill>
    )
  }

  if (item.layout === 'cover') {
    const IN = transitionStyle === 'slide' ? 7 : 6
    const outStart = Math.max(IN, durationInFrames - (transitionStyle === 'slide' ? 7 : 6))

    const content = item.collage
      ? <CollageScene item={item} durationInFrames={durationInFrames} widthPx={widthPx} />
      : item.design
      ? <DesignedCover item={item} durationInFrames={durationInFrames} widthPx={widthPx} />
      : (
        <AbsoluteFill style={{ backgroundColor: '#000' }}>
          <AbsoluteFill style={{ scale: String(kenBurns) }}>{media}</AbsoluteFill>
        </AbsoluteFill>
      )

    // Zoom-through: rush in from deep scale with motion blur, rush out deeper —
    // the reference's "high-speed zoom with heavy motion blur" structural move.
    if (transitionStyle === 'zoom') {
      const zIn = interpolate(frame, [0, 8], [1.6, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
      })
      const zOut = interpolate(frame, [outStart, durationInFrames], [1, 1.5], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic),
      })
      const zBlur = interpolate(frame, [0, 7, outStart, durationInFrames], [16, 0, 0, 13], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
      const zFade = interpolate(frame, [durationInFrames - 3, durationInFrames], [1, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
      return (
        <AbsoluteFill style={{ opacity: Math.min(appear, zFade), backgroundColor: '#000' }}>
          <AbsoluteFill style={{ scale: String(zIn * zOut), filter: zBlur > 0.2 ? `blur(${zBlur.toFixed(1)}px)` : undefined }}>
            {content}
          </AbsoluteFill>
        </AbsoluteFill>
      )
    }

    // Whip-pan: rip in from the right and out to the left with a blur streak —
    // faster and harder than the viral slide.
    if (transitionStyle === 'whip') {
      const x = interpolate(frame, [0, 5, outStart, durationInFrames], [130, 0, 0, -130], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.2, 0.9, 0.3, 1),
      })
      const wBlur = interpolate(frame, [0, 5, outStart, durationInFrames], [14, 0, 0, 14], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      })
      return (
        <AbsoluteFill style={{ translate: `${x}% 0%`, backgroundColor: '#000' }}>
          <AbsoluteFill style={{ filter: wBlur > 0.2 ? `blur(${wBlur.toFixed(1)}px)` : undefined }}>
            {content}
          </AbsoluteFill>
        </AbsoluteFill>
      )
    }

    if (transitionStyle === 'slide') {
      // The viral push: shove in from the right, shove out to the left.
      const x = interpolate(
        frame,
        [0, IN, outStart, durationInFrames],
        [104, 0, 0, -104],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.24, 0.9, 0.32, 1) },
      )
      const settle = interpolate(frame, [0, IN + 3], [1.05, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
      })
      return (
        <AbsoluteFill style={{ translate: `${x}% 0%` }}>
          <AbsoluteFill style={{ scale: String(settle) }}>{content}</AbsoluteFill>
        </AbsoluteFill>
      )
    }

    // Style-specific entry/exit treatments, all quick and clean.
    const blurAmt = transitionStyle === 'blur'
      ? interpolate(frame, [0, IN, outStart, durationInFrames], [14, 0, 0, 12], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        })
      : 0
    const flashAmt = transitionStyle === 'flash'
      ? interpolate(frame, [0, 1, 5, outStart, durationInFrames - 2, durationInFrames], [0.85, 0.5, 0, 0, 0.4, 0.75], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        })
      : 0
    const punchScale = transitionStyle === 'punch'
      ? interpolate(frame, [0, 8, outStart, durationInFrames], [1.12, 1, 1, 1.08], {
          extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          easing: Easing.out(Easing.cubic),
        })
      : 1
    // Fade out at the end so the return to the talking head never pops harshly.
    const fade = interpolate(frame, [outStart, durationInFrames], [1, transitionStyle === 'flash' ? 1 : 0.0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })

    return (
      <AbsoluteFill style={{ opacity: Math.min(appear, fade), backgroundColor: '#000' }}>
        <AbsoluteFill style={{ scale: String(punchScale), filter: blurAmt > 0.2 ? `blur(${blurAmt}px)` : undefined }}>
          {content}
        </AbsoluteFill>
        {flashAmt > 0.01 ? <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flashAmt }} /> : null}
      </AbsoluteFill>
    )
  }

  const rise = interpolate(frame, [0, 5], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
  // Card lands with a spring overshoot instead of a flat slide — matches the
  // hand-cut punch of the segment cuts.
  const cardPop = 0.94 + 0.06 * spring({ frame, fps, config: { damping: 13, stiffness: 170, mass: 0.8 } })
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '9%',
          width: '82%',
          top: '21%',
          height: '44%',
          opacity: appear,
          translate: `0px ${rise}px`,
          scale: String(cardPop),
          borderRadius: 28,
          overflow: 'hidden',
          boxShadow: '0 22px 60px rgba(0, 0, 0, 0.42)',
          border: '3px solid rgba(255, 255, 255, 0.92)',
        }}
      >
        <div style={{ width: '100%', height: '100%', scale: String(kenBurns) }}>{media}</div>
      </div>
    </AbsoluteFill>
  )
}

// ── Dan Koe graphics (v6) ─────────────────────────────────────────────────────
// All Koe graphics sit on a dimming layer over the footage — the reference
// composites its text "into the room" above a dark studio; dimming the frame
// gives the same floating-in-space read on any footage.

const KoeDim: React.FC<{ durationInFrames: number; amount?: number }> = ({ durationInFrames, amount = 0.55 }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, amount, amount, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return <AbsoluteFill style={{ backgroundColor: `rgba(5, 7, 11, ${o})` }} />
}

// Opening hook: glowing italic-serif title blurring in word by word, grey sans
// subtitle whose final word cycles in red.
const KoeTitle: React.FC<{ g: NonNullable<ShortEditProps['graphics']>[number]; durationInFrames: number; widthPx: number }> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const words = (g.title ?? '').split(/\s+/).filter(Boolean)
  const rotating = g.subtitleWords ?? []
  const per = rotating.length ? Math.max(0.7, (durationInFrames / fps - 0.9) / rotating.length) : 0
  const idx = rotating.length ? Math.min(rotating.length - 1, Math.floor(Math.max(0, frame / fps - 0.9) / per)) : 0
  const swapAt = (0.9 + idx * per) * fps
  const swapIn = interpolate(frame, [swapAt, swapAt + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <KoeDim durationInFrames={durationInFrames} amount={0.62} />
      <div style={{ position: 'absolute', left: '7%', width: '86%', top: g.placement === 'bottom' ? '58%' : '30%' }}>
        <div style={{ fontFamily: KOE_SERIF, fontStyle: 'italic', fontSize: widthPx * 0.062, lineHeight: 1.08, color: '#FFFFFF', textShadow: '0 0 34px rgba(255,255,255,0.55), 0 0 8px rgba(255,255,255,0.35)' }}>
          {words.map((w, i) => {
            const at = 3 + i * 2
            const o = interpolate(frame, [at, at + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            const blur = interpolate(frame, [at, at + 7], [7, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            return (
              <span key={i} style={{ display: 'inline-block', opacity: o, filter: `blur(${blur.toFixed(1)}px)`, paddingRight: '0.24em' }}>
                {w}
              </span>
            )
          })}
        </div>
        {g.subtitleBase && rotating.length ? (
          <div style={{ marginTop: '0.55em', fontFamily: VIRAL_SANS, fontSize: widthPx * 0.036, color: '#9AA1AA' }}>
            {g.subtitleBase}{' '}
            <span style={{ display: 'inline-block', color: KOE_RED, opacity: swapIn, translate: `0px ${(1 - swapIn) * -8}px` }}>
              {rotating[idx]}
            </span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

// Enumeration: a refined left-aligned stack in the face-free band. Each item
// reveals AT THE MOMENT IT'S SPOKEN (itemAt, planned from word timings); the
// newest is bright white with a glow, earlier ones settle to dim grey — the
// reference's bright/dim state walk.
const KoeList: React.FC<{ g: NonNullable<ShortEditProps['graphics']>[number]; durationInFrames: number; widthPx: number }> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const items = g.items ?? []
  const atFrames = items.map((_, i) => Math.round((g.itemAt?.[i] ?? i * 0.9) * fps))
  const currentIdx = atFrames.reduce((acc, at, i) => (frame >= at ? i : acc), 0)
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <KoeDim durationInFrames={durationInFrames} amount={0.62} />
      <div style={{ position: 'absolute', left: '9%', top: g.placement === 'bottom' ? '57%' : '11%' }}>
        {items.map((item, i) => {
          const at = atFrames[i]
          const o = interpolate(frame, [at, at + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const slide = interpolate(frame, [at, at + 7], [-14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
          const isCurrent = i === currentIdx
          return (
            <div
              key={i}
              style={{
                fontFamily: KOE_SANS,
                fontSize: widthPx * 0.04,
                lineHeight: 1.75,
                letterSpacing: '0.01em',
                opacity: o * (isCurrent ? 1 : 0.35),
                translate: `${slide}px 0px`,
                color: '#FFFFFF',
                textShadow: isCurrent ? '0 0 24px rgba(255,255,255,0.5), 0 2px 8px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.4)',
              }}
            >
              {item}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

// Contrast → merge: two glowing red circles draw in with labels + inner words,
// slide together, and the intersection fills red.
const KoeVenn: React.FC<{ g: NonNullable<ShortEditProps['graphics']>[number]; durationInFrames: number; widthPx: number }> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const R = widthPx * 0.17
  const circumference = 2 * Math.PI * R
  const draw = interpolate(frame, [4, 20], [circumference, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const textIn = interpolate(frame, [18, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  // Merge starts ~45% in, completes ~62% in (the SFX peak targets 62%).
  const mergeT = interpolate(frame, [durationInFrames * 0.45, durationInFrames * 0.62], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.3, 1),
  })
  const fillIn = interpolate(frame, [durationInFrames * 0.6, durationInFrames * 0.72], [0, 0.55], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const sep = widthPx * (0.24 - 0.13 * mergeT)  // center offset from middle
  const cy = '30%'

  const circle = (side: -1 | 1, data?: { label: string; items: string[] }) => (
    <div style={{ position: 'absolute', left: '50%', top: cy, translate: `${side * sep - R}px ${-R}px` }}>
      <svg width={R * 2} height={R * 2} style={{ overflow: 'visible', filter: `drop-shadow(0 0 14px ${KOE_RED}88)` }}>
        <circle
          cx={R} cy={R} r={R - 2}
          fill="none" stroke={KOE_RED} strokeWidth={2.5}
          strokeDasharray={circumference}
          strokeDashoffset={side === -1 ? draw : -draw}
          transform={`rotate(${side === -1 ? -90 : 90} ${R} ${R})`}
        />
      </svg>
      {data ? (
        <>
          <div style={{ position: 'absolute', bottom: '104%', left: 0, width: R * 2, textAlign: 'center', fontFamily: KOE_SANS, fontSize: widthPx * 0.026, color: '#FFFFFF', opacity: textIn, whiteSpace: 'nowrap' }}>
            {data.label}
          </div>
          <div style={{ position: 'absolute', top: 0, left: 0, width: R * 2, height: R * 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: VIRAL_SANS, fontSize: widthPx * 0.023, lineHeight: 1.5, color: '#E7E9EC', opacity: textIn * (1 - mergeT * 0.5) }}>
            {data.items.map((it, i) => <div key={i}>{it}</div>)}
          </div>
        </>
      ) : null}
    </div>
  )

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <KoeDim durationInFrames={durationInFrames} />
      {circle(-1, g.left)}
      {circle(1, g.right)}
      {/* intersection fill — a red lens fading in once the circles overlap */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: cy,
          translate: `${-R * 0.42}px ${-R * 0.62}px`,
          width: R * 0.84,
          height: R * 1.24,
          borderRadius: '50%',
          background: KOE_RED,
          opacity: fillIn,
          filter: 'blur(10px)',
        }}
      />
    </AbsoluteFill>
  )
}

// Red-line mono tag (name or CTA): the vertical rule draws top-to-bottom while
// the text slides up in.
const KoeTag: React.FC<{ tag: NonNullable<ShortEditProps['tag']>; durationInFrames: number; widthPx: number }> = ({ tag, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const lineDraw = interpolate(frame, [0, 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const o = interpolate(frame, [2, 9, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rise = interpolate(frame, [2, 9], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '13%', top: '47%', display: 'flex', gap: widthPx * 0.02 }}>
        <div style={{ width: widthPx * 0.006, height: widthPx * 0.105, background: KOE_RED, transformOrigin: 'top', scale: `1 ${lineDraw}`, boxShadow: `0 0 10px ${KOE_RED}AA` }} />
        <div style={{ opacity: o, translate: `0px ${rise}px`, alignSelf: 'center' }}>
          <div style={{ fontFamily: KOE_MONO_BOLD, fontSize: widthPx * 0.03, letterSpacing: '0.14em', color: '#FFFFFF', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>
            {tag.line1}
          </div>
          {tag.line2 ? (
            <div style={{ marginTop: '0.35em', fontFamily: KOE_MONO, fontSize: widthPx * 0.017, letterSpacing: '0.2em', color: '#C9CDD3' }}>
              {tag.line2}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  )
}

// ── Viral caption page (v5) ───────────────────────────────────────────────────
// Two-tier stacked layout from the reference: small white sans kicker line, big
// accent line under it (italic serif in warm color + glow, or heavy block for
// times/numbers, one orange→violet gradient sweep), small sans tail. Words
// build in sequentially; accent words land with a scale pop.
const ViralCaptionPage: React.FC<{ page: ShortEditPage; widthPx: number }> = ({ page, widthPx }) => {
  const frame = useCurrentFrame()

  const range = page.accentRange
  const texts = page.words.map(w => w.t)
  const kicker = range ? texts.slice(0, range[0]) : texts
  const accent = range ? texts.slice(range[0], range[1] + 1) : []
  const tail = range ? texts.slice(range[1] + 1) : []

  const big = page.big
  const sansSize = widthPx * (big ? 0.046 : 0.037)
  const accentSize = widthPx * (page.accentFont === 'block' ? (big ? 0.088 : 0.068) : (big ? 0.095 : 0.075))
  const palette = VIRAL_COLORS[page.accentColor ?? 'gold'] ?? VIRAL_COLORS.gold

  // Sequential build: kicker words first, then the accent pops, then the tail.
  // Accent words also flash bright on arrival — a quick brightness spike that
  // decays as the pop settles, the "expensive edit" landing.
  const wordIn = (order: number, pop: boolean) => {
    const at = order * 2
    const o = interpolate(frame, [at, at + 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const s = pop
      ? interpolate(frame, [at, at + 5], [1.14, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
      : 1
    const flash = pop
      ? interpolate(frame, [at + 1, at + 9], [1.45, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
      : 1
    return { opacity: o, scale: s, flash }
  }

  const sansStyle: React.CSSProperties = {
    fontFamily: VIRAL_SANS_STRONG,
    fontSize: sansSize,
    color: '#F7F5F0',
    textShadow: '0 2px 12px rgba(0, 0, 0, 0.55)',
    letterSpacing: '0.01em',
  }
  const accentStyle: React.CSSProperties = page.accentFont === 'block'
    ? {
        fontFamily: VIRAL_BLOCK,
        fontSize: accentSize,
        textTransform: 'uppercase',
        letterSpacing: '0.01em',
        ...(page.accentColor === 'gradient'
          ? {
              backgroundImage: 'linear-gradient(94deg, #FF9A2E 18%, #8A5CFF 82%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 3px 12px rgba(0, 0, 0, 0.4))',
            }
          : {
              color: palette.color,
              textShadow: `0 0 26px ${palette.glow}, 0 3px 12px rgba(0, 0, 0, 0.45)`,
            }),
      }
    : {
        fontFamily: ACCENT_FONT,
        fontStyle: 'italic',
        fontWeight: 700,
        fontSize: accentSize,
        color: palette.color,
        textShadow: `0 0 30px ${palette.glow}, 0 2px 10px rgba(0, 0, 0, 0.4)`,
        letterSpacing: '0.005em',
      }

  const position = page.position
  const positionStyle: React.CSSProperties =
    position === 'low' ? { bottom: '16%' }
    : position === 'mid' ? { top: '44%' }
    : { top: '12%' }

  let order = 0
  const renderWords = (words: string[], style: React.CSSProperties, pop: boolean) =>
    words.map((w, i) => {
      const anim = wordIn(order++, pop)
      // Brightness flash rides on a wrapper so it never clobbers a style's own
      // filter (the gradient accent uses drop-shadow via filter).
      const inner = (
        <span style={{ display: 'inline-block', ...style, opacity: anim.opacity, scale: String(anim.scale), padding: '0 0.09em' }}>
          {w}
        </span>
      )
      return anim.flash !== 1 ? (
        <span key={i} style={{ display: 'inline-block', filter: `brightness(${anim.flash.toFixed(3)})` }}>{inner}</span>
      ) : (
        <span key={i} style={{ display: 'inline-block' }}>{inner}</span>
      )
    })

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '6%',
          width: '88%',
          textAlign: 'center',
          lineHeight: 1.12,
          ...positionStyle,
        }}
      >
        {kicker.length ? <div>{renderWords(kicker, sansStyle, false)}</div> : null}
        {accent.length ? <div style={{ marginTop: '0.04em' }}>{renderWords(accent, accentStyle, true)}</div> : null}
        {tail.length ? <div style={{ marginTop: '0.1em' }}>{renderWords(tail, { ...sansStyle, fontSize: sansSize * 0.92 }, false)}</div> : null}
      </div>
    </AbsoluteFill>
  )
}

// Guest credit, bottom-left (viral): name in white, role in warm gold, sliding
// in from the left like the reference's lower third.
const CreditTag: React.FC<{ credit: { name: string; title: string }; widthPx: number }> = ({ credit, widthPx }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const inX = interpolate(frame, [0, 8], [-30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const o = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: '7%', bottom: '7%', translate: `${inX}px 0px`, opacity: o }}>
        <div style={{ fontFamily: VIRAL_SANS_STRONG, fontSize: widthPx * 0.033, color: '#FFFFFF', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
          {credit.name}
        </div>
        <div style={{ fontFamily: VIRAL_SANS, fontSize: widthPx * 0.022, color: '#E9C77E', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
          {credit.title}
        </div>
      </div>
    </AbsoluteFill>
  )
}

// Caption identities. serif/editorial/impact share the original page system;
// viral, koe, julie, and eubank have dedicated renderers.
type CaptionStyleName = 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie' | 'eubank'

// ── Koe editorial-collage captions (v6) ───────────────────────────────────────
// Modeled frame-by-frame on "v6 Sample.mp4": small clean sans connector
// phrases accumulate into an asymmetric collage while the payoff words land as
// HUGE lowercase Fraunces serif. Grammar:
//   · each phrase (page) enters at its own spoken time and PERSISTS until the
//     whole collage fades out together
//   · serif payoffs blur-pop in (soft blur → sharp, slight settle, brightness
//     kiss); dim serif echoes slide in translucent below ("money work")
//   · consecutive pure-emphasis pages swap IN PLACE with a blur crossfade
//     (the $10k → $20k → $50k beat)
//   · a giant persistent numeral marks counted sections (KoeMotifNumeral)
// Placement is face-aware pipeline-side (band + horizontal lean per group).

// Soft, cinematic palette for the serif payoffs. Near-monochrome by default
// (white dominates), but money reads gold and a rotating set of muted hues
// gives the edit color without turning garish. Each hue carries a matching
// glow so it lifts off the dark footage.
const KOE_PALETTE: Record<string, { color: string; glow: string }> = {
  white: { color: '#FFFFFF', glow: 'rgba(255, 255, 255, 0.18)' },
  gold: { color: '#E9C77E', glow: 'rgba(233, 199, 126, 0.42)' },
  coral: { color: '#F19A80', glow: 'rgba(241, 154, 128, 0.42)' },
  sky: { color: '#93B8EC', glow: 'rgba(147, 184, 236, 0.42)' },
  mint: { color: '#8FE0BC', glow: 'rgba(143, 224, 188, 0.42)' },
  lilac: { color: '#C0A6F2', glow: 'rgba(192, 166, 242, 0.44)' },
}

// Adaptive serif sizing: big, editorial payoffs (~2x the old restrained set),
// clamped so a phrase still fits the collage column on one line; genuinely
// long phrases wrap instead of overflowing.
function koeSerifPx(widthPx: number, text: string, big?: boolean): number {
  const base = widthPx * (big ? 0.2 : 0.155)
  return Math.min(base, (widthPx * 0.92) / Math.max(4, text.length * 0.5))
}

type KoeBlock = { chain: ShortEditPage[] }

// One accumulating collage. `pages` all share a koeGroup; the surrounding
// <Sequence> spans from the first phrase's start to a beat after the last
// phrase ends, and every entrance offset is computed against that start.
const KoeCollageGroup: React.FC<{
  pages: ShortEditPage[]
  groupStart: number
  durationInFrames: number
  widthPx: number
}> = ({ pages, groupStart, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const align = pages[0].align ?? 'left'
  const band = pages[0].position
  const bandStyle: React.CSSProperties =
    band === 'low' ? { bottom: '15%' }
    : band === 'mid' ? { top: '37%' }
    : { top: '10%' }

  // Swap chains collapse into one block that crossfades between its members.
  const blocks: KoeBlock[] = []
  for (const page of pages) {
    const last = blocks[blocks.length - 1]
    if (page.koeSwap && last && last.chain[last.chain.length - 1].accentRange) last.chain.push(page)
    else blocks.push({ chain: [page] })
  }

  // The whole collage breathes out together at the end of the group.
  const groupOpacity = interpolate(
    frame,
    [durationInFrames - 6, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )

  const enterFrameOf = (page: ShortEditPage) =>
    Math.max(0, Math.round((page.start - groupStart) * fps))

  const smallStyle: React.CSSProperties = {
    fontFamily: KOE_CONNECTOR,
    fontWeight: 500,
    fontSize: widthPx * 0.05,
    color: 'rgba(255, 255, 255, 0.96)',
    textShadow: '0 2px 10px rgba(0, 0, 0, 0.6)',
    letterSpacing: '0.006em',
    lineHeight: 1.25,
  }

  // Small sans words breathe in one by one with a tiny rise.
  const renderSmallWords = (words: string[], startF: number) =>
    words.map((w, i) => {
      const at = startF + i * 2
      const o = interpolate(frame, [at, at + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      const y = interpolate(frame, [at, at + 4], [6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
      return (
        <span key={i} style={{ display: 'inline-block', opacity: o, translate: `0px ${y}px`, padding: '0 0.14em' }}>
          {w}
        </span>
      )
    })

  // The serif payoff line: soft blur → sharp with a settle and a brightness
  // kiss (the reference's "expensive edit" landing).
  const renderAccentLine = (text: string, page: ShortEditPage, startF: number, exitAtF: number | null) => {
    const size = koeSerifPx(widthPx, text, page.big)
    const pal = page.koeColor ? KOE_PALETTE[page.koeColor] : null
    const o = interpolate(frame, [startF, startF + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const blur = interpolate(frame, [startF, startF + 6], [9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
    const scale = interpolate(frame, [startF, startF + 7], [1.07, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    const flash = interpolate(frame, [startF + 1, startF + 9], [1.28, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
    const y = interpolate(frame, [startF, startF + 7], [-8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    // Swap exit: blur back out and sink as the replacement lands.
    const exitO = exitAtF === null ? 1
      : interpolate(frame, [exitAtF - 2, exitAtF + 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const exitBlur = exitAtF === null ? 0
      : interpolate(frame, [exitAtF - 2, exitAtF + 2], [0, 8], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const exitY = exitAtF === null ? 0
      : interpolate(frame, [exitAtF - 2, exitAtF + 2], [0, 12], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    return (
      <div
        style={{
          fontFamily: KOE_DISPLAY,
          fontVariationSettings: KOE_DISPLAY_VARIATION,
          fontSize: size,
          textTransform: 'lowercase',
          letterSpacing: '-0.012em',
          lineHeight: 1.0,
          color: pal ? pal.color : '#FFFFFF',
          textShadow: pal
            ? `0 0 32px ${pal.glow}, 0 3px 16px rgba(0, 0, 0, 0.5)`
            : '0 3px 18px rgba(0, 0, 0, 0.55)',
          opacity: o * exitO,
          filter: `blur(${(blur + exitBlur).toFixed(2)}px) brightness(${flash.toFixed(3)})`,
          scale: String(scale),
          translate: `0px ${(y + exitY).toFixed(1)}px`,
        }}
      >
        {text}
      </div>
    )
  }

  // Dim serif echo ("work" under "money"): slides in with motion blur and
  // settles translucent, offset toward the block's open side.
  const renderDimLine = (text: string, size: number, startF: number) => {
    const o = interpolate(frame, [startF, startF + 5], [0, 0.62], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const x = interpolate(frame, [startF, startF + 6], [align === 'right' ? 26 : -26, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    const blur = interpolate(frame, [startF, startF + 6], [7, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
    return (
      <div
        style={{
          fontFamily: KOE_DISPLAY,
          fontVariationSettings: KOE_DISPLAY_VARIATION,
          fontSize: size * 0.74,
          textTransform: 'lowercase',
          letterSpacing: '-0.01em',
          lineHeight: 1.0,
          color: '#E7E0D4',
          textShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
          opacity: o,
          filter: `blur(${blur.toFixed(2)}px)`,
          translate: `${x.toFixed(1)}px 0px`,
          // The echo hangs off the payoff's trailing edge, like the reference.
          marginLeft: align === 'right' ? undefined : '16%',
          marginRight: align === 'right' ? '16%' : undefined,
        }}
      >
        {text}
      </div>
    )
  }

  // Asymmetric stagger: consecutive blocks indent differently so the collage
  // reads as composed type, not a subtitle stack.
  const indentFor = (i: number): React.CSSProperties => {
    const steps = ['0%', '12%', '5%', '18%']
    const inset = steps[i % steps.length]
    if (align === 'right') return { marginRight: inset, textAlign: 'right' }
    if (align === 'center') return { textAlign: 'center', marginLeft: i % 2 === 1 ? '8%' : '0%' }
    return { marginLeft: inset, textAlign: 'left' }
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: groupOpacity }}>
      <div
        style={{
          position: 'absolute',
          left: '8%',
          width: '84%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          gap: widthPx * 0.006,
          ...bandStyle,
        }}
      >
        {blocks.map((block, bi) => {
          const first = block.chain[0]
          const range = first.accentRange
          const texts = first.words.map(w => w.t)
          const enterF = enterFrameOf(first)

          // Prefix sans words (before the payoff) build first.
          const prefix = range ? texts.slice(0, range[0]) : texts
          const accentStartF = enterF + Math.min(prefix.length, 3) * 2

          // Payoff main text + optional dim echo tail.
          let accentMain = ''
          let dimTail = ''
          if (range) {
            const dimFrom = first.koeDimFrom
            const mainTo = dimFrom !== undefined ? dimFrom - 1 : range[1]
            accentMain = first.koeRewrite ?? texts.slice(range[0], mainTo + 1).join(' ')
            if (dimFrom !== undefined) dimTail = texts.slice(dimFrom, range[1] + 1).join(' ')
          }
          const suffix = range ? texts.slice(range[1] + 1) : []
          const suffixStartF = accentStartF + 4

          return (
            <div key={bi} style={{ ...indentFor(bi), maxWidth: '100%' }}>
              {prefix.length ? <div style={smallStyle}>{renderSmallWords(prefix, enterF)}</div> : null}
              {range ? (
                block.chain.length > 1 ? (
                  // Swap chain: members crossfade in place; the container holds
                  // the tallest member so nothing below reflows.
                  <div style={{ position: 'relative' }}>
                    {block.chain.map((member, mi) => {
                      const mRange = member.accentRange!
                      const mTexts = member.words.map(w => w.t)
                      const mText = member.koeRewrite ?? mTexts.slice(mRange[0], mRange[1] + 1).join(' ')
                      const mStartF = mi === 0 ? accentStartF : enterFrameOf(member)
                      const next = block.chain[mi + 1]
                      const exitAtF = next ? enterFrameOf(next) : null
                      return (
                        <div key={mi} style={mi === 0 ? undefined : { position: 'absolute', inset: 0 }}>
                          {renderAccentLine(mText, member, mStartF, exitAtF)}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  renderAccentLine(accentMain, first, accentStartF, null)
                )
              ) : null}
              {dimTail ? renderDimLine(dimTail, koeSerifPx(widthPx, accentMain, first.big), accentStartF + 3) : null}
              {suffix.length ? (
                <div style={{ ...smallStyle, marginLeft: align === 'right' ? undefined : '22%', marginRight: align === 'right' ? '22%' : undefined }}>
                  {renderSmallWords(suffix, suffixStartF)}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

// Giant persistent Fraunces numeral marking a counted section — blur-pops in,
// then just HOLDS while caption collages come and go around it.
const KoeMotifNumeral: React.FC<{ m: KoeMotifProp; durationInFrames: number; widthPx: number }> = ({ m, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 6, durationInFrames - 7, durationInFrames - 1], [0, 0.97, 0.97, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const blur = interpolate(frame, [0, 8], [12, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
  const scale = interpolate(frame, [0, 9], [1.14, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const horizontal: React.CSSProperties =
    m.align === 'left' ? { left: '10%', textAlign: 'left' }
    : m.align === 'right' ? { right: '10%', textAlign: 'right' }
    : { left: '0%', width: '100%', textAlign: 'center' }
  const vertical: React.CSSProperties = m.band === 'high' ? { top: '8%' } : { bottom: '9%' }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          ...horizontal,
          ...vertical,
          fontFamily: KOE_DISPLAY,
          fontVariationSettings: KOE_NUMERAL_VARIATION,
          fontSize: widthPx * 0.21,
          lineHeight: 0.9,
          color: '#FFFFFF',
          textShadow: '0 4px 26px rgba(0, 0, 0, 0.5)',
          opacity: o,
          filter: `blur(${blur.toFixed(2)}px)`,
          scale: String(scale),
        }}
      >
        {m.text}
      </div>
    </AbsoluteFill>
  )
}


// Julie (v4) captions: white bold sans base + heavy ITALIC two-tone accents
// (light periwinkle offset behind navy ink, or the inverse — the offset layer
// is what makes the color read against any background). Sizes, positions, and
// ENTRANCES vary page to page: fade, zoom-in, slide-from-left, slide-from-right.
const JULIE_TONES = [
  { front: '#232A4D', back: '#9FB4EA' },   // navy ink over periwinkle
  { front: '#8FA8E8', back: '#1E2340' },   // periwinkle over navy
  { front: '#FFFFFF', back: '#7D93C9' },   // white over steel blue
]
const JulieCaptionPage: React.FC<{ page: ShortEditPage; widthPx: number }> = ({ page, widthPx }) => {
  const frame = useCurrentFrame()
  // Deterministic per-page variety without extra props: hash the page start.
  const h = Math.abs(Math.floor(page.start * 977))
  const entrance = h % 4                       // 0 fade, 1 zoom, 2 slide-L, 3 slide-R
  const tone = JULIE_TONES[h % JULIE_TONES.length]
  const hasAccent = page.words.some(w => w.accent)
  const big = hasAccent || h % 4 === 0
  const baseSize = widthPx * (big ? 0.058 : 0.044)

  const opacity = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })
  const zoom = entrance === 1
    ? interpolate(frame, [0, 6], [1.18, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : 1
  const slideX = entrance === 2
    ? interpolate(frame, [0, 6], [-46, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : entrance === 3
    ? interpolate(frame, [0, 6], [46, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : 0

  const positionStyle: React.CSSProperties =
    page.position === 'low' ? { bottom: '18%' }
    : page.position === 'mid' ? { top: '42%' }
    : { top: '10%' }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '6%',
          width: '88%',
          textAlign: 'center',
          opacity,
          scale: String(zoom),
          translate: `${slideX}px 0px`,
          lineHeight: 1.18,
          ...positionStyle,
        }}
      >
        {page.words.map((w, i) =>
          w.accent ? (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontFamily: JULIE_ACCENT,
                fontStyle: 'italic',
                fontSize: baseSize * 1.42,
                color: tone.front,
                padding: '0 0.1em',
                textShadow: `0.045em 0.05em 0 ${tone.back}, 0 4px 16px rgba(0, 0, 0, 0.3)`,
              }}
            >
              {w.t}{' '}
            </span>
          ) : (
            <span
              key={i}
              style={{
                fontFamily: BOLD_FONT,
                fontWeight: 700,
                fontSize: baseSize,
                color: '#FFFFFF',
                padding: '0 0.06em',
                textShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
              }}
            >
              {w.t}{' '}
            </span>
          )
        )}
      </div>
    </AbsoluteFill>
  )
}

// ── Eubank (v4) captions + concept graphics ───────────────────────────────────
// Modeled on "Alex Eubank Sample.mp4" (lib/V4-EUBANK-PLAN.md): clean Inter
// sentence-case captions whose emphasis words are bold and color-coded by
// MEANING (green = positive, red = negative, gold = neutral emphasis), big
// centered punchline pages, and concept graphics that visualize the speech.

// Accent palette matched to the "One Shot" reference: light cyan is the
// signature highlight; mint keeps "good", soft red keeps "bad".
const EUBANK_TONES = {
  good: { color: '#86EFAC', glow: 'rgba(134, 239, 172, 0.55)' },
  bad: { color: '#F87171', glow: 'rgba(248, 113, 113, 0.5)' },
  gold: { color: '#4DEEEA', glow: 'rgba(77, 238, 234, 0.6)' },
} as const
const EUBANK_INK = '#1C1E24'

// Eubank captions v2, matched to the "One Shot" reference: HUGE heavy caps
// (~5-6.5% of frame width), white with a strong dark shadow, revealed as a
// whole page with a snappy spring pop. Accent words glow in the light-cyan
// signature (or mint/red for semantic good/bad) — in caps like the base, or
// as the elegant tilted italic script (rotates per page). Captions hold the
// chest band below the chin and NEVER cover the face.
const EubankCaptionPage: React.FC<{ page: ShortEditPage; widthPx: number }> = ({ page, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const h = Math.abs(Math.floor(page.start * 977))

  // Whole-page spring pop (reference: ~3-4 frames with a slight overshoot).
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 220, mass: 0.5 } })
  const scale = (page.big ? 0.8 : 0.86) + (page.big ? 0.2 : 0.14) * pop

  const sizeStep = page.big ? 0.085 : [0.06, 0.068, 0.075][Math.floor(h / 3) % 3]
  // Accent mode rotates per page: caps-glow most of the time, the tilted
  // italic script for a softer read every third accent page — and every ~5th
  // page flips SCRIPT-DOMINANT (the reference's "Hey, thanks for clicking"):
  // content words in glowing cyan script, only the glue words in white caps.
  const scriptAccent = h % 3 === 2
  const scriptDominant = h % 5 === 4
  // Intra-page size contrast (feedback: same-size words read flat): glue words
  // shrink, content words hold, accents grow — the reference's "and then the
  // AUTOMATION" hierarchy.
  const GLUE_RE = /^(the|a|an|and|or|but|of|to|in|on|at|for|is|are|was|it|i|you|we|so|that|this|with|my|me|be)[.,!?"']*$/i
  const wordScale = (w: { t: string; accent: boolean }) =>
    w.accent ? 1.18 : GLUE_RE.test(w.t) ? 0.72 : 1

  // Two-line composition (feedback: everything on one line reads flat): pages
  // of 4+ words break into a short line and a long line, and the LINES carry
  // different scales — sometimes the short opener huge and the rest smaller,
  // sometimes the payoff line dominating ("RIGHT NOW, / and then the
  // AUTOMATION"). All rotation is page-hash-seeded, so reruns re-deal it.
  const lines: Array<typeof page.words> =
    !page.big && page.words.length >= 4
      ? (() => {
          const cut = 1 + (h % 2)
          return [page.words.slice(0, cut), page.words.slice(cut)]
        })()
      : [page.words]
  const lineScales: number[] =
    lines.length === 2
      ? (Math.floor(h / 9) % 2 === 0 ? [1.2, 0.82] : [0.8, 1.14])
      : [1]

  const positionStyle: React.CSSProperties =
    page.position === 'low' ? { bottom: '26%' }
    : page.position === 'mid' ? { top: '47%' }
    : { top: '12%' }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '4%',
          width: '92%',
          textAlign: 'center',
          opacity: Math.min(1, pop * 1.5),
          scale: String(scale),
          lineHeight: 1.14,
          ...positionStyle,
        }}
      >
        {lines.map((lineWords, li) => (
        <div key={li}>
        {lineWords.map((w, i) => {
          const lineScale = lineScales[li]
          const tone = w.accent ? EUBANK_TONES[w.tone ?? 'gold'] : null
          if (scriptDominant) {
            const glue = GLUE_RE.test(w.t) && !w.accent
            if (!glue) {
              const c = tone ?? EUBANK_TONES.gold
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    fontFamily: ACCENT_FONT,
                    fontStyle: 'italic',
                    fontWeight: 700,
                    fontSize: widthPx * sizeStep * lineScale * (w.accent ? 1.3 : 1.12),
                    color: c.color,
                    rotate: '-2deg',
                    padding: '0 0.09em',
                    textShadow: `0 0 26px ${c.glow}, 0 0 9px ${c.glow}, 0 3px 12px rgba(0, 0, 0, 0.5)`,
                  }}
                >
                  {w.t}
                </span>
              )
            }
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  fontFamily: IMPACT_FONT,
                  fontSize: widthPx * sizeStep * lineScale * 0.72,
                  textTransform: 'uppercase',
                  color: '#FFFFFF',
                  padding: '0 0.08em',
                  textShadow: '0 3px 12px rgba(0, 0, 0, 0.6)',
                }}
              >
                {w.t}
              </span>
            )
          }
          if (tone && scriptAccent) {
            // Script accent: elegant italic, natural case, slight tilt and
            // scale-up — the reference's handwritten cyan moments.
            return (
              <span
                key={i}
                style={{
                  display: 'inline-block',
                  fontFamily: ACCENT_FONT,
                  fontStyle: 'italic',
                  fontWeight: 700,
                  fontSize: widthPx * sizeStep * lineScale * 1.3,
                  color: tone.color,
                  rotate: '-4deg',
                  padding: '0 0.1em',
                  textShadow: `0 0 26px ${tone.glow}, 0 0 8px ${tone.glow}, 0 3px 12px rgba(0, 0, 0, 0.5)`,
                }}
              >
                {w.t}
              </span>
            )
          }
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontFamily: IMPACT_FONT,
                fontSize: widthPx * sizeStep * lineScale * wordScale(w),
                textTransform: 'uppercase',
                letterSpacing: '-0.01em',
                color: tone ? tone.color : '#FFFFFF',
                padding: '0 0.07em',
                textShadow: tone
                  ? `0 0 24px ${tone.glow}, 0 0 8px ${tone.glow}, 0 4px 14px rgba(0, 0, 0, 0.6)`
                  : '0 4px 16px rgba(0, 0, 0, 0.65), 0 1px 4px rgba(0, 0, 0, 0.5)',
              }}
            >
              {w.t}
            </span>
          )
        })}
        </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// Opening hook (reference's first seconds): the title word doubled — solid
// white heavy caps with a glowing cyan italic echo behind/below — over a
// darkened top band with slow-falling white dust particles.
const EubankHook: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const io = interpolate(frame, [0, 8, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const title = (g.title ?? '').toUpperCase()
  // Deterministic particle field: 22 dots, each with its own fall speed and
  // sinusoidal sway, seeded by index so renders are reproducible.
  const dots = Array.from({ length: 22 }, (_, i) => {
    const seed = (i * 733) % 100
    const x = (seed / 100) * 96 + 2
    const speed = 0.55 + ((i * 397) % 50) / 100
    const y = ((seed * 1.7 + frame * speed) % 110) - 5
    const sway = Math.sin((frame + i * 31) * 0.05) * 1.6
    const size = 1.5 + ((i * 211) % 20) / 10
    return { x: x + sway, y, size, o: 0.14 + ((i * 149) % 25) / 100 }
  })

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: io }}>
      {/* darkened top band so the title owns the opening frame */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(4, 6, 10, 0.72) 0%, rgba(4, 6, 10, 0.25) 26%, transparent 45%)' }} />
      {dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.size,
            height: d.size,
            borderRadius: '50%',
            background: '#FFFFFF',
            opacity: d.o,
          }}
        />
      ))}
      {/* solid white caps + glowing cyan italic echo, like the reference */}
      <div style={{ position: 'absolute', left: '5%', width: '90%', top: '5.5%', textAlign: 'center' }}>
        <div
          style={{
            fontFamily: IMPACT_FONT,
            fontSize: widthPx * 0.085,
            letterSpacing: '0.01em',
            color: '#FFFFFF',
            textShadow: '0 4px 18px rgba(0, 0, 0, 0.6)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: `-${widthPx * 0.078}px`,
            translate: `-${widthPx * 0.01}px 0px`,
            fontFamily: ACCENT_FONT,
            fontStyle: 'italic',
            fontWeight: 700,
            fontSize: widthPx * 0.082,
            color: EUBANK_TONES.gold.color,
            opacity: 0.92,
            rotate: '-3deg',
            textShadow: `0 0 30px ${EUBANK_TONES.gold.glow}, 0 0 10px ${EUBANK_TONES.gold.glow}`,
          }}
        >
          {(g.title ?? '').toLowerCase()}
        </div>
      </div>
    </AbsoluteFill>
  )
}

// Shared dimming layer for the Eubank text graphics; optional backdrop blur for
// the cards moment (the reference blurs the speaker hard behind its framework).
const EubankDim: React.FC<{ durationInFrames: number; amount?: number; blur?: number }> = ({ durationInFrames, amount = 0.5, blur = 0 }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill
      style={{
        backgroundColor: `rgba(6, 8, 12, ${(amount * o).toFixed(3)})`,
        backdropFilter: blur > 0 ? `blur(${(blur * o).toFixed(1)}px)` : undefined,
      }}
    />
  )
}

type EubankGraphicProps = { g: NonNullable<ShortEditProps['graphics']>[number]; durationInFrames: number; widthPx: number }

// Notes-app checklist: a white rounded card springs up in the face-free band;
// items reveal AT THE MOMENT THEY'RE SPOKEN (itemAt), each with a yellow
// checkmark circle popping in.
const EubankNotes: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const items = g.items ?? []
  const atFrames = items.map((_, i) => Math.round((g.itemAt?.[i] ?? i * 0.9) * fps))
  const cardIn = spring({ frame, fps, config: { damping: 14, stiffness: 160, mass: 0.8 } })
  const out = interpolate(frame, [durationInFrames - 7, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const fromBottom = g.placement === 'bottom'

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '10%',
          width: '80%',
          top: fromBottom ? undefined : '9%',
          bottom: fromBottom ? '12%' : undefined,
          opacity: Math.min(cardIn * 1.3, out),
          translate: `0px ${(1 - cardIn) * (fromBottom ? 46 : -46)}px`,
          scale: String(0.92 + 0.08 * cardIn),
          borderRadius: widthPx * 0.024,
          background: 'rgba(252, 251, 248, 0.96)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.45)',
          padding: `${widthPx * 0.028}px ${widthPx * 0.036}px`,
        }}
      >
        <div style={{ fontFamily: VIRAL_SANS, fontSize: widthPx * 0.017, color: '#9A968E', marginBottom: '0.35em' }}>
          Notes
        </div>
        <div style={{ fontFamily: KOE_SANS, fontSize: widthPx * 0.032, color: EUBANK_INK, marginBottom: '0.55em' }}>
          {g.title}
        </div>
        {items.map((item, i) => {
          const at = atFrames[i]
          const o = interpolate(frame, [at, at + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const slide = interpolate(frame, [at, at + 6], [10, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
          const check = frame >= at
            ? spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 240, mass: 0.6 } })
            : 0
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: widthPx * 0.016, opacity: o, translate: `${slide}px 0px`, marginBottom: '0.42em' }}>
              <div
                style={{
                  width: widthPx * 0.03,
                  height: widthPx * 0.03,
                  borderRadius: '50%',
                  background: '#F5C518',
                  scale: String(0.4 + 0.6 * check),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <svg width={widthPx * 0.016} height={widthPx * 0.016} viewBox="0 0 16 16">
                  <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ fontFamily: VIRAL_SANS_STRONG, fontSize: widthPx * 0.026, color: EUBANK_INK }}>
                {item}
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

// Conceptual equation: "LEFT > RIGHT" over the dimmed frame — BIG, with the
// hierarchy in the type itself: the winner renders much larger than the loser,
// and the glowing ">" lands with a pop as the claim is made. Sits in the
// face-free band, never over the speaker.
const EubankEquation: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const leftIn = interpolate(frame, [2, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const gtAt = 15
  const gtPop = frame >= gtAt ? spring({ frame: frame - gtAt, fps, config: { damping: 11, stiffness: 230, mass: 0.6 } }) : 0
  const rightIn = interpolate(frame, [gtAt + 5, gtAt + 11], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const band = g.placement === 'top' ? { top: '16%' } : { top: '58%' }

  // Auto-shrink so long word pairs still fit one line at these display sizes.
  const chars = (g.eq?.left ?? '').length + (g.eq?.right ?? '').length
  const fit = Math.min(1, 17 / Math.max(1, chars))

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <EubankDim durationInFrames={durationInFrames} amount={0.55} />
      <div
        style={{
          position: 'absolute',
          left: '3%',
          width: '94%',
          textAlign: 'center',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          gap: widthPx * 0.026 * fit,
          ...band,
        }}
      >
        <span style={{ fontFamily: KOE_SANS, fontSize: widthPx * 0.1 * fit, color: '#FFFFFF', opacity: leftIn, textShadow: '0 0 34px rgba(255,255,255,0.45), 0 3px 16px rgba(0,0,0,0.55)' }}>
          {g.eq?.left}
        </span>
        <span
          style={{
            fontFamily: KOE_SANS,
            fontSize: widthPx * 0.105 * fit,
            color: EUBANK_TONES.gold.color,
            opacity: Math.min(1, gtPop * 1.3),
            scale: String(0.6 + 0.4 * gtPop),
            textShadow: `0 0 34px ${EUBANK_TONES.gold.glow}, 0 0 12px ${EUBANK_TONES.gold.glow}, 0 3px 14px rgba(0,0,0,0.5)`,
          }}
        >
          {'>'}
        </span>
        <span style={{ fontFamily: VIRAL_SANS_STRONG, fontSize: widthPx * 0.068 * fit, color: 'rgba(255,255,255,0.72)', opacity: rightIn, textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>
          {g.eq?.right}
        </span>
      </div>
    </AbsoluteFill>
  )
}

// Minimal stroke icon set for the method scene — the planner picks the key
// that matches what the speaker is talking about. Drawn dark on the light
// canvas with long soft diagonal shadows, like the reference's paintbrush.
const EUBANK_ICONS: Record<string, React.ReactNode> = {
  brush: (
    <>
      <path d="M46 8 L30 30" strokeWidth={5} />
      <path d="M28 32 l5 5" strokeWidth={7} />
      <path d="M26 38 c-3 6 -8 9 -13 10 c6 3 13 1 16 -4 z" fill="currentColor" strokeWidth={2} />
    </>
  ),
  bulb: (
    <>
      <path d="M32 10 a13 13 0 0 1 7 24 c-2 2 -2 4 -2 7 h-10 c0 -3 0 -5 -2 -7 a13 13 0 0 1 7 -24 z" />
      <path d="M27 47 h10 M28 52 h8" />
    </>
  ),
  target: (
    <>
      <circle cx={32} cy={32} r={20} />
      <circle cx={32} cy={32} r={11} />
      <circle cx={32} cy={32} r={3} fill="currentColor" />
    </>
  ),
  chart: (
    <>
      <path d="M12 12 v40 h40" />
      <path d="M22 44 v-12 M32 44 v-20 M42 44 v-27" strokeWidth={5} />
    </>
  ),
  pen: (
    <>
      <path d="M40 10 l10 10 -26 26 -13 3 3 -13 z" />
      <path d="M36 14 l10 10" />
    </>
  ),
  flame: (
    <path d="M32 8 c2 8 10 12 10 22 a10 10 0 0 1 -20 0 c0 -6 3 -8 4 -12 c3 3 5 4 6 -10 z" />
  ),
  dumbbell: (
    <>
      <path d="M20 32 h24" strokeWidth={5} />
      <path d="M16 22 v20 M22 25 v14 M48 22 v20 M42 25 v14" strokeWidth={5} />
    </>
  ),
  clock: (
    <>
      <circle cx={32} cy={32} r={20} />
      <path d="M32 20 v12 l8 6" />
    </>
  ),
  money: (
    <>
      <circle cx={32} cy={32} r={20} />
      <path d="M38 24 c-2 -3 -10 -3 -11 1 c-1 5 12 4 11 9 c-1 4 -9 4 -12 1 M32 19 v26" />
    </>
  ),
  rocket: (
    <>
      <path d="M32 8 c8 6 10 18 6 30 h-12 c-4 -12 -2 -24 6 -30 z" />
      <path d="M26 38 l-8 8 M38 38 l8 8 M32 42 v10" />
      <circle cx={32} cy={24} r={4} />
    </>
  ),
}

// Method scene (upgraded cross-out): a full light "blueprint" canvas cut in
// through a white flash — grid paper, a context-picked icon with long soft
// shadows, the method name in gold script, then the wrong option struck
// through and REPLACED by the right one with its changed words in mint green.
// Modeled directly on the reference's "Picasso Method / Copy Structure" scene.
const EubankMethodScene: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const flash = interpolate(frame, [0, 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const canvasIn = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: 'clamp' })
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const iconIn = interpolate(frame, [3, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const iconSettle = interpolate(frame, [3, 14], [-7, -3], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const titleIn = interpolate(frame, [8, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const titleBlur = interpolate(frame, [8, 17], [6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Phase A: wrong option + strike. Phase B: swap to the right option.
  const wrongIn = interpolate(frame, [12, 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const strikeAt = Math.round(durationInFrames * 0.32)
  const strike = interpolate(frame, [strikeAt, strikeAt + 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.6, 0, 0.3, 1) })
  const swapAt = Math.round(durationInFrames * 0.55)
  const wrongOut = interpolate(frame, [swapAt, swapAt + 5], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rightIn = interpolate(frame, [swapAt + 3, swapAt + 9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rightRise = interpolate(frame, [swapAt + 3, swapAt + 10], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })

  // Words in the right option that don't appear in the wrong one go mint —
  // "Copy [Structure]" — so the CHANGE is what carries the color.
  const wrongWords = new Set((g.strike?.wrong ?? '').toLowerCase().split(/\s+/))
  const rightWords = (g.strike?.right ?? '').split(/\s+/).filter(Boolean)
  const icon = EUBANK_ICONS[g.icon ?? ''] ?? EUBANK_ICONS.bulb
  const iconSize = widthPx * 0.2

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: out }}>
      {/* light blueprint canvas with a faint grid */}
      <AbsoluteFill
        style={{
          opacity: canvasIn,
          background: 'linear-gradient(168deg, #F2F1EE 0%, #EAE9E5 60%, #E2E1DC 100%)',
        }}
      >
        <AbsoluteFill
          style={{
            backgroundImage:
              'linear-gradient(rgba(40,42,48,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(40,42,48,0.045) 1px, transparent 1px)',
            backgroundSize: `${widthPx * 0.09}px ${widthPx * 0.09}px`,
          }}
        />
      </AbsoluteFill>

      {/* icon with the reference's long diagonal soft shadows */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '17%',
          translate: `-50% 0px`,
          opacity: iconIn,
          rotate: `${iconSettle}deg`,
          filter: 'drop-shadow(22px 30px 16px rgba(45,47,52,0.20)) drop-shadow(48px 66px 38px rgba(45,47,52,0.12))',
        }}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 64 64"
          style={{ color: '#3A3E45' }}
          fill="none"
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </div>

      {/* method name in gold script, glowing */}
      {g.title ? (
        <div
          style={{
            position: 'absolute',
            left: '5%',
            width: '90%',
            top: '34%',
            textAlign: 'center',
            opacity: titleIn,
            filter: `blur(${titleBlur.toFixed(1)}px) drop-shadow(0 0 18px rgba(226, 178, 74, 0.55)) drop-shadow(0 3px 10px rgba(120, 90, 20, 0.25))`,
            fontFamily: EUBANK_SCRIPT,
            fontSize: widthPx * 0.085,
            backgroundImage: 'linear-gradient(175deg, #F4D98A 10%, #E2A93C 48%, #C98F1E 78%, #F0CE7E 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {g.title}
        </div>
      ) : null}

      {/* cross-out → replacement */}
      <div style={{ position: 'absolute', left: '6%', width: '88%', top: g.title ? '47%' : '42%', textAlign: 'center' }}>
        {wrongOut > 0.01 ? (
          <div style={{ position: 'relative', display: 'inline-block', opacity: wrongIn * wrongOut }}>
            <span style={{ fontFamily: EUBANK_LIGHT, fontSize: widthPx * 0.062, color: '#3B3E44', letterSpacing: '0.01em' }}>
              {g.strike?.wrong}
            </span>
            <div
              style={{
                position: 'absolute',
                left: '-2%',
                top: '54%',
                width: '104%',
                height: widthPx * 0.007,
                background: '#3B3E44',
                borderRadius: 4,
                transformOrigin: 'left center',
                scale: `${strike} 1`,
                rotate: '-1.6deg',
              }}
            />
          </div>
        ) : null}
        {rightIn > 0.01 ? (
          <div style={{ position: 'absolute', left: 0, width: '100%', top: 0, opacity: rightIn, translate: `0px ${rightRise}px` }}>
            {rightWords.map((w, i) => {
              const changed = !wrongWords.has(w.toLowerCase())
              return (
                <span
                  key={i}
                  style={{
                    fontFamily: changed ? BOLD_FONT : EUBANK_LIGHT,
                    fontSize: widthPx * 0.072,
                    color: changed ? '#7ED99A' : '#3B3E44',
                    padding: '0 0.09em',
                    ...(changed ? { filter: 'drop-shadow(0 0 14px rgba(126, 217, 154, 0.65))' } : {}),
                  }}
                >
                  {w}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* white flash cut-in */}
      {flash > 0.01 ? <AbsoluteFill style={{ backgroundColor: '#FFFFFF', opacity: flash }} /> : null}
    </AbsoluteFill>
  )
}

// Framework scene: big glowing labels cascade diagonally across the heavily
// blurred speaker (thin first word, bold rest — the reference's "Effective /
// Concept" type), thin connector lines draw an L-path between them, and a
// frosted-glass card with a giant checkmark lands in the middle carrying the
// verdict ("[ Winner ]") and an optional grounded stat.
const EubankCards: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const items = (g.items ?? []).slice(0, 3)
  const out = interpolate(frame, [durationInFrames - 7, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Diagonal cascade positions (2 labels: TL + BR like the reference; a third
  // slots top-right, ABOVE the center card's zone — labels and card must never
  // share pixels). Widths cap each label so long copy wraps inside its corner
  // instead of reaching the middle.
  const SPOTS: Array<React.CSSProperties> = [
    { left: '8%', top: '11%', textAlign: 'left', width: '46%' },
    { right: '8%', top: '70%', textAlign: 'right', width: '52%' },
    { right: '6%', top: '24%', textAlign: 'right', width: '42%' },
  ]

  const cardAt = Math.round(1.5 * fps)
  const cardIn = frame >= cardAt ? spring({ frame: frame - cardAt, fps, config: { damping: 13, stiffness: 165, mass: 0.8 } }) : 0
  const statIn = interpolate(frame, [cardAt + 10, cardAt + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const label = (item: string, i: number) => {
    const at = Math.round((0.25 + i * 0.75) * fps)
    const o = interpolate(frame, [at, at + 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const glow = interpolate(frame, [at, at + 12], [0.2, 0.65], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    const rise = interpolate(frame, [at, at + 8], [14, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    const words = item.split(/\s+/)
    const first = words[0] ?? ''
    const rest = words.slice(1).join(' ')
    return (
      <div key={i} style={{ position: 'absolute', ...SPOTS[i], opacity: o, translate: `0px ${rise}px` }}>
        <div
          style={{
            fontFamily: EUBANK_LIGHT,
            fontSize: widthPx * 0.055,
            lineHeight: 1.05,
            color: '#FFFFFF',
            textShadow: `0 0 30px rgba(255,255,255,${glow.toFixed(2)}), 0 2px 14px rgba(0,0,0,0.45)`,
          }}
        >
          {first}
        </div>
        {rest ? (
          <div
            style={{
              fontFamily: KOE_SANS,
              fontSize: widthPx * 0.063,
              lineHeight: 1.05,
              color: '#FFFFFF',
              textShadow: `0 0 34px rgba(255,255,255,${glow.toFixed(2)}), 0 2px 14px rgba(0,0,0,0.45)`,
            }}
          >
            {rest}
          </div>
        ) : null}
      </div>
    )
  }

  // Thin L-path connectors: TL label down → into the card; card out → down to
  // the BR label. Drawn with scale transforms, staggered after the labels.
  const lineA = interpolate(frame, [Math.round(0.7 * fps), Math.round(1.3 * fps)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const lineB = interpolate(frame, [Math.round(1.2 * fps), Math.round(1.8 * fps)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const LINE = 'rgba(255, 255, 255, 0.55)'

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: out }}>
      <EubankDim durationInFrames={durationInFrames} amount={0.6} blur={14} />

      {items.map((item, i) => label(item, i))}

      {/* connector L-paths */}
      <div style={{ position: 'absolute', left: '13%', top: '25%', width: 1.5, height: '22%', background: LINE, transformOrigin: 'top', scale: `1 ${lineA}` }} />
      <div style={{ position: 'absolute', left: '13%', top: '47%', width: '22%', height: 1.5, background: LINE, transformOrigin: 'left', scale: `${lineA} 1`, opacity: lineA > 0.95 ? 1 : 0 }} />
      <div style={{ position: 'absolute', right: '13%', top: '52%', width: '22%', height: 1.5, background: LINE, transformOrigin: 'right', scale: `${lineB} 1` }} />
      <div style={{ position: 'absolute', right: '13%', top: '52%', width: 1.5, height: '14%', background: LINE, transformOrigin: 'top', scale: `1 ${lineB}`, opacity: lineB > 0.95 ? 1 : 0 }} />

      {/* frosted winner card with the giant checkmark */}
      <div
        style={{
          position: 'absolute',
          left: '33%',
          top: '38%',
          width: '34%',
          height: '25%',
          opacity: Math.min(1, cardIn * 1.3),
          scale: String(0.85 + 0.15 * cardIn),
          borderRadius: widthPx * 0.03,
          border: '1px solid rgba(255, 255, 255, 0.4)',
          background: 'rgba(235, 235, 238, 0.3)',
          backdropFilter: 'blur(16px) saturate(1.15)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
        }}
      >
        <svg
          viewBox="0 0 16 16"
          style={{ position: 'absolute', left: '12%', top: '4%', width: '80%', height: '92%', opacity: 0.4 }}
        >
          <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#33373D" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: '100%',
            top: '44%',
            textAlign: 'center',
            fontFamily: VIRAL_SANS,
            // Longer verdicts shrink to stay on one line inside the card —
            // "[ Creator Approach ]" must never wrap its bracket.
            fontSize: widthPx * Math.min(0.033, 0.44 / ((g.title ?? 'Winner').length + 4)),
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            color: '#FFFFFF',
            textShadow: '0 1px 10px rgba(0,0,0,0.35)',
          }}
        >
          [ {g.title} ]
        </div>
        {g.stat ? (
          <div
            style={{
              position: 'absolute',
              left: '9%',
              bottom: '7%',
              display: 'flex',
              alignItems: 'center',
              gap: widthPx * 0.008,
              opacity: statIn,
              fontFamily: VIRAL_SANS_STRONG,
              fontSize: widthPx * 0.022,
              color: '#FFFFFF',
              textShadow: '0 1px 8px rgba(0,0,0,0.35)',
            }}
          >
            <svg width={widthPx * 0.022} height={widthPx * 0.022} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2}>
              <path d="M2 12 c3 -5 7 -7 10 -7 s7 2 10 7 c-3 5 -7 7 -10 7 s-7 -2 -10 -7 z" />
              <circle cx={12} cy={12} r={3} />
            </svg>
            {g.stat}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}

// Quote panel: the spoken sentence composed as a multi-line typographic block
// over the dimmed, blurred frame — thin light base words, BOLD white emphasis,
// and semantic green/red words with glow (the reference's "a mediocre idea,
// but in a proven format will out-perform..." panel). Words build in as they
// would be spoken.
const EubankKeyword: React.FC<EubankGraphicProps> = ({ g, durationInFrames, widthPx }) => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 5, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9']/g, '')
  const emphasis = new Map((g.emphasis ?? []).map(e => [norm(e.word), e.tone ?? 'gold'] as const))
  const words = (g.title ?? '').split(/\s+/).filter(Boolean)

  // Wrap into lines of ~4 words so the block reads as composed typography,
  // not a runaway single line.
  const perLine = words.length <= 6 ? 3 : 4
  const lines: string[][] = []
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine))

  const top = g.placement === 'bottom' ? '56%' : '38%'
  let order = 0

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <EubankDim durationInFrames={durationInFrames} amount={0.62} blur={9} />
      <div style={{ position: 'absolute', left: '10%', width: '80%', top, opacity: o, textAlign: 'left', lineHeight: 1.45 }}>
        {lines.map((line, li) => (
          <div key={li}>
            {line.map((w, wi) => {
              const at = 3 + order++ * 2.2
              const wo = interpolate(frame, [at, at + 4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
              const tone = emphasis.get(norm(w))
              const toneColor = tone === 'good' ? EUBANK_TONES.good : tone === 'bad' ? EUBANK_TONES.bad : null
              const strong = tone !== undefined
              return (
                <span
                  key={wi}
                  style={{
                    display: 'inline-block',
                    fontFamily: strong ? KOE_SANS : EUBANK_LIGHT,
                    fontSize: widthPx * 0.046,
                    color: toneColor ? toneColor.color : strong ? '#FFFFFF' : 'rgba(244, 244, 242, 0.9)',
                    opacity: wo,
                    paddingRight: '0.32em',
                    textShadow: toneColor
                      ? `0 0 24px ${toneColor.glow}, 0 2px 10px rgba(0,0,0,0.5)`
                      : strong
                      ? '0 0 22px rgba(255,255,255,0.45), 0 2px 10px rgba(0,0,0,0.5)'
                      : '0 0 14px rgba(255,255,255,0.18), 0 2px 10px rgba(0,0,0,0.5)',
                  }}
                >
                  {w}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

// Julie's opening focus: the frame edges darken while the subject stays bright,
// easing away after a couple of seconds — the reference's spotlight hook.
const HookSpotlight: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame()
  const strength = interpolate(frame, [0, 8, durationInFrames - 14, durationInFrames], [0, 0.62, 0.62, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        background: `radial-gradient(ellipse 62% 46% at 50% 36%, transparent 42%, rgba(6, 8, 14, ${strength}) 100%)`,
      }}
    />
  )
}

function wordStyle(style: Exclude<CaptionStyleName, 'viral' | 'koe' | 'julie' | 'eubank'>, accent: boolean, baseSize: number): React.CSSProperties {
  if (style === 'impact') {
    return {
      fontFamily: IMPACT_FONT,
      fontSize: accent ? baseSize * 1.16 : baseSize * 1.04,
      color: accent ? '#FFD84D' : '#ffffff',
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
      padding: '0 0.07em',
      textShadow: '0 3px 14px rgba(0, 0, 0, 0.55)',
    }
  }
  if (style === 'editorial') {
    return {
      fontFamily: accent ? BOLD_FONT : BASE_FONT,
      fontWeight: accent ? 700 : 600,
      fontSize: accent ? baseSize * 1.06 : baseSize,
      color: accent ? '#FFB742' : '#ffffff',
      padding: '0 0.06em',
      textShadow: '0 2px 10px rgba(0, 0, 0, 0.45)',
    }
  }
  // serif (the UGC reference look)
  return accent
    ? {
        fontFamily: ACCENT_FONT,
        fontStyle: 'italic',
        fontWeight: 600,
        fontSize: baseSize * 1.18,
        backgroundImage: 'linear-gradient(175deg, #f4f8fd 8%, #b9cbe4 45%, #7d9cc7 78%, #dde8f5 100%)',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        padding: '0 0.06em',
        filter: 'drop-shadow(0 2px 6px rgba(20, 30, 50, 0.35))',
      }
    : {
        fontFamily: BASE_FONT,
        fontWeight: 600,
        fontSize: baseSize,
        color: '#ffffff',
        textShadow: '0 2px 10px rgba(0, 0, 0, 0.4)',
        padding: '0 0.06em',
      }
}

// Animated photographic grain + a breathing top light, rendered OVER every
// layer so footage, B-roll cards, and type share one surface — the single
// biggest "graded, not composited" signal. Deterministic: the noise seed and
// jitter both derive from the frame, so renders are reproducible.
const FilmGrain: React.FC = () => {
  const frame = useCurrentFrame()
  const seed = Math.floor(frame / 2) % 40
  const jx = (frame * 7) % 6
  const jy = (frame * 11) % 6
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.05,
          transform: `translate(${jx}px, ${jy}px) scale(1.03)`,
          mixBlendMode: 'overlay',
        }}
      >
        <filter id="edit-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#edit-grain)" />
      </svg>
      {/* Soft warm key light drifting from the top — reads as intentional grading */}
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(255, 242, 226, 0.06) 0%, transparent 24%)',
          mixBlendMode: 'soft-light',
        }}
      />
    </AbsoluteFill>
  )
}

const CaptionPage: React.FC<{ page: ShortEditPage; widthPx: number; style: CaptionStyleName }> = ({ page, widthPx, style }) => {
  const frame = useCurrentFrame()

  if (style === 'viral') return <ViralCaptionPage page={page} widthPx={widthPx} />
  // 'koe' never reaches this dispatch — its pages render as collage GROUPS
  // (KoeCollageGroup) straight from the main composition.
  if (style === 'julie') return <JulieCaptionPage page={page} widthPx={widthPx} />
  if (style === 'eubank') return <EubankCaptionPage page={page} widthPx={widthPx} />

  const opacity = interpolate(frame, [0, 3], [0, 1], { extrapolateRight: 'clamp' })
  const rise = interpolate(frame, [0, 4], [14, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
  // Impact pages land with a quick scale pop instead of the gentle rise.
  const pop = style === 'impact'
    ? interpolate(frame, [0, 5], [1.08, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
    : 1

  const baseSize = widthPx * (style === 'impact' ? 0.058 : 0.054)
  // Editorial keeps captions anchored low — its calm identity; the other
  // styles float with the planner's position rotation.
  const position = style === 'editorial' ? 'low' : page.position
  const positionStyle: React.CSSProperties =
    position === 'low' ? { bottom: '17%' }
    : position === 'mid' ? { top: '46%' }
    : { top: '11%' }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '7%',
          width: '86%',
          textAlign: 'center',
          opacity,
          translate: `0px ${style === 'impact' ? 0 : rise}px`,
          scale: String(pop),
          lineHeight: 1.22,
          ...positionStyle,
        }}
      >
        {page.words.map((w, i) => {
          // Words build one by one instead of the whole page appearing at once —
          // accent words land with a scale pop, plain words just breathe in.
          const at = i * 2
          const wo = interpolate(frame, [at, at + 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          const wpop = w.accent || style === 'impact'
            ? interpolate(frame, [at, at + 6], [1.12, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
            : 1
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                padding: '0 0.14em',
                ...wordStyle(style, w.accent, baseSize),
                opacity: wo,
                scale: String(wpop),
              }}
            >
              {w.t}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

export const ShortEdit: React.FC<ShortEditProps> = ({
  videoFile,
  segments,
  pages,
  broll = [],
  transitionStyle = 'blur',
  captionStyle = 'serif',
  matte,
  credit,
  graphics = [],
  tag,
  grade,
  hookSpotlight,
  handheld,
  splits = [],
  faceArea,
  koeMotifs = [],
  sfx = [],
  width = 1080,
}) => {
  const { fps } = useVideoConfig()
  // eubank gets the strongest punched framings (the reference jumps 1.15-1.25x
  // between "shots"); viral is a notch gentler; koe and julie gentler still.
  const eubank = captionStyle === 'eubank'
  const viral = captionStyle === 'viral' || eubank
  const koe = captionStyle === 'koe' || captionStyle === 'julie'

  // Cumulative frame offsets for each segment on the edited timeline.
  const offsets: number[] = []
  let acc = 0
  for (const seg of segments) {
    offsets.push(acc)
    acc += Math.max(1, Math.round(seg.duration * fps))
  }

  // Behind-subject pages render INSIDE the first segment (under the matte) so
  // they inherit its zoom transform; everything else renders as top captions.
  // Without a staged matte the behind flag is meaningless — keep those pages on top.
  const behindPages = viral && matte ? pages.filter(p => p.behind && p.start < matte.durationSec) : []
  const topPages = pages.filter(p => !behindPages.includes(p))

  // Koe (v6): pages sharing a koeGroup render as ONE accumulating collage.
  // Pages without a group (planner fallback) become singleton collages, so the
  // identity holds even when the planning pass never ran.
  const koeCaption = captionStyle === 'koe'
  type KoeGroup = { pages: ShortEditPage[]; start: number; end: number }
  const koeGroups: KoeGroup[] = []
  if (koeCaption) {
    const byId = new Map<number, ShortEditPage[]>()
    let synth = -1
    for (const p of topPages) {
      const id = p.koeGroup ?? synth--
      const arr = byId.get(id)
      if (arr) arr.push(p)
      else byId.set(id, [p])
    }
    for (const groupPages of byId.values()) {
      koeGroups.push({
        pages: groupPages,
        start: groupPages[0].start,
        end: groupPages[groupPages.length - 1].end,
      })
    }
    koeGroups.sort((a, b) => a.start - b.start)
    // Hold each finished collage a beat before it breathes out — but never
    // into the next collage's entrance.
    koeGroups.forEach((g, i) => {
      const next = koeGroups[i + 1]
      g.end = next ? Math.min(g.end + 0.35, next.start - 0.02) : g.end + 0.35
    })
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <FootageStage splits={splits} faceArea={faceArea}>
        {segments.map((seg, i) => {
          const durationInFrames = Math.max(1, Math.round(seg.duration * fps))
          return (
            <Sequence key={i} from={offsets[i]} durationInFrames={durationInFrames}>
              <SegmentClip
                videoFile={videoFile}
                seg={seg}
                durationInFrames={durationInFrames}
                viral={viral}
                koe={koe}
                eubank={eubank}
                handheld={handheld}
                grade={grade}
                widthPx={width}
                matte={i === 0 ? matte : undefined}
                behindPages={i === 0 ? behindPages : []}
              />
            </Sequence>
          )
        })}
      </FootageStage>

      {hookSpotlight ? (
        <Sequence from={0} durationInFrames={Math.round(2.4 * fps)}>
          <HookSpotlight durationInFrames={Math.round(2.4 * fps)} />
        </Sequence>
      ) : null}

      {credit ? (
        <Sequence from={Math.round(1.6 * fps)} durationInFrames={Math.round(3.6 * fps)}>
          <CreditTag credit={credit} widthPx={width} />
        </Sequence>
      ) : null}

      {broll.map((item, i) => {
        const from = Math.round(item.start * fps)
        const durationInFrames = Math.max(2, Math.round(item.duration * fps))
        return (
          <Sequence key={`broll-${i}`} from={from} durationInFrames={durationInFrames}>
            <BrollClip item={item} durationInFrames={durationInFrames} transitionStyle={transitionStyle} widthPx={width} />
          </Sequence>
        )
      })}

      {graphics.map((g, i) => {
        const from = Math.round(g.start * fps)
        const durationInFrames = Math.max(6, Math.round(g.duration * fps))
        const C =
          g.kind === 'title' ? KoeTitle
          : g.kind === 'list' ? KoeList
          : g.kind === 'venn' ? KoeVenn
          : g.kind === 'notes' ? EubankNotes
          : g.kind === 'equation' ? EubankEquation
          : g.kind === 'crossout' ? EubankMethodScene
          : g.kind === 'cards' ? EubankCards
          : g.kind === 'hook' ? EubankHook
          : EubankKeyword
        return (
          <Sequence key={`gfx-${i}`} from={from} durationInFrames={durationInFrames}>
            <C g={g} durationInFrames={durationInFrames} widthPx={width} />
          </Sequence>
        )
      })}

      {tag ? (
        <Sequence from={Math.round(tag.start * fps)} durationInFrames={Math.max(6, Math.round(tag.durationSec * fps))}>
          <KoeTag tag={tag} durationInFrames={Math.max(6, Math.round(tag.durationSec * fps))} widthPx={width} />
        </Sequence>
      ) : null}

      {sfx.map((cue, i) => (
        <Sequence
          key={`sfx-${i}`}
          from={Math.max(0, Math.round(cue.start * fps))}
          durationInFrames={Math.max(2, Math.round((cue.durationSec ?? 0.9) * fps))}
        >
          <Audio src={staticFile(cue.file)} volume={cue.volume} />
        </Sequence>
      ))}

      {/* Koe numerals sit UNDER the caption collages — a section marker the
          phrases float over, exactly like the reference. */}
      {koeCaption ? koeMotifs.map((m, i) => {
        const from = Math.round(m.start * fps)
        const durationInFrames = Math.max(6, Math.round((m.end - m.start) * fps))
        return (
          <Sequence key={`koemotif-${i}`} from={from} durationInFrames={durationInFrames}>
            <KoeMotifNumeral m={m} durationInFrames={durationInFrames} widthPx={width} />
          </Sequence>
        )
      }) : null}

      {koeCaption
        ? koeGroups.map((g, i) => {
            const from = Math.round(g.start * fps)
            const durationInFrames = Math.max(4, Math.round((g.end - g.start) * fps))
            return (
              <Sequence key={`koegrp-${i}`} from={from} durationInFrames={durationInFrames}>
                <KoeCollageGroup pages={g.pages} groupStart={g.start} durationInFrames={durationInFrames} widthPx={width} />
              </Sequence>
            )
          })
        : topPages.map((page, i) => {
            const from = Math.round(page.start * fps)
            const durationInFrames = Math.max(2, Math.round((page.end - page.start) * fps))
            return (
              <Sequence key={`cap-${i}`} from={from} durationInFrames={durationInFrames}>
                <CaptionPage page={page} widthPx={width} style={captionStyle} />
              </Sequence>
            )
          })}

      {/* Grain LAST — over footage, B-roll, and type alike, so every layer
          shares one photographic surface instead of reading as composited. */}
      {grade === 'cinematic' ? <FilmGrain /> : null}

    </AbsoluteFill>
  )
}
