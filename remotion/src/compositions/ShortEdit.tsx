// ── ShortEdit: the Remotion-only full edit (v6) ───────────────────────────────
// One composition renders the entire edited short: cut segments of the source
// footage (silences/retakes already planned out), subtle per-segment zooms,
// quick blur joins between segments, soft whoosh SFX at the joins, and the
// reference-style caption system (Title Case, white sans base, italic serif
// accent words with a silver-blue gradient, floating position).
//
// Design rule: RESTRAINT. Every effect here is subtle on purpose — the goal is
// "professionally edited", never "AI-generated busy".

import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { loadFont } from '@remotion/fonts'

const BASE_FONT = 'EditCapBase'
const ACCENT_FONT = 'EditCapAccent'
const BOLD_FONT = 'EditCapBold'
const IMPACT_FONT = 'EditCapImpact'

loadFont({ family: BASE_FONT, url: staticFile('fonts/Poppins-SemiBold.ttf') }).catch(() => undefined)
loadFont({ family: ACCENT_FONT, url: staticFile('fonts/PlayfairDisplay-Italic.ttf') }).catch(() => undefined)
loadFont({ family: BOLD_FONT, url: staticFile('fonts/Poppins-Bold.ttf') }).catch(() => undefined)
loadFont({ family: IMPACT_FONT, url: staticFile('fonts/Anton-Regular.ttf') }).catch(() => undefined)

export type ShortEditSegment = {
  srcStart: number               // seconds into the SOURCE footage
  duration: number               // seconds on the edited timeline
  zoom: 'in' | 'out' | 'none'
}

export type ShortEditPage = {
  start: number                  // edited-timeline seconds
  end: number
  position: 'low' | 'mid' | 'high'
  words: { t: string; accent: boolean }[]
}

export type ShortEditBroll = {
  start: number                  // edited-timeline seconds
  duration: number
  file: string                   // filename inside remotion/public/
  kind: 'video' | 'image'
  layout: 'card' | 'cover'
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
  // something (entering/leaving a cover).
  transitionStyle?: 'blur' | 'flash' | 'punch'
  captionStyle?: 'serif' | 'editorial' | 'impact'  // the variant's caption identity
  // Event-driven audio cues, fully planned pipeline-side (lib/render-kit.ts):
  // cover in/out transitions, card entrances, and at most two emphasis pops.
  sfx?: Array<{ file: string; start: number; volume: number }>
}


// One cut of the source footage. Joins between segments are SILENT HARD CUTS —
// like the reference video's angle changes — with only the slow zoom creep
// giving each segment its own feel. Transitions live on B-roll covers instead.
const SegmentClip: React.FC<{
  videoFile: string
  seg: ShortEditSegment
  durationInFrames: number
}> = ({ videoFile, seg, durationInFrames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  // Slow continuous creep across the whole segment — the professional look is
  // barely-noticeable motion, not a snap zoom.
  const zoomRange: [number, number] =
    seg.zoom === 'in' ? [1.03, 1.1] : seg.zoom === 'out' ? [1.1, 1.03] : [1.0, 1.0]
  const scale = interpolate(frame, [0, durationInFrames], zoomRange, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })

  return (
    <AbsoluteFill style={{ scale: String(scale), transformOrigin: '50% 32%' }}>
      <OffthreadVideo
        src={staticFile(videoFile)}
        startFrom={Math.round(seg.srcStart * fps)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  )
}

// B-roll cutaway. Two grammars from the reference video:
//   card  — a rounded photo/video card floating over the footage, gentle
//           rise-in and a slow Ken Burns drift so it never feels static.
//   cover — full-screen insert that OWNS the transition: the variant's style
//           (blur/flash/punch) plays going IN and, gentler, coming back OUT.
const BrollClip: React.FC<{
  item: ShortEditBroll
  durationInFrames: number
  transitionStyle: 'blur' | 'flash' | 'punch'
}> = ({ item, durationInFrames, transitionStyle }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const appear = interpolate(frame, [0, 4], [0, 1], { extrapolateRight: 'clamp' })
  const kenBurns = interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.3, 0, 0.7, 1),
  })
  const media = item.kind === 'video'
    ? <OffthreadVideo src={staticFile(item.file)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : <Img src={staticFile(item.file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  if (item.layout === 'cover') {
    const IN = 6
    const outStart = Math.max(IN, durationInFrames - 6)

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
        <AbsoluteFill style={{ scale: String(kenBurns * punchScale), filter: blurAmt > 0.2 ? `blur(${blurAmt}px)` : undefined }}>
          {media}
        </AbsoluteFill>
        {flashAmt > 0.01 ? <AbsoluteFill style={{ backgroundColor: '#fff', opacity: flashAmt }} /> : null}
      </AbsoluteFill>
    )
  }

  const rise = interpolate(frame, [0, 5], [26, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
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

// Three caption identities, one per Remotion variant. All share the same page
// timing/animation system; only the typography changes:
//   serif     (v6) — white sans base + italic serif accents with a silver-blue
//                    gradient (the UGC reference look)
//   editorial (v4) — clean Poppins, calm and minimal, accents in warm amber
//   impact    (v5) — condensed ALL-CAPS Anton, accents in bold yellow, chunky
type CaptionStyleName = 'serif' | 'editorial' | 'impact'

function wordStyle(style: CaptionStyleName, accent: boolean, baseSize: number): React.CSSProperties {
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
  // serif (the reference look)
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

const CaptionPage: React.FC<{ page: ShortEditPage; widthPx: number; style: CaptionStyleName }> = ({ page, widthPx, style }) => {
  const frame = useCurrentFrame()
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
        {page.words.map((w, i) => (
          <span key={i} style={wordStyle(style, w.accent, baseSize)}>
            {w.t}{' '}
          </span>
        ))}
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
  sfx = [],
  width = 1080,
}) => {
  const { fps } = useVideoConfig()

  // Cumulative frame offsets for each segment on the edited timeline.
  const offsets: number[] = []
  let acc = 0
  for (const seg of segments) {
    offsets.push(acc)
    acc += Math.max(1, Math.round(seg.duration * fps))
  }

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
            />
          </Sequence>
        )
      })}

      {broll.map((item, i) => {
        const from = Math.round(item.start * fps)
        const durationInFrames = Math.max(2, Math.round(item.duration * fps))
        return (
          <Sequence key={`broll-${i}`} from={from} durationInFrames={durationInFrames}>
            <BrollClip item={item} durationInFrames={durationInFrames} transitionStyle={transitionStyle} />
          </Sequence>
        )
      })}

      {sfx.map((cue, i) => (
        <Sequence key={`sfx-${i}`} from={Math.max(0, Math.round(cue.start * fps))} durationInFrames={Math.round(fps * 0.9)}>
          <Audio src={staticFile(cue.file)} volume={cue.volume} />
        </Sequence>
      ))}

      {pages.map((page, i) => {
        const from = Math.round(page.start * fps)
        const durationInFrames = Math.max(2, Math.round((page.end - page.start) * fps))
        return (
          <Sequence key={`cap-${i}`} from={from} durationInFrames={durationInFrames}>
            <CaptionPage page={page} widthPx={width} style={captionStyle} />
          </Sequence>
        )
      })}

    </AbsoluteFill>
  )
}
