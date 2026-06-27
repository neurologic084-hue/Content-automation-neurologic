import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

export const IntroCard: React.FC<{ name?: string; tagline?: string }> = ({
  name = 'Jessica Wendling',
  tagline = 'Glow Med Spa · Seattle',
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const rise = spring({ frame, fps, config: { damping: 220, mass: 0.7 } })
  const y = interpolate(rise, [0, 1], [32, 0])
  const tagO = interpolate(frame, [18, 38], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const lineW = interpolate(frame, [10, 30], [0, 140], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: brand.bg, justifyContent: 'center', alignItems: 'center' }}>
      {/* Subtle radial glow */}
      <div style={{
        position: 'absolute',
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(201,168,76,0.12) 0%, transparent 70%)`,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />

      <div style={{ opacity: rise, transform: `translateY(${y}px)`, textAlign: 'center' }}>
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

        {/* Gold accent line */}
        <div style={{
          margin: '20px auto',
          height: 1,
          width: lineW,
          background: `linear-gradient(90deg, transparent, ${brand.gold}, transparent)`,
        }} />

        <div style={{
          opacity: tagO,
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
  )
}
