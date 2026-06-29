import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'
import { brand } from '../brand'
import { MeshBackground } from '../MeshBackground'
import { ShimmerText } from '../ShimmerText'

// Big and centered just long enough to read, then snaps up into a small
// pinned header within well under a second -- the footage and its audio are
// already playing underneath from frame 0, so the big phase has to be brief
// or it reads as a mismatch (seeing the card, hearing the speaker).
const BIG_HOLD_END = 9   // ~0.3s @ 30fps
const SHRINK_END = 16    // ~0.53s
const FADE_START = 75    // ~2.5s
const FADE_END = 90      // ~3s

export const IntroCard: React.FC<{ name?: string; tagline?: string }> = ({
  name = 'Jessica Wendling',
  tagline = 'Neuro Logic · Seattle',
}) => {
  const frame = useCurrentFrame()
  const { height } = useVideoConfig()

  const shrink = interpolate(frame, [BIG_HOLD_END, SHRINK_END], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scale = interpolate(shrink, [0, 1], [1, 0.4])
  // Proportional to the actual frame height, not a fixed pixel offset --
  // the base footage is never force-cropped to a fixed aspect ratio anymore.
  const y = interpolate(shrink, [0, 1], [0, -height * 0.4])
  const bgOpacity = interpolate(shrink, [0, 1], [1, 0.22])
  const fadeOut = interpolate(frame, [FADE_START, FADE_END], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: bgOpacity * fadeOut }}>
        <MeshBackground />
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          opacity: fadeOut,
          transform: `translateY(${y}px) scale(${scale})`,
          textAlign: 'center',
        }}>
          <ShimmerText fontSize={80} letterSpacing="0.06em">
            {name}
          </ShimmerText>

          <div style={{
            margin: '20px auto',
            height: 1,
            width: 140,
            background: `linear-gradient(90deg, transparent, ${brand.blue}, transparent)`,
          }} />

          <div style={{
            fontFamily: brand.fontBody,
            fontSize: 22,
            letterSpacing: '0.22em',
            textTransform: 'uppercase' as const,
            color: brand.textMuted,
          }}>
            {tagline}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
