import React from 'react'
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { IntroCard } from '../components/IntroCard'
import { Callout } from '../components/Callout'
import { OutroCard } from '../components/OutroCard'

export type Graphic = {
  type: 'intro_card' | 'callout' | 'outro_card'
  text: string
  startSec: number
  durationSec: number
}

export type OverlayProps = {
  graphics: Graphic[]
  durationSec?: number
}

function renderGraphic(g: Graphic) {
  switch (g.type) {
    case 'intro_card': return <IntroCard tagline={g.text} />
    case 'outro_card': return <OutroCard cta={g.text} />
    default:           return <Callout text={g.text} />
  }
}

// Transparent track — composited over the Submagic-captioned video via FFmpeg.
// Each graphic is a Sequence placed at its timestamp from the manifest.
export const Overlay: React.FC<OverlayProps> = ({ graphics = [] }) => {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      {graphics.map((g, i) => (
        <Sequence
          key={i}
          from={Math.round(g.startSec * fps)}
          durationInFrames={Math.max(15, Math.round(g.durationSec * fps))}
        >
          {renderGraphic(g)}
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
