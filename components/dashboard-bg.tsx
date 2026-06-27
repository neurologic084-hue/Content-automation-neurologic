'use client'

export function DashboardBg() {
  return (
    <>
      <style>{`
        @keyframes orbA {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          33%       { transform: translate(40px, -30px) scale(1.06); }
          66%       { transform: translate(-25px, 20px) scale(0.94); }
        }
        @keyframes orbB {
          0%, 100% { transform: translate(0px, 0px) scale(1); }
          40%       { transform: translate(-35px, 28px) scale(1.08); }
          70%       { transform: translate(22px, -18px) scale(0.96); }
        }
        @keyframes orbC {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50%       { transform: translate(-50%, -50%) scale(1.12); }
        }
        @keyframes gridFade {
          0%, 100% { opacity: 0.018; }
          50%       { opacity: 0.032; }
        }
      `}</style>

      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0,
          overflow: 'hidden', pointerEvents: 'none', zIndex: 0,
        }}
      >
        {/* Dot grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, #FF4F17 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          animation: 'gridFade 8s ease-in-out infinite',
        }} />

        {/* Orb 1 — warm orange, upper area */}
        <div style={{
          position: 'absolute',
          top: '2%', left: '10%',
          width: 520, height: 520,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,79,23,0.09) 0%, transparent 68%)',
          animation: 'orbA 20s ease-in-out infinite',
        }} />

        {/* Orb 2 — amber, lower right */}
        <div style={{
          position: 'absolute',
          bottom: '8%', right: '5%',
          width: 420, height: 420,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(251,146,60,0.07) 0%, transparent 65%)',
          animation: 'orbB 26s ease-in-out infinite',
        }} />

        {/* Orb 3 — subtle center pulse */}
        <div style={{
          position: 'absolute',
          top: '45%', left: '55%',
          width: 560, height: 560,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,200,140,0.04) 0%, transparent 60%)',
          animation: 'orbC 30s ease-in-out infinite',
        }} />
      </div>
    </>
  )
}
