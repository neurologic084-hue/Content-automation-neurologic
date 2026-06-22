import Link from 'next/link'

const PLATFORMS = [
  {
    name: 'Instagram',
    handle: '@your.handle',
    format: 'Reels · 9:16',
    gradient: 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1.5" fill="white" stroke="none" />
      </svg>
    ),
  },
  {
    name: 'TikTok',
    handle: '@yourchannel',
    format: 'Videos · 9:16',
    gradient: 'linear-gradient(135deg, #010101, #1a1a1a)',
    border: '1px solid rgba(255,255,255,0.1)',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.27 8.27 0 0 0 4.84 1.55V6.79a4.85 4.85 0 0 1-1.07-.1z" />
      </svg>
    ),
  },
  {
    name: 'YouTube Shorts',
    handle: '@yourchannel',
    format: 'Shorts · 9:16',
    gradient: 'linear-gradient(135deg, #cc0000, #ff0000)',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
        <path d="M10 15l5.19-3L10 9v6z" />
        <path d="M21.56 7.17a2.76 2.76 0 0 0-1.94-1.95C17.88 4.78 12 4.78 12 4.78s-5.88 0-7.62.44A2.76 2.76 0 0 0 2.44 7.17C2 8.91 2 12 2 12s0 3.09.44 4.83a2.76 2.76 0 0 0 1.94 1.95C6.12 19.22 12 19.22 12 19.22s5.88 0 7.62-.44a2.76 2.76 0 0 0 1.94-1.95C22 15.09 22 12 22 12s0-3.09-.44-4.83z" />
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    handle: 'Your Profile',
    format: 'Video · 16:9 or 1:1',
    gradient: 'linear-gradient(135deg, #006097, #0077B5)',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },
]

const FEATURES = [
  {
    title: 'One-click multi-publish',
    description: 'Hit publish once — your video goes to every connected platform simultaneously, formatted for each.',
  },
  {
    title: 'Content calendar',
    description: 'Schedule posts weeks in advance. Drag-and-drop calendar view across all platforms.',
  },
  {
    title: 'Per-platform captions',
    description: 'Captions auto-adapted per platform — Instagram allows 2,200 chars, TikTok 2,200, YouTube description auto-generated.',
  },
  {
    title: 'Analytics dashboard',
    description: 'Views, likes, saves, and shares per platform in one unified view. Know what\'s working.',
  },
  {
    title: 'Best time to post',
    description: 'AI analyzes your audience activity patterns and recommends the optimal publish time per platform.',
  },
  {
    title: 'Hashtag intelligence',
    description: 'Auto-generated hashtags per platform based on your script content and audience lane.',
  },
]

export default function PublishPage() {
  return (
    <div className="p-6 md:p-8 max-w-3xl w-full mx-auto">

      {/* Header */}
      <div
        className="rounded-2xl p-8 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1C0A00 0%, #2D0E00 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 80% 50%, rgba(255,79,23,0.18) 0%, transparent 60%)' }} />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-5">
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full tracking-widest uppercase" style={{ background: 'rgba(255,79,23,0.2)', border: '1px solid rgba(255,79,23,0.35)', color: '#FF4F17' }}>
              Phase 3
            </span>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-white/30 text-xs">Coming soon</span>
          </div>
          <h1
            className="text-white font-extrabold mb-2"
            style={{ fontSize: 28, fontFamily: 'var(--font-jakarta)', letterSpacing: '-0.5px' }}
          >
            Multi-Platform Publishing
          </h1>
          <p className="text-white/50 text-sm leading-relaxed max-w-md">
            Connect your accounts once. Publish everywhere simultaneously — formatted, captioned, and scheduled per platform.
          </p>

          <div
            className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(255,79,23,0.15)', border: '1px solid rgba(255,79,23,0.25)', color: '#FF7A50' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" /><path d="M12 8v4l3 3" />
            </svg>
            Launching after Phase 2
          </div>
        </div>
      </div>

      {/* Connect accounts */}
      <div className="mb-6">
        <p className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-3">Connect your accounts</p>
        <div className="grid grid-cols-2 gap-3">
          {PLATFORMS.map((p) => (
            <div
              key={p.name}
              className="bg-white border border-[#E4E4E0] rounded-2xl p-4 flex items-center gap-3"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: p.gradient, border: p.border }}
              >
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#18181B]">{p.name}</p>
                <p className="text-xs text-[#A1A1AA]">{p.format}</p>
              </div>
              <div
                className="flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-not-allowed"
                style={{ background: '#F4F3F0', color: '#C4C4C0' }}
              >
                Connect
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar placeholder */}
      <div
        className="rounded-2xl p-6 mb-6 relative overflow-hidden"
        style={{ background: '#F4F3F0', border: '1.5px dashed #D4D4D0' }}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold text-[#A1A1AA]" style={{ fontFamily: 'var(--font-jakarta)' }}>Content Calendar</p>
          <div className="flex items-center gap-2">
            {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
              <div key={d} className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                <span className="text-xs text-[#C4C4C0] font-medium">{d}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className="flex-1 h-16 rounded-xl bg-white flex items-center justify-center">
              <span className="text-sm text-[#E4E4E0] font-bold">{d}</span>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(250,250,249,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="text-center">
            <p className="font-semibold text-[#71717A]" style={{ fontFamily: 'var(--font-jakarta)' }}>Schedule & publish · Phase 3</p>
            <p className="text-xs text-[#A1A1AA] mt-1">Available after Phase 2 launches</p>
          </div>
        </div>
      </div>

      {/* Feature list */}
      <div>
        <p className="text-xs font-bold text-[#A1A1AA] uppercase tracking-widest mb-4">What you&apos;ll get</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FEATURES.map((f, i) => (
            <div key={f.title} className="bg-white border border-[#E4E4E0] rounded-2xl p-4 flex gap-3">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-white" style={{ background: '#FF4F17', minWidth: 24 }}>
                {i + 1}
              </div>
              <div>
                <p className="font-semibold text-sm text-[#18181B] mb-0.5">{f.title}</p>
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
