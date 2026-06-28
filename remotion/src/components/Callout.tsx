import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

export const Callout: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()

  const inP = spring({ frame, fps, config: { damping: 180, mass: 0.5 } })
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const x = interpolate(inP, [0, 1], [-60, 0])
  const blur = interpolate(inP, [0, 1], [10, 0])
  const sweep = interpolate(frame % 120, [0, 120], [220, -120])

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'flex-start', padding: '110px 44px' }}>
      <div style={{
        opacity: Math.min(inP, out),
        transform: `translateX(${x}px)`,
        filter: `blur(${blur}px)`,
        maxWidth: '80%',
        borderRadius: 14,
        padding: '14px 24px 14px 22px',
        background: 'rgba(14,14,18,0.60)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: `1px solid rgba(79,143,227,0.45)`,
        boxShadow: '0 16px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Gold left bar */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: 4,
          background: `linear-gradient(180deg, ${brand.blueLight}, ${brand.blue}, #2E5FA3)`,
        }} />

        {/* Sheen sweep */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(112deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)',
          backgroundSize: '220% 100%',
          backgroundPosition: `${sweep}% 0`,
          pointerEvents: 'none',
        }} />

        <div style={{
          fontFamily: brand.fontBody,
          fontWeight: 600,
          fontSize: 34,
          lineHeight: 1.25,
          color: brand.text,
          paddingLeft: 10,
          letterSpacing: '-0.01em',
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  )
}
