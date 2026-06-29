import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Punchier counterpart to IntroCard: a quick overshoot scale-pop + flash
// instead of a calm fade, then snaps to the small header faster.
const SHRINK_START = 9
const SHRINK_END = 14
const FADE_START = 70
const FADE_END = 84

export const IntroCardBold: React.FC<{ name?: string; tagline?: string }> = ({
  name = 'Jessica Wendling',
  tagline = 'Neuro Logic · Seattle',
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const pop = spring({ frame, fps, config: { damping: 10, mass: 0.4 } })
  const entranceScale = interpolate(pop, [0, 1], [0.6, 1])
  const flashOpacity = interpolate(frame, [0, 4, 10], [0, 0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  const shrink = interpolate(frame, [SHRINK_START, SHRINK_END], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const shrinkScale = interpolate(shrink, [0, 1], [1, 0.42])
  const y = interpolate(shrink, [0, 1], [0, -740])
  const rotate = interpolate(shrink, [0, 1], [0, -2])
  const fadeOut = interpolate(frame, [FADE_START, FADE_END], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: brand.blue, opacity: flashOpacity }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          opacity: fadeOut,
          transform: `translateY(${y}px) scale(${entranceScale * shrinkScale}) rotate(${rotate}deg)`,
          textAlign: 'center',
        }}>
          <div style={{ display: 'inline-block', background: brand.blue, padding: '10px 28px', borderRadius: 8 }}>
            <div style={{
              fontFamily: brand.fontBody,
              fontWeight: 900,
              fontSize: 60,
              letterSpacing: '-0.01em',
              color: brand.bg,
              textTransform: 'uppercase' as const,
            }}>
              {name}
            </div>
          </div>
          <div style={{
            marginTop: 14,
            fontFamily: brand.fontBody,
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: '0.08em',
            color: brand.text,
          }}>
            {tagline}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
