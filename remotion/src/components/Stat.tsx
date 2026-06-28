import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// Splits a leading number/percentage off the planner's text (e.g. "3x Faster
// Bookings" -> "3x" + "Faster Bookings") so it renders big; falls back to
// showing the whole phrase large if no clear numeric lead is found.
function splitStat(text: string): { big: string; label: string } {
  const match = text.match(/^([\d][\d.,]*%?x?\+?)\s*(.*)$/i)
  if (match && match[2]) return { big: match[1], label: match[2] }
  return { big: text, label: '' }
}

export const Stat: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const { big, label } = splitStat(text)

  const inP = spring({ frame, fps, config: { damping: 200, mass: 0.7 } })
  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const scale = interpolate(inP, [0, 1], [0.85, 1])

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 50px' }}>
      <div style={{ opacity: Math.min(inP, out), transform: `scale(${scale})`, textAlign: 'center' }}>
        <div style={{
          fontFamily: brand.fontDisplay,
          fontWeight: 700,
          fontSize: 100,
          lineHeight: 1,
          color: brand.purple,
        }}>
          {big}
        </div>
        {label && (
          <div style={{
            marginTop: 10,
            fontFamily: brand.fontBody,
            fontSize: 26,
            letterSpacing: '0.04em',
            color: brand.text,
          }}>
            {label}
          </div>
        )}
      </div>
    </AbsoluteFill>
  )
}
