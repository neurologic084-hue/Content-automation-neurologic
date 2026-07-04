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

loadFont({ family: BASE_FONT, url: staticFile('fonts/Poppins-SemiBold.ttf') }).catch(() => undefined)
loadFont({ family: ACCENT_FONT, url: staticFile('fonts/PlayfairDisplay-Italic.ttf') }).catch(() => undefined)
loadFont({ family: BOLD_FONT, url: staticFile('fonts/Poppins-Bold.ttf') }).catch(() => undefined)
loadFont({ family: IMPACT_FONT, url: staticFile('fonts/Anton-Regular.ttf') }).catch(() => undefined)
loadFont({ family: VIRAL_SANS, url: staticFile('fonts/Inter-Medium.ttf') }).catch(() => undefined)
loadFont({ family: VIRAL_SANS_STRONG, url: staticFile('fonts/Inter-SemiBold.ttf') }).catch(() => undefined)
loadFont({ family: VIRAL_SERIF_UP, url: staticFile('fonts/PlayfairDisplay-Bold.ttf') }).catch(() => undefined)
loadFont({ family: VIRAL_BLOCK, url: staticFile('fonts/ArchivoBlack-Regular.ttf') }).catch(() => undefined)
// Dan Koe (v6) family: heavy italic serif for the glowing floating titles,
// bold neutral sans for captions/labels, mono for the red-line tag.
const KOE_SERIF = 'EditKoeSerif'
const KOE_SANS = 'EditKoeSans'
const KOE_MONO = 'EditKoeMono'
const KOE_MONO_BOLD = 'EditKoeMonoBold'
loadFont({ family: KOE_SERIF, url: staticFile('fonts/PlayfairDisplay-ExtraBoldItalic.ttf') }).catch(() => undefined)
loadFont({ family: KOE_SANS, url: staticFile('fonts/Inter-Bold.ttf') }).catch(() => undefined)
loadFont({ family: KOE_MONO, url: staticFile('fonts/SpaceMono-Regular.ttf') }).catch(() => undefined)
loadFont({ family: KOE_MONO_BOLD, url: staticFile('fonts/SpaceMono-Bold.ttf') }).catch(() => undefined)
// Julie (v4) accent: heavy italic geometric sans for the two-tone keywords.
const JULIE_ACCENT = 'EditJulieAccent'
loadFont({ family: JULIE_ACCENT, url: staticFile('fonts/Poppins-BoldItalic.ttf') }).catch(() => undefined)

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
  words: { t: string; accent: boolean }[]
  // Viral two-tier grammar (see lib/edit-plan.ts). Inclusive word-index range.
  accentRange?: [number, number]
  accentFont?: 'serif' | 'block'
  accentColor?: 'gold' | 'copper' | 'orange' | 'purple' | 'gradient'
  big?: boolean                  // poster treatment over a full-screen cover
  behind?: boolean               // hook page rendered behind the subject matte
}

export type ShortEditBroll = {
  start: number                  // edited-timeline seconds
  duration: number
  file: string                   // filename inside remotion/public/
  kind: 'video' | 'image'
  layout: 'card' | 'cover'
  // Designed poster card (viral): media floats on a gradient canvas with this
  // copy as the card's own headline. file may be '' — the poster then renders
  // as a typography-only animation. Palette rotates per card.
  design?: { kicker: string; headline: string; palette?: 'champagne' | 'dusk' | 'blush' }
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
  captionStyle?: 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie'
  // Transparent-webm foreground of the speaker for the first seconds; lets the
  // hook caption render behind them (best-effort, staged pipeline-side).
  matte?: { file: string; durationSec: number }
  // Optional guest credit, bottom-left over the early footage (viral style).
  credit?: { name: string; title: string }
  // Koe (v6) context-driven graphics, planned pipeline-side (lib/koe-graphics.ts).
  graphics?: Array<{
    start: number
    duration: number
    kind: 'title' | 'list' | 'venn'
    placement?: 'top' | 'bottom'   // face-aware: text goes where the face isn't
    title?: string
    subtitleBase?: string
    subtitleWords?: string[]
    items?: string[]
    itemAt?: number[]              // per-item reveal times (s, relative), spoken-synced
    left?: { label: string; items: string[] }
    right?: { label: string; items: string[] }
  }>
  // Koe red-line tag (name or CTA), mono type with a drawn red vertical rule.
  tag?: { line1: string; line2?: string; start: number; durationSec: number }
  // Subtle cinematic grade + vignette on the footage.
  grade?: 'cinematic'
  // Julie's opening focus effect: edges darken, subject stays bright (~2.4s).
  hookSpotlight?: boolean
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
  grade?: 'cinematic'
  widthPx: number
  matte?: { file: string; durationSec: number }
  behindPages?: ShortEditPage[]
}> = ({ videoFile, seg, durationInFrames, viral, koe, grade, widthPx, matte, behindPages = [] }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Viral: punched-in bases with a whisper of drift (the cut itself is the
  // "zoom"); koe: the same alternating-framing idea but gentler, always
  // drifting IN like the reference; others: the original slow creep.
  const zoomRange: [number, number] = viral
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

  const inner = (
    <AbsoluteFill style={{ scale: String(scale), transformOrigin: '50% 32%' }}>
      <OffthreadVideo
        src={staticFile(videoFile)}
        startFrom={Math.round(seg.srcStart * fps)}
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
    ? <OffthreadVideo src={staticFile(item.file)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
const BrollClip: React.FC<{
  item: ShortEditBroll
  durationInFrames: number
  transitionStyle: 'blur' | 'flash' | 'punch' | 'slide'
  widthPx: number
}> = ({ item, durationInFrames, transitionStyle, widthPx }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const appear = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })
  const kenBurns = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  // file may be '' for typography-only designed posters (DesignedCover guards).
  const media = !item.file ? null : item.kind === 'video'
    ? <OffthreadVideo src={staticFile(item.file)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <Img src={staticFile(item.file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  if (item.layout === 'cover') {
    const IN = transitionStyle === 'slide' ? 7 : 6
    const outStart = Math.max(IN, durationInFrames - (transitionStyle === 'slide' ? 7 : 6))

    const content = item.design
      ? <DesignedCover item={item} durationInFrames={durationInFrames} widthPx={widthPx} />
      : (
        <AbsoluteFill style={{ backgroundColor: '#000' }}>
          <AbsoluteFill style={{ scale: String(kenBurns) }}>{media}</AbsoluteFill>
        </AbsoluteFill>
      )

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
// viral and koe have dedicated renderers.
type CaptionStyleName = 'serif' | 'editorial' | 'impact' | 'viral' | 'koe' | 'julie'

// Koe captions: tiny bold sentence-case sans, centered just below the chest —
// deliberately quiet so the graphics and footage carry the frame.
const KoeCaptionPage: React.FC<{ page: ShortEditPage; widthPx: number }> = ({ page, widthPx }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 2], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: '10%',
          width: '80%',
          bottom: '31%',
          textAlign: 'center',
          opacity,
          fontFamily: KOE_SANS,
          fontSize: widthPx * 0.036,
          color: '#FFFFFF',
          textShadow: '0 2px 10px rgba(0, 0, 0, 0.65)',
          letterSpacing: '0.005em',
        }}
      >
        {page.words.map(w => w.t).join(' ')}
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

function wordStyle(style: Exclude<CaptionStyleName, 'viral' | 'koe' | 'julie'>, accent: boolean, baseSize: number): React.CSSProperties {
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
  if (style === 'koe') return <KoeCaptionPage page={page} widthPx={widthPx} />
  if (style === 'julie') return <JulieCaptionPage page={page} widthPx={widthPx} />

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
  sfx = [],
  width = 1080,
}) => {
  const { fps } = useVideoConfig()
  const viral = captionStyle === 'viral'
  // koe and julie share the gentle punched-framing zoom grammar.
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

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
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
              grade={grade}
              widthPx={width}
              matte={i === 0 ? matte : undefined}
              behindPages={i === 0 ? behindPages : []}
            />
          </Sequence>
        )
      })}

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
        const C = g.kind === 'title' ? KoeTitle : g.kind === 'list' ? KoeList : KoeVenn
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

      {topPages.map((page, i) => {
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
