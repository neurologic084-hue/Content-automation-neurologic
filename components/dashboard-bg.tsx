'use client'

export function DashboardBg() {
  return (
    <>
      <style>{`
        @keyframes blobA {
          0%   { transform: translate(0px,   0px)   scale(1);    border-radius: 60% 40% 70% 30% / 50% 60% 40% 50%; }
          25%  { transform: translate(60px,  -50px) scale(1.08); border-radius: 40% 60% 30% 70% / 60% 40% 60% 40%; }
          50%  { transform: translate(30px,  80px)  scale(0.93); border-radius: 70% 30% 50% 50% / 40% 70% 30% 60%; }
          75%  { transform: translate(-40px, 30px)  scale(1.05); border-radius: 30% 70% 60% 40% / 50% 30% 70% 50%; }
          100% { transform: translate(0px,   0px)   scale(1);    border-radius: 60% 40% 70% 30% / 50% 60% 40% 50%; }
        }
        @keyframes blobB {
          0%   { transform: translate(0px,  0px)    scale(1);    border-radius: 40% 60% 50% 50% / 60% 40% 60% 40%; }
          30%  { transform: translate(-70px, 60px)  scale(1.1);  border-radius: 60% 40% 30% 70% / 40% 60% 40% 60%; }
          60%  { transform: translate(50px,  -40px) scale(0.9);  border-radius: 50% 50% 70% 30% / 50% 50% 30% 70%; }
          100% { transform: translate(0px,  0px)    scale(1);    border-radius: 40% 60% 50% 50% / 60% 40% 60% 40%; }
        }
        @keyframes blobC {
          0%   { transform: translate(0px,  0px)    scale(1);    border-radius: 50% 50% 40% 60% / 40% 60% 50% 50%; }
          40%  { transform: translate(80px,  50px)  scale(1.07); border-radius: 70% 30% 60% 40% / 60% 40% 30% 70%; }
          70%  { transform: translate(-30px, -60px) scale(0.92); border-radius: 30% 70% 40% 60% / 50% 50% 70% 30%; }
          100% { transform: translate(0px,  0px)    scale(1);    border-radius: 50% 50% 40% 60% / 40% 60% 50% 50%; }
        }
        @keyframes gradientShift {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-dashboard-bg] * { animation: none !important; }
        }
      `}</style>

      <div
        data-dashboard-bg=""
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 0,
          animation: 'gradientShift 12s ease-in-out infinite',
        }}
      >
        {/* Blob 1: large warm orange, top-left */}
        <div style={{
          position: 'absolute',
          top: '-5%',
          left: '-8%',
          width: 520,
          height: 480,
          background: 'radial-gradient(ellipse at center, rgba(255,79,23,0.22) 0%, rgba(255,120,50,0.12) 45%, transparent 72%)',
          animation: 'blobA 18s ease-in-out infinite',
          willChange: 'transform',
        }} />

        {/* Blob 2: amber, bottom-right */}
        <div style={{
          position: 'absolute',
          bottom: '-10%',
          right: '-6%',
          width: 580,
          height: 500,
          background: 'radial-gradient(ellipse at center, rgba(251,146,60,0.20) 0%, rgba(253,186,116,0.10) 45%, transparent 70%)',
          animation: 'blobB 24s ease-in-out infinite',
          willChange: 'transform',
        }} />

        {/* Blob 3: deep orange, center */}
        <div style={{
          position: 'absolute',
          top: '30%',
          left: '35%',
          width: 440,
          height: 420,
          background: 'radial-gradient(ellipse at center, rgba(255,79,23,0.13) 0%, rgba(255,150,80,0.07) 50%, transparent 72%)',
          animation: 'blobC 30s ease-in-out infinite',
          willChange: 'transform',
        }} />

        {/* Subtle dot grid overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,79,23,0.06) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
      </div>
    </>
  )
}
