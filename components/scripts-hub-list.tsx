'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ScriptActionsMenu } from '@/components/script-actions-menu'

const MOOD_COLOR: Record<string, string> = {
  calm: '#6366F1',
  energetic: '#FF4F17',
  empathetic: '#EC4899',
  educational: '#0EA5E9',
  bold: '#EF4444',
  'story-driven': '#F59E0B',
}

const PAGE_SIZE = 8

export interface HubScript {
  id: string
  idea_id: string
  hook: string
  body: string
  mood_tag: string | null
  approved_at: string | null
  folder_id: string | null
}

export interface HubJob {
  id: string
  status: string
  selected_variant: string | null
}

export interface HubFolder {
  id: string
  name: string
}

type StageKey = 'all' | 'no_footage' | 'processing' | 'ready' | 'done'

function stageOf(job: HubJob | undefined): Exclude<StageKey, 'all'> {
  if (!job) return 'no_footage'
  if (job.selected_variant) return 'done'
  if (job.status === 'complete') return 'ready'
  return 'processing'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The Scripts hub: every approved script with its video pipeline stage and
 *  one context-aware action. Replaces the old separate Library + Video Studio
 *  lists — one place, filterable by stage, paged so it never scrolls forever. */
export function ScriptsHubList({
  scripts,
  jobsByScript,
  folders,
}: {
  scripts: HubScript[]
  jobsByScript: Record<string, HubJob>
  folders: HubFolder[]
}) {
  const [stage, setStage] = useState<StageKey>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const counts = useMemo(() => {
    const c: Record<StageKey, number> = { all: scripts.length, no_footage: 0, processing: 0, ready: 0, done: 0 }
    for (const s of scripts) c[stageOf(jobsByScript[s.id])]++
    return c
  }, [scripts, jobsByScript])

  const filtered = stage === 'all' ? scripts : scripts.filter(s => stageOf(jobsByScript[s.id]) === stage)
  const shown = filtered.slice(0, visible)

  const TABS: { key: StageKey; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: '#18181B' },
    { key: 'no_footage', label: 'Needs footage', color: '#71717A' },
    { key: 'processing', label: 'Processing', color: '#D97706' },
    { key: 'ready', label: 'Pick a variant', color: '#FF4F17' },
    { key: 'done', label: 'Ready to publish', color: '#16A34A' },
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
          const folder = folders.find(f => f.id === script.folder_id)

          const badge =
            s === 'done'         ? { label: 'Ready to publish', bg: '#DCFCE7', color: '#16A34A' }
            : s === 'ready'      ? { label: 'Pick a variant', bg: '#FFF3EF', color: '#FF4F17' }
            : s === 'processing' ? { label: 'Processing...', bg: '#FEF3C7', color: '#D97706' }
            : { label: 'Needs footage', bg: '#F4F3F0', color: '#A1A1AA' }

          const action =
            s === 'done'
              ? { label: 'Publish →', href: `/publish?jobId=${job.id}`, bg: '#DCFCE7', color: '#15803D' }
              : s === 'ready'
              ? { label: 'Pick variant →', href: `/edit/${script.id}`, bg: '#FFF3EF', color: '#FF4F17' }
              : s === 'processing'
              ? { label: 'View progress', href: `/edit/${script.id}`, bg: '#FEF3C7', color: '#B45309' }
              : { label: 'Add footage →', href: `/edit/${script.id}`, bg: '#F4F3F0', color: '#71717A' }

          return (
            <div
              key={script.id}
              className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 hover:border-[#D0CCC8] hover:shadow-sm transition-all duration-150 hover-lift"
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            >
              <div className="flex items-start gap-4">
                <Link href={`/review/${script.id}`} className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: badge.bg, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                    {folder && (
                      <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#FFF3EF] text-[#FF4F17] font-medium">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#FF4F17">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        {folder.name}
                      </span>
                    )}
                    {script.mood_tag && (
                      <span
                        className="text-xs px-2.5 py-1 rounded-full"
                        style={{ background: `${moodColor}15`, color: moodColor }}
                      >
                        {script.mood_tag}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[#18181B] leading-snug mb-1.5">
                    &ldquo;{script.hook}&rdquo;
                  </p>
                  <p className="text-xs text-[#71717A] line-clamp-2 leading-relaxed">
                    {script.body?.replace(/\n/g, ' ')}
                  </p>
                  {script.approved_at && (
                    <p className="text-xs text-[#A1A1AA] mt-2">Approved {formatDate(script.approved_at)}</p>
                  )}
                </Link>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <ScriptActionsMenu
                    scriptId={script.id}
                    ideaId={script.idea_id ?? ''}
                    currentFolderId={script.folder_id ?? null}
                  />
                  <Link
                    href={action.href}
                    className="h-8 px-3.5 rounded-xl text-xs font-semibold transition-all flex items-center hover-lift"
                    style={{ background: action.bg, color: action.color }}
                  >
                    {action.label}
                  </Link>
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
