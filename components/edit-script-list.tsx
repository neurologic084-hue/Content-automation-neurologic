'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

const MOOD_COLOR: Record<string, string> = {
  calm: '#6366F1',
  energetic: '#FF4F17',
  empathetic: '#EC4899',
  educational: '#0EA5E9',
  bold: '#EF4444',
  'story-driven': '#F59E0B',
}

const PAGE_SIZE = 8

export interface EditListScript {
  id: string
  hook: string
  mood_tag: string | null
  approved_at: string | null
}

export interface EditListJob {
  id: string
  status: string
  selected_variant: string | null
}

type StageKey = 'all' | 'no_footage' | 'processing' | 'ready' | 'done'

function stageOf(job: EditListJob | undefined): Exclude<StageKey, 'all'> {
  if (!job) return 'no_footage'
  if (job.selected_variant) return 'done'
  if (job.status === 'complete') return 'ready'
  return 'processing'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Filterable, paged list of approved scripts for the Video Studio.
 *  Groups by pipeline stage so the page stays scannable instead of one
 *  unbounded column of cards. */
export function EditScriptList({
  scripts,
  jobsByScript,
}: {
  scripts: EditListScript[]
  jobsByScript: Record<string, EditListJob>
}) {
  const [stage, setStage] = useState<StageKey>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const counts = useMemo(() => {
    const c: Record<StageKey, number> = { all: scripts.length, no_footage: 0, processing: 0, ready: 0, done: 0 }
    for (const s of scripts) c[stageOf(jobsByScript[s.id])]++
    return c
  }, [scripts, jobsByScript])

  const filtered = stage === 'all'
    ? scripts
    : scripts.filter(s => stageOf(jobsByScript[s.id]) === stage)

  const shown = filtered.slice(0, visible)

  const TABS: { key: StageKey; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#18181B' },
    { key: 'no_footage', label: 'Needs footage', color: '#71717A' },
    { key: 'processing', label: 'Processing', color: '#D97706' },
    { key: 'ready', label: 'Pick a variant', color: '#FF4F17' },
    { key: 'done', label: 'Done', color: '#16A34A' },
  ]

  return (
    <div>
      {/* Stage filter */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map(tab => {
          const active = stage === tab.key
          const count = counts[tab.key]
          if (tab.key !== 'all' && count === 0) return null
          return (
            <button
              key={tab.key}
              onClick={() => { setStage(tab.key); setVisible(PAGE_SIZE) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer flex-shrink-0"
              style={{
                borderColor: active ? tab.color : '#E4E4E0',
                background: active ? `${tab.color}10` : 'white',
                color: active ? tab.color : '#71717A',
              }}
            >
              {tab.label}
              <span
                className="text-[10px] font-bold px-1.5 py-px rounded-full"
                style={{ background: active ? `${tab.color}18` : '#F4F3F0', color: active ? tab.color : '#A1A1AA' }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {shown.map((script, i) => {
          const job = jobsByScript[script.id]
          const s = stageOf(job)
          const moodColor = script.mood_tag ? MOOD_COLOR[script.mood_tag] : '#A1A1AA'

          const badge =
            s === 'done'       ? { label: 'Variant selected', bg: '#DCFCE7', color: '#16A34A' }
            : s === 'ready'      ? { label: 'Variants ready', bg: '#FFF3EF', color: '#FF4F17' }
            : s === 'processing' ? { label: 'Processing...', bg: '#FEF3C7', color: '#D97706' }
            : { label: 'No footage', bg: '#F4F3F0', color: '#A1A1AA' }

          return (
            <div
              key={script.id}
              className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#D0CCC8] hover:shadow-sm transition-all duration-150 hover-lift"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                    {script.mood_tag && (
                      <span
                        className="text-[11px] px-2.5 py-1 rounded-full"
                        style={{ background: `${moodColor}15`, color: moodColor }}
                      >
                        {script.mood_tag}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[#18181B] leading-snug mb-1">
                    &ldquo;{script.hook}&rdquo;
                  </p>
                  {script.approved_at && (
                    <p className="text-xs text-[#A1A1AA]">Approved {formatDate(script.approved_at)}</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <Link
                    href={`/edit/${script.id}`}
                    className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center"
                    style={{
                      background: s === 'done' ? '#DCFCE7' : job ? '#FFF3EF' : '#F4F3F0',
                      color: s === 'done' ? '#15803D' : job ? '#FF4F17' : '#71717A',
                    }}
                  >
                    {s === 'done' ? 'View edits' : job ? 'View variants' : 'Add footage'}
                  </Link>
                  {/* Picked variants can go straight to Publish without losing
                      access to the studio above. */}
                  {s === 'done' && (
                    <Link
                      href={`/publish?jobId=${job.id}`}
                      className="h-9 px-4 rounded-xl text-xs font-semibold transition-all flex items-center text-white hover-lift"
                      style={{ background: 'linear-gradient(120deg, #FF5C26 0%, #FF4F17 45%, #F03D05 100%)', boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
                    >
                      Publish →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Empty filter state */}
      {filtered.length === 0 && (
        <div className="text-center py-10 bg-white border border-dashed border-[#E4E4E0] rounded-2xl">
          <p className="text-sm text-[#A1A1AA]">Nothing in this stage.</p>
        </div>
      )}

      {/* Show more */}
      {filtered.length > visible && (
        <button
          onClick={() => setVisible(v => v + PAGE_SIZE)}
          className="mt-4 w-full py-3 rounded-xl border border-[#E4E4E0] bg-white text-sm font-medium text-[#71717A] hover:bg-[#F4F3F0] hover:text-[#18181B] transition-all cursor-pointer"
        >
          Show {Math.min(PAGE_SIZE, filtered.length - visible)} more · {filtered.length - visible} remaining
        </button>
      )}
    </div>
  )
}
