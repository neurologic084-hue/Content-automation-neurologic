import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Top-anchored banner for a single punchy phrase — distinct placement from
// Callout (left-aligned card) and LowerThird (bottom bar) so several types
// used across one video don't all land in the same spot.
export const KeywordCallout: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const inP = spring({ frame, fps, config: { damping: 180, mass: 0.5 } })
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(inP, [0, 1], [-24, 0])

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', padding: '96px 36px 0' }}>
      <div style={{
        opacity: Math.min(inP, out),
        transform: `translateY(${y}px)`,
        maxWidth: '88%',
        borderRadius: 999,
        background: brand.blue,
        padding: '14px 32px',
        boxShadow: '0 12px 30px rgba(79,143,227,0.35)',
      }}>
        <div style={{
          fontFamily: brand.fontBody,
          fontWeight: 700,
          fontSize: 28,
          color: brand.bg,
          textAlign: 'center',
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  )
}
