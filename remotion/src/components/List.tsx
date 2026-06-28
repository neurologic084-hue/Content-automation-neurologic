import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion'
import { brand } from '../brand'

// The planner writes list items as "Item one | Item two | Item three" in the
// shared `text` field — split here instead of widening the manifest schema.
function splitItems(text: string): string[] {
  return text.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 4)
}

export const List: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames } = useVideoConfig()
  const items = splitItems(text)

  const out = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', padding: '0 50px' }}>
      <div style={{ width: '100%' }}>
        {items.map((item, i) => {
          const rowIn = spring({ frame: frame - i * 6, fps, config: { damping: 200, mass: 0.5 } })
          const x = interpolate(rowIn, [0, 1], [-30, 0])
          return (
            <div
              key={i}
              style={{
                opacity: Math.min(rowIn, out),
                transform: `translateX(${x}px)`,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                marginBottom: 22,
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: brand.blue, flexShrink: 0 }} />
              <div style={{
                fontFamily: brand.fontBody,
                fontWeight: 600,
                fontSize: 32,
                lineHeight: 1.25,
                color: brand.text,
              }}>
                {item}
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
