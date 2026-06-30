import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'

type Blob = { color: string; size: number; x: number; y: number; ax: number; ay: number; period: number }

// Drifting blurred color blobs + dot grid + slow light sweep, same treatment
// as OVRHAUL's MeshBackground, recolored to Neuro Logic blue. All units are
// percentages so it scales cleanly at whatever frame size the source footage
// actually is (no longer assuming a fixed 1080x1920).
export const MeshBackground: React.FC<{ base?: string; blobs?: Blob[]; grid?: boolean }> = ({
  base = '#0A0A0C',
  blobs,
  grid = true,
}) => {
  const f = useCurrentFrame()
  const bl: Blob[] = blobs || [
    { color: 'rgba(79,143,227,0.32)', size: 70, x: -5, y: 5, ax: 8, ay: 10, period: 240 },
    { color: 'rgba(143,193,245,0.22)', size: 60, x: 55, y: 35, ax: -9, ay: -6, period: 300 },
    { color: 'rgba(139,92,246,0.16)', size: 65, x: 25, y: 70, ax: 6, ay: -8, period: 360 },
  ]
  const drift = (b: Blob, axis: 'x' | 'y') => {
    const base0 = axis === 'x' ? b.x : b.y
    const amp = axis === 'x' ? b.ax : b.ay
    const phase = (f % b.period) / b.period
    return base0 + amp * Math.sin(phase * Math.PI * 2)
  }
  const sweep = interpolate(f % 360, [0, 360], [150, -150])
  return (
    <AbsoluteFill style={{ backgroundColor: base, overflow: 'hidden' }}>
      {bl.map((b, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: `${b.size}%`,
          height: `${b.size}%`,
          left: `${drift(b, 'x')}%`,
          top: `${drift(b, 'y')}%`,
          background: `radial-gradient(circle, ${b.color}, transparent 68%)`,
          filter: 'blur(70px)',
        }} />
      ))}
      {grid && (
        <AbsoluteFill style={{
          backgroundImage: 'radial-gradient(circle at center, rgba(240,237,232,0.10) 1px, transparent 1.6px)',
          backgroundSize: '34px 34px',
          opacity: 0.5,
        }} />
      )}
      <AbsoluteFill style={{
        background: 'linear-gradient(115deg, transparent 40%, rgba(240,237,232,0.10) 50%, transparent 60%)',
        backgroundSize: '240% 100%',
        backgroundPosition: `${sweep}% 0`,
        mixBlendMode: 'overlay',
      }} />
    </AbsoluteFill>
  )
}
