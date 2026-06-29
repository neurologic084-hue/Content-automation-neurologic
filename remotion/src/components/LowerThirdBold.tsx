import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Punchier counterpart to LowerThird: fast slide-in from the left with a
// solid color block instead of a glass-blur card.
export const LowerThirdBold: React.FC<{ text: string; attribution?: string }> = ({
  text,
  attribution = 'NEURO LOGIC',
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const slide = spring({ frame, fps, config: { damping: 11, mass: 0.5 } })
  const x = interpolate(slide, [0, 1], [-500, 0])
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 0 160px' }}>
      <div style={{
        opacity: Math.min(slide, out),
        transform: `translateX(${x}px)`,
        maxWidth: '88%',
        background: brand.blue,
      }}>
        <div style={{ padding: '16px 28px' }}>
          <div style={{
            fontFamily: brand.fontBody,
            fontWeight: 900,
            fontSize: 32,
            lineHeight: 1.2,
            color: brand.bg,
            textTransform: 'uppercase' as const,
          }}>
            {text}
          </div>
          <div style={{
            marginTop: 4,
            fontFamily: brand.fontBody,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: 'rgba(10,10,12,0.65)',
          }}>
            {attribution}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
