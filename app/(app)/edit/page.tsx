import Link from 'next/link'

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
    title: 'AI-Assisted Cuts',
    description: 'Upload your raw footage — AI identifies the best takes, trims silences, and assembles a rough cut matched to your script timing.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Auto-Captions & Subtitles',
    description: 'Word-level captions generated from your script — synced automatically. Styled for short-form, fully editable.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="8" height="8" rx="1" />
        <rect x="14" y="2" width="8" height="8" rx="1" />
        <rect x="2" y="14" width="8" height="8" rx="1" />
        <rect x="14" y="14" width="8" height="8" rx="1" />
      </svg>
    ),
    title: 'B-Roll Suggestions',
    description: 'Based on your script content, AI suggests relevant B-roll shots and overlays — with a shot list you can check off while filming.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    ),
    title: 'Music & Pacing',
    description: 'Royalty-free music matched to your mood tag. AI adjusts clip pacing to the beat.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 17 12 21 16 17" /><line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
      </svg>
    ),
    title: 'One-Click Export',
    description: 'Export in native formats for each platform — 9:16 for Reels/TikTok, 16:9 for YouTube, 1:1 for LinkedIn.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /><path d="M12 8v4l3 3" />
      </svg>
    ),
    title: 'Version History',
    description: 'Every edit is saved. Roll back, compare versions, and never lose a take.',
  },
]

export default function EditPage() {
  return (
    <div className="p-6 md:p-8 max-w-3xl w-full mx-auto">

      {/* Header */}
      <div
        className="rounded-2xl p-8 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 80% 50%, rgba(99,102,241,0.2) 0%, transparent 60%)' }} />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full text-white tracking-widest uppercase" style={{ background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.4)' }}>
              Phase 2
            </span>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-white/30 text-xs">Coming soon</span>
          </div>
          <h1
            className="text-white font-extrabold mb-2"
            style={{ fontSize: 28, fontFamily: 'var(--font-jakarta)', letterSpacing: '-0.5px' }}
          >
            Video Editing
          </h1>
          <p className="text-white/50 text-sm leading-relaxed max-w-md">
            Upload your raw footage and let AI handle the heavy lifting — cuts, captions, pacing, and export. All synced to the scripts you already approved.
          </p>

          <div
            className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', color: '#A5B4FC' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /><path d="M12 8v4l3 3" />
            </svg>
            We&apos;re building this now
          </div>
        </div>
      </div>

      {/* Upload placeholder */}
      <div
        className="rounded-2xl p-8 mb-6 flex flex-col items-center text-center"
        style={{ border: '2px dashed #C7D2FE', background: '#F5F3FF' }}
      >
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#EEF2FF' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
          </svg>
        </div>
        <p className="font-semibold text-[#4338CA] mb-1" style={{ fontFamily: 'var(--font-jakarta)' }}>
          Drop your footage here
        </p>
        <p className="text-xs text-[#6366F1]/60 mb-4">MP4, MOV up to 4GB · Launches with Phase 2</p>
        <div
          className="px-5 py-2 rounded-xl text-sm font-semibold cursor-not-allowed"
          style={{ background: '#C7D2FE', color: '#4338CA', opacity: 0.6 }}
        >
          Upload video — coming soon
        </div>
      </div>

      {/* Feature grid */}
      <div>
        <p className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-4">What you&apos;ll get</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white border border-[#E4E4E0] rounded-2xl p-5 flex gap-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-[#6366F1]" style={{ background: '#EEF2FF' }}>
                {f.icon}
              </div>
              <div>
                <p className="font-semibold text-sm text-[#18181B] mb-0.5" style={{ fontFamily: 'var(--font-jakarta)' }}>
                  {f.title}
                </p>
                <p className="text-xs text-[#71717A] leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-sm text-[#A1A1AA] hover:text-[#71717A] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
