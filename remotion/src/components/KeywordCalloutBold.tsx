import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Punchier counterpart to KeywordCallout: a sharp rectangular tag with a
// scale-pop + slight rotation settle instead of a soft pill fade-in.
export const KeywordCalloutBold: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const pop = spring({ frame, fps, config: { damping: 9, mass: 0.45 } })
  const scale = interpolate(pop, [0, 1], [0.4, 1])
  const rotate = interpolate(pop, [0, 1], [-6, 0])
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', padding: '96px 36px 0' }}>
      <div style={{
        opacity: Math.min(pop, out),
        transform: `scale(${scale}) rotate(${rotate}deg)`,
        maxWidth: '88%',
        background: brand.blue,
        padding: '14px 32px',
        borderRadius: 4,
      }}>
        <div style={{
          fontFamily: brand.fontBody,
          fontWeight: 900,
          fontSize: 28,
          color: brand.bg,
          textAlign: 'center',
          textTransform: 'uppercase' as const,
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  )
}
