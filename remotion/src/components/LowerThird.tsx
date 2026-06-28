import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

export const LowerThird: React.FC<{ text: string; attribution?: string }> = ({
  text,
  attribution = 'Jessica Wendling · Neuro Logic',
}) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const inP = spring({ frame, fps, config: { damping: 200, mass: 0.6 } })
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const x = interpolate(inP, [0, 1], [-40, 0])

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 44px 160px' }}>
      <div style={{
        opacity: Math.min(inP, out),
        transform: `translateX(${x}px)`,
        maxWidth: '82%',
        borderRadius: 10,
        background: 'rgba(10,10,12,0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderLeft: `4px solid ${brand.blue}`,
        padding: '16px 26px',
      }}>
        <div style={{
          fontFamily: brand.fontBody,
          fontWeight: 700,
          fontSize: 32,
          lineHeight: 1.2,
          color: brand.text,
        }}>
          {text}
        </div>
        <div style={{
          marginTop: 6,
          fontFamily: brand.fontBody,
          fontSize: 16,
          letterSpacing: '0.1em',
          textTransform: 'uppercase' as const,
          color: brand.blue,
        }}>
          {attribution}
        </div>
      </div>
    </AbsoluteFill>
  )
}
