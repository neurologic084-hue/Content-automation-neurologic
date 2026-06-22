'use client'

interface PulseLoaderProps {
  label?: string
  sublabel?: string
}

export function PulseLoader({ label = 'Generating...', sublabel }: PulseLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5">
      {/* Concentric pulse rings + mountain core */}
      <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
        {/* Ring 3 — outermost, slowest */}
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: 88, height: 88,
            border: '1px solid #FF4F17',
            opacity: 0.12,
            animationDuration: '2.4s',
            animationDelay: '0.6s',
          }}
        />
        {/* Ring 2 */}
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: 60, height: 60,
            border: '1px solid #FF4F17',
            opacity: 0.22,
            animationDuration: '2.4s',
            animationDelay: '0.3s',
          }}
        />
        {/* Ring 1 — innermost */}
        <div
          className="absolute rounded-full animate-ping"
          style={{
            width: 40, height: 40,
            border: '1.5px solid #FF4F17',
            opacity: 0.35,
            animationDuration: '2.4s',
          }}
        />
        {/* Core icon — gentle pulse */}
        <div
          className="relative flex items-center justify-center rounded-2xl animate-pulse"
          style={{
            width: 48, height: 48,
            background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)',
            boxShadow: '0 0 24px rgba(255,79,23,0.35)',
            animationDuration: '1.8s',
          }}
        >
          <svg width="22" height="20" viewBox="0 0 18 16" fill="none">
            <path d="M9 1 L17 15 L1 15 Z" fill="white" />
            <path d="M9 1 L13.5 9 L4.5 9 Z" fill="white" fillOpacity="0.28" />
          </svg>
        </div>
      </div>

      {/* Labels */}
      <div className="text-center">
        <p className="text-[14px] font-semibold text-[#18181B]">{label}</p>
        {sublabel && (
          <p className="text-[12px] text-[#A1A1AA] mt-1 max-w-[200px] leading-relaxed">{sublabel}</p>
        )}
      </div>
    </div>
  )
}

// Full-screen overlay — used for the relearning/training moment
export function PulseOverlay({ label, sublabel }: PulseLoaderProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(10px)' }}
    >
      <PulseLoader label={label} sublabel={sublabel} />
    </div>
  )
}
