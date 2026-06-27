import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

export const OutroCard: React.FC<{ cta?: string }> = ({
  cta = 'Book your first visit',
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const rise = spring({ frame, fps, config: { damping: 200, mass: 0.8 } })
  const y = interpolate(rise, [0, 1], [28, 0])
  const btnO = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const lineW = interpolate(frame, [8, 25], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: brand.bg, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{
        position: 'absolute',
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: `radial-gradient(circle, rgba(201,168,76,0.10) 0%, transparent 70%)`,
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />

      <div style={{ opacity: rise, transform: `translateY(${y}px)`, textAlign: 'center', padding: '0 60px' }}>
        <div style={{
          fontFamily: brand.fontDisplay,
          fontWeight: 400,
          fontSize: 54,
          letterSpacing: '0.02em',
          color: brand.text,
          lineHeight: 1.2,
        }}>
          {cta}
        </div>

        <div style={{
          margin: '18px auto',
          height: 1,
          width: lineW,
          background: `linear-gradient(90deg, transparent, ${brand.gold}, transparent)`,
        }} />

        <div style={{
          opacity: btnO,
          marginTop: 32,
          display: 'inline-block',
          fontFamily: brand.fontBody,
          fontSize: 20,
          letterSpacing: '0.18em',
          textTransform: 'uppercase' as const,
          color: brand.gold,
          border: `1px solid ${brand.gold}`,
          padding: '14px 36px',
          borderRadius: 6,
        }}>
          Link in bio
        </div>
      </div>
    </AbsoluteFill>
  )
}
