import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'
import { brand } from '../brand'
import { ShimmerText } from '../ShimmerText'

// No solid background -- footage and audio keep playing right through the
// outro, just like the intro's small-header phase. A cursive sign-off near
// the top plus a bold caption lower-third fade in over the last couple
// seconds instead of replacing the footage with a static card.
const SIGNOFF_IN: [number, number] = [6, 16]
const CAPTION_IN: [number, number] = [14, 26]

export const OutroCard: React.FC<{ cta?: string; signoff?: string }> = ({
  cta = 'Book your first visit',
  signoff = 'Thanks!',
}) => {
  const frame = useCurrentFrame()

  const signoffO = interpolate(frame, SIGNOFF_IN, [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const signoffY = interpolate(signoffO, [0, 1], [-16, 0])
  const captionO = interpolate(frame, CAPTION_IN, [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const captionX = interpolate(captionO, [0, 1], [-30, 0])

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', padding: '90px 36px 0' }}>
        <div style={{ opacity: signoffO, transform: `translateY(${signoffY}px)` }}>
          <ShimmerText fontSize={56} fontStyle="italic">
            {signoff}
          </ShimmerText>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 40px 130px' }}>
        <div style={{
          opacity: captionO,
          transform: `translateX(${captionX}px)`,
          maxWidth: '85%',
          fontFamily: brand.fontBody,
          fontWeight: 800,
          fontSize: 34,
          lineHeight: 1.25,
          color: brand.text,
          textTransform: 'uppercase' as const,
        }}>
          {cta}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
