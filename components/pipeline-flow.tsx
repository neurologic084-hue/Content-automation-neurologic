'use client'

import Link from 'next/link'
import { CountUp } from '@/components/count-up'

interface Stage {
  key: string
  label: string
  count: number
  href: string
  color: string
  bg: string
  icon: React.ReactNode
}

/** The content pipeline as a living diagram: Ideas → Review → Studio → Publish.
 *  Connectors carry an animated dash "flow" so the whole system feels alive.
 *  Each stage is a tappable node showing its live count. */
export function PipelineFlow({
  ideas,
  pending,
  approved,
  published,
}: {
  ideas: number
  pending: number
  approved: number
  published: number
}) {
  const stages: Stage[] = [
    {
      key: 'ideas',
      label: 'Ideas',
      count: ideas,
      href: '/ideas/new',
      color: '#FF4F17',
      bg: '#FFF3EF',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" />
        </svg>
      ),
    },
    {
      key: 'review',
      label: 'Review',
      count: pending,
      href: '/review',
      color: '#6366F1',
      bg: '#EEF2FF',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      ),
    },
    {
      key: 'studio',
      label: 'Studio',
      count: approved,
      href: '/edit',
      color: '#F59E0B',
      bg: '#FEF3C7',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      ),
    },
    {
      key: 'publish',
      label: 'Published',
      count: published,
      href: '/publish',
      color: '#16A34A',
      bg: '#DCFCE7',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22 11 13 2 9l20-7z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="bg-white border border-[#E4E4E0] rounded-2xl px-3 sm:px-5 py-4">
      <div className="flex items-center">
        {stages.map((stage, i) => (
          <div key={stage.key} className="contents">
            <Link
              href={stage.href}
              className="hover-spring flex flex-col items-center gap-1.5 flex-shrink-0 px-1.5 sm:px-2 group"
              aria-label={`${stage.label}: ${stage.count}`}
            >
              <div className="relative">
                {/* Halo pulses only where work is waiting */}
                {stage.key === 'review' && stage.count > 0 && (
                  <span
                    aria-hidden="true"
                    className="pulse-ring absolute inset-0 rounded-xl"
                    style={{ background: stage.color, opacity: 0.35 }}
                  />
                )}
                <div
                  className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-colors"
                  style={{ background: stage.bg, color: stage.color }}
                >
                  {stage.icon}
                </div>
              </div>
              <p
                className="text-sm sm:text-base font-bold leading-none"
                style={{ fontFamily: 'var(--font-jakarta)', color: '#18181B' }}
              >
                <CountUp value={stage.count} />
              </p>
              <p className="text-[10px] sm:text-[11px] font-medium text-[#A1A1AA] leading-none group-hover:text-[#71717A] transition-colors">
                {stage.label}
              </p>
            </Link>

            {/* Connector with travelling dash */}
            {i < stages.length - 1 && (
              <svg
                aria-hidden="true"
                className="flex-1 min-w-3 h-2 -mt-[19px]"
                viewBox="0 0 100 8"
                preserveAspectRatio="none"
              >
                <line x1="0" y1="4" x2="100" y2="4" stroke="#EDEDEA" strokeWidth="2" />
                <line
                  className="flow-dash"
                  x1="0" y1="4" x2="100" y2="4"
                  stroke={stages[i + 1].count > 0 ? stages[i + 1].color : '#D4D4D0'}
                  strokeOpacity="0.55"
                  strokeWidth="2"
                />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
