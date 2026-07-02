import React from 'react'
import { Composition, registerRoot } from 'remotion'
import { Overlay, type OverlayProps } from './compositions/Overlay'
import { ShortEdit, type ShortEditProps } from './compositions/ShortEdit'

const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Overlay"
      component={Overlay}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ graphics: [] } as OverlayProps}
      calculateMetadata={({ props }) => {
        const last = (props.graphics ?? []).reduce(
          (m, g) => Math.max(m, (g.startSec ?? 0) + (g.durationSec ?? 3)),
          0
        )
        const secs = props.durationSec ?? last ?? 30
        return {
          durationInFrames: Math.max(30, Math.round(secs * 30)),
          fps: 30,
          // Matches whatever shape the source footage actually is -- the base
          // video is never cropped to a fixed aspect ratio anymore, so the
          // overlay has to follow it instead of assuming vertical.
          width: props.width ?? 1080,
          height: props.height ?? 1920,
        }
      }}
    />
    <Composition
      id="ShortEdit"
      component={ShortEdit}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ videoFile: '', segments: [], pages: [] } as ShortEditProps}
      calculateMetadata={({ props }) => {
        const fps = props.fps ?? 30
        const totalFrames = (props.segments ?? []).reduce(
          (a, s) => a + Math.max(1, Math.round((s.duration ?? 0) * fps)),
          0
        )
        return {
          durationInFrames: Math.max(30, totalFrames),
          fps,
          width: props.width ?? 1080,
          height: props.height ?? 1920,
        }
      }}
    />
  </>
)

registerRoot(RemotionRoot)
