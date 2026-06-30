import React from 'react'
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { IntroCard } from '../components/IntroCard'
import { IntroCardBold } from '../components/IntroCardBold'
import { Callout } from '../components/Callout'
import { OutroCard } from '../components/OutroCard'
import { OutroCardBold } from '../components/OutroCardBold'
import { LowerThird } from '../components/LowerThird'
import { LowerThirdBold } from '../components/LowerThirdBold'
import { KeywordCallout } from '../components/KeywordCallout'
import { KeywordCalloutBold } from '../components/KeywordCalloutBold'
import { Stat } from '../components/Stat'
import { List } from '../components/List'

export type Graphic = {
  type: 'intro_card' | 'lower_third' | 'keyword_callout' | 'stat' | 'list' | 'callout' | 'outro_card'
  text: string
  startSec: number
  durationSec: number
}

export type OverlayProps = {
  graphics: Graphic[]
  durationSec?: number
  style?: 'minimal' | 'bold'
  width?: number
  height?: number
}

function renderGraphic(g: Graphic, style: 'minimal' | 'bold') {
  if (style === 'bold') {
    switch (g.type) {
      case 'intro_card':       return <IntroCardBold tagline={g.text} />
      case 'lower_third':      return <LowerThirdBold text={g.text} />
      case 'keyword_callout':  return <KeywordCalloutBold text={g.text} />
      case 'stat':             return <Stat text={g.text} />
      case 'list':             return <List text={g.text} />
      case 'outro_card':       return <OutroCardBold cta={g.text} />
      default:                 return <Callout text={g.text} />
    }
  }
  switch (g.type) {
    case 'intro_card':       return <IntroCard tagline={g.text} />
    case 'lower_third':      return <LowerThird text={g.text} />
    case 'keyword_callout':  return <KeywordCallout text={g.text} />
    case 'stat':             return <Stat text={g.text} />
    case 'list':             return <List text={g.text} />
    case 'outro_card':       return <OutroCard cta={g.text} />
    default:                 return <Callout text={g.text} />
  }
}

// Transparent track — composited over the edited video via FFmpeg. Each
// graphic is a Sequence placed at its timestamp from the manifest; `style`
// picks which visual treatment (minimal house style or the punchier bold
// variant) renders the whole set.
export const Overlay: React.FC<OverlayProps> = ({ graphics = [], style = 'minimal' }) => {
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      {graphics.map((g, i) => (
        <Sequence
          key={i}
          from={Math.round(g.startSec * fps)}
          durationInFrames={Math.max(15, Math.round(g.durationSec * fps))}
        >
          {renderGraphic(g, style)}
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
