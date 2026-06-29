import React from 'react'
import { useCurrentFrame, interpolate } from 'remotion'

// Metallic shimmer text with a slow moving highlight sweep, same treatment
// as OVRHAUL's GoldText, recolored to Neuro Logic blue.
export const ShimmerText: React.FC<{
  children: React.ReactNode
  fontSize: number
  fontWeight?: number
  letterSpacing?: string
  fontStyle?: string
}> = ({ children, fontSize, fontWeight = 400, letterSpacing = '0', fontStyle = 'normal' }) => {
  const f = useCurrentFrame()
  const pos = interpolate(f % 150, [0, 150], [180, -80])
  return (
    <span style={{
      fontSize,
      fontWeight,
      letterSpacing,
      fontStyle,
      backgroundImage: 'linear-gradient(100deg, #2E5FA3 0%, #4F8FE3 30%, #D6E8FB 50%, #4F8FE3 70%, #2E5FA3 100%)',
      backgroundSize: '220% 100%',
      backgroundPosition: `${pos}% 50%`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      color: 'transparent',
      display: 'inline-block',
      filter: 'drop-shadow(0 2px 12px rgba(79,143,227,0.25))',
    }}>
      {children}
    </span>
  )
}
