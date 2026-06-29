import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Punchier counterpart to OutroCard: solid color blocks with overshoot
// pop/slide instead of the cursive sign-off + glass caption.
export const OutroCardBold: React.FC<{ cta?: string; signoff?: string }> = ({
  cta = 'Book your first visit',
  signoff = "Let's go",
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const signoffPop = spring({ frame: frame - 6, fps, config: { damping: 9, mass: 0.4 } })
  const signoffScale = interpolate(signoffPop, [0, 1], [0.5, 1])

  const captionSlide = spring({ frame: frame - 14, fps, config: { damping: 12, mass: 0.5 } })
  const captionX = interpolate(captionSlide, [0, 1], [-400, 0])

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', padding: '90px 36px 0' }}>
        <div style={{
          opacity: Math.min(signoffPop, 1),
          transform: `scale(${signoffScale})`,
          background: brand.blue,
          padding: '10px 30px',
          borderRadius: 6,
        }}>
          <div style={{
            fontFamily: brand.fontBody,
            fontWeight: 900,
            fontSize: 32,
            color: brand.bg,
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
          }}>
            {signoff}
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 0 130px' }}>
        <div style={{
          opacity: Math.min(captionSlide, 1),
          transform: `translateX(${captionX}px)`,
          background: brand.blue,
          padding: '18px 40px',
          maxWidth: '92%',
        }}>
          <div style={{
            fontFamily: brand.fontBody,
            fontWeight: 900,
            fontSize: 34,
            lineHeight: 1.2,
            color: brand.bg,
            textTransform: 'uppercase' as const,
          }}>
            {cta}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
