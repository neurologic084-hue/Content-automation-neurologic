import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'
import { brand } from '../brand'

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

  const shrink = interpolate(frame, [BIG_HOLD_END, SHRINK_END], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scale = interpolate(shrink, [0, 1], [1, 0.4])
  const y = interpolate(shrink, [0, 1], [0, -760])
  const bgOpacity = interpolate(shrink, [0, 1], [1, 0])
  const vignetteOpacity = interpolate(shrink, [0, 1], [0, 0.55])
  const fadeOut = interpolate(frame, [FADE_START, FADE_END], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: brand.bg, opacity: bgOpacity }} />
      <AbsoluteFill style={{
        background: `linear-gradient(180deg, rgba(0,0,0,${vignetteOpacity}) 0%, transparent 70%)`,
      }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          opacity: fadeOut,
          transform: `translateY(${y}px) scale(${scale})`,
          textAlign: 'center',
        }}>
          <div style={{
            fontFamily: brand.fontDisplay,
            fontWeight: 400,
            fontSize: 80,
            letterSpacing: '0.06em',
            color: brand.text,
            lineHeight: 1.1,
          }}>
            {name}
          </div>

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
