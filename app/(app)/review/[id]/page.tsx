'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Script } from '@/lib/types'
import { PulseLoader, PulseOverlay } from '@/components/pulse-loader'

const LANE_LABEL: Record<string, string> = {
  adhd_parents: 'ADHD Parents',
  sympathetic_overdrive: 'Sympathetic Overdrive',
  burnout_professionals: 'Burned-Out Professionals',
}

const LANE_COLOR: Record<string, { bg: string; text: string }> = {
  adhd_parents: { bg: '#EEF2FF', text: '#6366F1' },
  sympathetic_overdrive: { bg: '#FFF3EF', text: '#FF4F17' },
  burnout_professionals: { bg: '#F4F3F0', text: '#71717A' },
}

const BEAT_COLORS = ['#FF4F17', '#6366F1', '#059669']
const BEAT_FALLBACK_LABELS = ['The situation', 'Why it happens', 'What changes it']
const BEAT_TIMINGS = ['3–15s', '15–35s', '35–50s']

export default function ScriptDetailPage() {
  const { id } = useParams()
  const router = useRouter()

  const [script, setScript] = useState<Script | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [training, setTraining] = useState(false)
  const [revisionNotes, setRevisionNotes] = useState('')
  const [showRevisionInput, setShowRevisionInput] = useState(false)
  const [revisionError, setRevisionError] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy script')
  const [showApprovedModal, setShowApprovedModal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editHook, setEditHook] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editCta, setEditCta] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('scripts')
        .select('*, idea:ideas(*)')
        .eq('id', id as string)
        .single()
      setScript(data)
      setLoading(false)
    }
    load()
  }, [id])

  async function handleApprove() {
    if (!script) return
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('scripts')
      .update({ status: 'approved', approved_at: new Date().toISOString(), is_few_shot: true })
      .eq('id', script.id)
    await supabase.from('ideas').update({ status: 'approved' }).eq('id', script.idea_id)
    setScript({ ...script, status: 'approved' })
    setTraining(true)
    setTimeout(() => {
      setTraining(false)
      setSaving(false)
      setShowApprovedModal(true)
    }, 2000)
  }

  async function handleRevision() {
    if (!script || !revisionNotes.trim()) return
    setSaving(true)
    setRevisionError('')
    const supabase = createClient()

    await supabase
      .from('scripts')
      .update({ status: 'needs_revision', revision_notes: revisionNotes })
      .eq('id', script.id)

    const res = await fetch('/api/scripts/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: script.id }),
    })

    if (res.ok) {
      const { script_id } = await res.json()
      router.push(`/review/${script_id}`)
    } else {
      setSaving(false)
      setRevisionError('Revision saved. Generation failed — try again from the review queue.')
      router.push('/review')
    }
  }

  async function handleGenerateRevision() {
    if (!script) return
    setSaving(true)
    setRevisionError('')

    const res = await fetch('/api/scripts/revise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_id: script.id }),
    })

    if (res.ok) {
      const { script_id } = await res.json()
      router.push(`/review/${script_id}`)
    } else {
      setSaving(false)
      setRevisionError('Generation failed. Try again.')
    }
  }

  async function handleReject() {
    if (!script) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('scripts').update({ status: 'rejected' }).eq('id', script.id)
    await supabase.from('ideas').update({ status: 'rejected' }).eq('id', script.idea_id)
    router.push('/review')
  }

  function copyScript() {
    if (!script) return
    navigator.clipboard.writeText(script.full_script)
    setCopyLabel('Copied!')
    setTimeout(() => setCopyLabel('Copy script'), 2000)
  }

  function startEditing() {
    if (!script) return
    setEditHook(script.hook)
    setEditBody(script.body)
    setEditCta(script.cta)
    setEditing(true)
  }

  async function swapHook(altHook: string) {
    if (!script) return
    const oldHook = script.hook
    const alts: string[] = (script.filming_plan?.alt_hooks ?? []).filter((h: string) => h !== altHook)
    alts.push(oldHook)
    const newPlan = { ...script.filming_plan, alt_hooks: alts }
    const fullScript = `HOOK:\n${altHook}\n\nBODY:\n${script.body}\n\nCTA:\n${script.cta}`
    const supabase = createClient()
    await supabase
      .from('scripts')
      .update({ hook: altHook, full_script: fullScript, filming_plan: newPlan })
      .eq('id', script.id)
    setScript({ ...script, hook: altHook, full_script: fullScript, filming_plan: newPlan })
  }

  async function handleSaveEdit() {
    if (!script) return
    setEditSaving(true)
    const supabase = createClient()
    const fullScript = `HOOK:\n${editHook}\n\nBODY:\n${editBody}\n\nCTA:\n${editCta}`
    await supabase
      .from('scripts')
      .update({ hook: editHook.trim(), body: editBody.trim(), cta: editCta.trim(), full_script: fullScript })
      .eq('id', script.id)
    setScript({ ...script, hook: editHook.trim(), body: editBody.trim(), cta: editCta.trim(), full_script: fullScript })
    setEditing(false)
    setEditSaving(false)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <PulseLoader label="Loading script..." />
      </div>
    )
  }

  if (!script) {
    return <div className="p-8 text-center text-[#71717A]">Script not found.</div>
  }

  const idea = Array.isArray(script.idea) ? (script.idea as any[])[0] : script.idea
  const lane = idea?.confirmed_lane as string | undefined
  const laneColors = lane ? LANE_COLOR[lane] : { bg: '#F4F3F0', text: '#71717A' }
  const isApproved = script.status === 'approved'
  const isNeedsRevision = script.status === 'needs_revision'
  const isPendingReview = script.status === 'pending_review'

  const bodyBeats = (script.body || '').split(/\n\n+/).filter(Boolean)
  const customLabels = script.filming_plan?.body_labels ?? []
  const hasReHook = !!(script.filming_plan?.re_hook)
  const beatNumberOffset = hasReHook ? 3 : 2

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">
      {/* Training overlay — shown briefly after approving */}
      {training && (
        <PulseOverlay
          label="Script approved."
          sublabel="This script is now shaping every future generation."
        />
      )}

      {/* Post-approve modal */}
      {showApprovedModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl animate-scaleIn">
            {/* Icon */}
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#DCFCE7' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>

            {/* Message */}
            <h2 className="text-[17px] font-bold text-[#18181B] text-center mb-2" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Script approved and trained
            </h2>
            <p className="text-sm text-[#71717A] text-center leading-relaxed mb-6">
              Your engine has learned from this script and will use it to shape every future generation. There is no rush to film — come back when you are ready.
            </p>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={() => { setShowApprovedModal(false); startEditing() }}
                className="w-full py-3 rounded-xl border border-[#E4E4E0] text-sm font-medium text-[#18181B] hover:bg-[#F4F3F0] transition-all cursor-pointer text-left px-4 flex items-center justify-between"
              >
                <span>Edit this script</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <button
                onClick={() => { setShowApprovedModal(false); router.push('/ideas/new') }}
                className="w-full py-3 rounded-xl border border-[#E4E4E0] text-sm font-medium text-[#18181B] hover:bg-[#F4F3F0] transition-all cursor-pointer text-left px-4 flex items-center justify-between"
              >
                <span>Write a new script</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
              <button
                onClick={() => setShowApprovedModal(false)}
                className="w-full py-3 rounded-xl text-sm font-medium text-[#71717A] hover:text-[#18181B] transition-all cursor-pointer"
              >
                Done for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back */}
      <button
        onClick={() => router.push(isApproved ? '/library' : '/review')}
        className="animate-fadeInUp flex items-center gap-1.5 text-sm text-[#71717A] hover:text-[#18181B] mb-6 transition-colors cursor-pointer"
        style={{ animationDelay: '0ms' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {isApproved ? 'Library' : 'Review queue'}
      </button>

      {/* Approved — ready to film banner */}
      {isApproved && !editing && (
        <div className="animate-fadeInUp mb-5" style={{ animationDelay: '40ms' }}>
          <a
            href={`/edit/${script.id}`}
            className="flex items-center justify-between w-full px-5 py-4 rounded-2xl text-white transition-all"
            style={{ background: '#FF4F17', boxShadow: '0 4px 14px rgba(255,79,23,0.25)' }}
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest opacity-80 mb-0.5">When you are ready</p>
              <p className="text-sm font-semibold">Upload footage and start editing</p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
        </div>
      )}

      {/* Header */}
      <div className="animate-fadeInUp flex items-start justify-between gap-4 mb-6" style={{ animationDelay: '50ms' }}>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {script.mood_tag && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-[#F4F3F0] text-[#71717A]">
                {script.mood_tag}
              </span>
            )}
            {isApproved && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#16A34A]">
                Approved
              </span>
            )}
            {isNeedsRevision && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EEF2FF] text-[#6366F1]">
                Needs revision
              </span>
            )}
          </div>
          {idea?.raw_idea && (
            <p className="text-xs text-[#A1A1AA]">Idea: "{idea.raw_idea}"</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {editing ? (
            <button
              onClick={() => setEditing(false)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E4E4E0] text-[#71717A] hover:bg-[#F4F3F0] transition-all cursor-pointer"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={startEditing}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#E4E4E0] text-[#71717A] hover:bg-[#F4F3F0] transition-all cursor-pointer flex items-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
          {!editing && (
            <button
              onClick={copyScript}
              className="text-xs font-medium px-2 sm:px-3 py-1.5 rounded-lg border border-[#E4E4E0] text-[#71717A] hover:bg-[#F4F3F0] transition-all cursor-pointer"
            >
              <span className="hidden sm:inline">{copyLabel}</span>
              <span className="sm:hidden">
                {copyLabel === 'Copied!' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                )}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Why this works */}
      {script.why_this_works && (
        <div className="animate-fadeInUp mb-5 px-4 py-3 rounded-xl bg-[#EEF2FF] border border-[#C7D2FE]" style={{ animationDelay: '100ms' }}>
          <p className="text-xs font-semibold text-[#6366F1] mb-0.5">Why this works</p>
          <p className="text-sm text-[#4F52E0]">{script.why_this_works}</p>
        </div>
      )}

      {/* Script   numbered beats, no dividers */}
      <div className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl mb-5 px-4 sm:px-6 py-4 sm:py-5 space-y-5 sm:space-y-6" style={{ animationDelay: '120ms' }}>

        {/* 1   Hook */}
        <div className="animate-fadeInUp flex items-start gap-4" style={{ animationDelay: '160ms' }}>
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-[3px]"
            style={{ background: '#FF4F17' }}
          >
            1
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[11px] font-semibold text-[#FF4F17] tracking-wide">Hook</span>
              <span className="text-[10px]" style={{ color: '#C4C0BB' }}>0–3s</span>
            </div>
            {editing ? (
              <textarea
                value={editHook}
                onChange={e => setEditHook(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-[#FF4F17]/40 bg-[#FAFAF8] text-[15px] sm:text-[17px] font-semibold text-[#18181B] leading-snug focus:outline-none focus:ring-2 focus:ring-[#FF4F17]/20 focus:border-[#FF4F17] transition-all resize-none"
                style={{ fontFamily: 'var(--font-jakarta)' }}
              />
            ) : (
              <>
                <p
                  className="text-[15px] sm:text-[17px] font-semibold text-[#18181B] leading-snug"
                  style={{ fontFamily: 'var(--font-jakarta)' }}
                >
                  {script.hook}
                </p>
                {/* Alternate hooks — tap to swap */}
                {(script.filming_plan?.alt_hooks?.length ?? 0) > 0 && !isApproved && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest">Try another opener</p>
                    {(script.filming_plan!.alt_hooks as string[]).map((alt, i) => (
                      <button
                        key={i}
                        onClick={() => swapHook(alt)}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-xl border border-dashed border-[#E4E4E0] text-[13px] text-[#71717A] hover:border-[#FF4F17] hover:text-[#18181B] hover:bg-[#FFF8F6] transition-all cursor-pointer group/alt"
                      >
                        <svg className="flex-shrink-0 opacity-50 group-hover/alt:opacity-100 transition-opacity" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                        </svg>
                        {alt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Re-hook   tips & tricks only */}
        {!editing && script.filming_plan?.re_hook && (
          <div className="animate-fadeInUp flex items-start gap-4" style={{ animationDelay: '190ms' }}>
            <div
              className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-[3px]"
              style={{ background: '#F59E0B' }}
            >
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-[#F59E0B] tracking-wide">Re-hook</span>
                <span className="text-[10px]" style={{ color: '#C4C0BB' }}>3–8s</span>
              </div>
              <p className="text-[15px] text-[#18181B] leading-relaxed">{script.filming_plan.re_hook}</p>
            </div>
          </div>
        )}

        {/* Body beats */}
        {editing ? (
          <div className="flex items-start gap-4">
            <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-[3px]" style={{ background: '#6366F1' }}>
              2
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-[#6366F1] tracking-wide">Body</span>
                <span className="text-[10px] text-[#C4C0BB]">Separate sections with a blank line</span>
              </div>
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 rounded-xl border border-[#6366F1]/40 bg-[#FAFAF8] text-[15px] text-[#18181B] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#6366F1]/20 focus:border-[#6366F1] transition-all resize-none"
              />
            </div>
          </div>
        ) : (
          bodyBeats.map((beat, i) => {
            const label = customLabels[i] || BEAT_FALLBACK_LABELS[i] || `Beat ${i + 2}`
            const color = BEAT_COLORS[i] ?? '#A1A1AA'
            return (
              <div key={i} className="animate-fadeInUp flex items-start gap-4" style={{ animationDelay: `${220 + i * 60}ms` }}>
                <div
                  className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-[3px]"
                  style={{ background: color }}
                >
                  {i + beatNumberOffset}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span className="text-[11px] font-semibold tracking-wide" style={{ color }}>
                      {label}
                    </span>
                    <span className="text-[10px]" style={{ color: '#C4C0BB' }}>{BEAT_TIMINGS[i]}</span>
                  </div>
                  <p className="text-[15px] text-[#18181B] leading-relaxed">{beat}</p>
                </div>
              </div>
            )
          })
        )}

        {/* CTA */}
        <div className="animate-fadeInUp flex items-start gap-4" style={{ animationDelay: '400ms' }}>
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-[3px]"
            style={{ background: '#22C55E' }}
          >
            {bodyBeats.length + beatNumberOffset}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[11px] font-semibold text-[#22C55E] tracking-wide">Call to action</span>
              <span className="text-[10px]" style={{ color: '#C4C0BB' }}>50–60s</span>
            </div>
            {editing ? (
              <textarea
                value={editCta}
                onChange={e => setEditCta(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-[#22C55E]/40 bg-[#FAFAF8] text-[15px] font-medium text-[#18181B] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#22C55E]/20 focus:border-[#22C55E] transition-all resize-none"
              />
            ) : (
              <p className="text-[15px] font-medium text-[#18181B] leading-relaxed">{script.cta}</p>
            )}
          </div>
        </div>

      </div>

      {/* How to deliver it */}
      {(script.filming_plan?.delivery_cues?.length ?? 0) > 0 && (
        <div className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 mb-5" style={{ animationDelay: '440ms' }}>
          <h2
            className="font-semibold text-[#18181B] mb-3 flex items-center gap-2"
            style={{ fontFamily: 'var(--font-jakarta)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
            How to deliver it
          </h2>
          <div className="space-y-2">
            {(script.filming_plan!.delivery_cues as string[]).map((cue, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5" style={{ background: '#EEF2FF', color: '#6366F1' }}>
                  {i + 1}
                </span>
                <p className="text-sm text-[#18181B] leading-relaxed">{cue}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filming Plan */}
      {(script.filming_plan?.shot_type || script.filming_plan?.setup || script.filming_plan?.wardrobe) && (
        <div className="animate-fadeInUp bg-white border border-[#E4E4E0] rounded-2xl p-5 mb-6" style={{ animationDelay: '460ms' }}>
          <h2
            className="font-semibold text-[#18181B] mb-4 flex items-center gap-2"
            style={{ fontFamily: 'var(--font-jakarta)' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Filming plan
          </h2>
          <div className="space-y-3">
            {[
              { label: 'Shot type', value: script.filming_plan?.shot_type },
              { label: 'Setup', value: script.filming_plan?.setup || script.filming_plan?.setup_notes || script.filming_plan?.location },
              { label: 'Wardrobe', value: script.filming_plan?.wardrobe },
            ].filter(item => item.value).map((item) => (
              <div key={item.label} className="flex gap-3">
                <span className="text-xs font-semibold text-[#A1A1AA] w-20 flex-shrink-0 pt-0.5">{item.label}</span>
                <span className="text-sm text-[#18181B]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Web search context */}
      {script.search_context && (
        <details className="mb-6 group">
          <summary className="flex items-center gap-2 text-xs text-[#A1A1AA] cursor-pointer hover:text-[#71717A] transition-colors list-none">
            <svg className="group-open:rotate-90 transition-transform" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
            Web research used for this script
          </summary>
          <div className="mt-3 p-4 rounded-xl bg-[#F4F3F0] border border-[#E4E4E0]">
            {script.search_context.answer && (
              <p className="text-xs text-[#71717A] mb-2 italic">{script.search_context.answer}</p>
            )}
            <div className="space-y-1">
              {script.search_context.results?.map((r: any, i: number) => (
                <p key={i} className="text-xs text-[#A1A1AA]">• {r.title}</p>
              ))}
            </div>
          </div>
        </details>
      )}


      {/* Actions */}
      <div className="animate-fadeInUp space-y-3" style={{ animationDelay: '520ms' }}>
        {/* Editing: save button replaces everything else */}
        {editing && (
          <button
            onClick={handleSaveEdit}
            disabled={editSaving || !editHook.trim() || !editBody.trim()}
            className="w-full py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-40 transition-all cursor-pointer"
            style={{ background: '#FF4F17', boxShadow: editSaving ? 'none' : '0 4px 14px rgba(255,79,23,0.25)' }}
          >
            {editSaving ? 'Saving...' : 'Save changes'}
          </button>
        )}

        {/* Normal actions   hidden while editing */}
        {!editing && isNeedsRevision && (
          <>
            {script.revision_notes && (
              <div className="p-4 rounded-xl bg-[#EEF2FF] border border-[#C7D2FE]">
                <p className="text-xs font-semibold text-[#6366F1] mb-1">Revision notes</p>
                <p className="text-sm text-[#4F52E0]">{script.revision_notes}</p>
              </div>
            )}
            {revisionError && (
              <p className="text-xs text-[#EF4444] px-1">{revisionError}</p>
            )}
            {saving ? (
              <div className="py-6 flex justify-center">
                <PulseLoader label="Generating revision..." sublabel="Applying your feedback..." />
              </div>
            ) : (
              <button
                onClick={handleGenerateRevision}
                disabled={saving}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all cursor-pointer"
                style={{ background: '#6366F1' }}
              >
                Generate revision →
              </button>
            )}
          </>
        )}

        {/* Pending review: approve / revise / reject */}
        {!editing && isPendingReview && (
          <>
            <div className="flex items-center gap-2 px-1">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              <p className="text-xs text-[#A1A1AA]">Approving this script trains your engine   future scripts will match its style.</p>
            </div>

            {showRevisionInput ? (
              <div className="bg-white border border-[#E4E4E0] rounded-2xl p-5 space-y-3">
                <label className="block text-sm font-medium text-[#18181B]">
                  What should change?
                </label>
                <textarea
                  value={revisionNotes}
                  onChange={(e) => setRevisionNotes(e.target.value)}
                  placeholder="e.g. The hook is too aggressive. Make it warmer and more empathetic. Keep the CTA."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E0] bg-[#FAFAF9] text-[#18181B] text-sm placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:border-transparent transition-all resize-none"
                />
                {revisionError && (
                  <p className="text-xs text-[#EF4444]">{revisionError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowRevisionInput(false); setRevisionError('') }}
                    className="flex-1 py-2.5 rounded-xl border border-[#E4E4E0] text-sm text-[#71717A] hover:bg-[#F4F3F0] transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRevision}
                    disabled={!revisionNotes.trim() || saving}
                    className="flex-[2] py-2.5 rounded-xl bg-[#6366F1] text-white text-sm font-semibold hover:bg-[#4F52E0] disabled:opacity-40 transition-all cursor-pointer"
                  >
                    {saving ? 'Generating...' : 'Generate revision →'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={handleReject}
                  disabled={saving}
                  className="py-3 rounded-xl border border-[#E4E4E0] text-sm font-medium text-[#EF4444] hover:bg-[#FEE2E2] hover:border-[#EF4444] disabled:opacity-40 transition-all cursor-pointer"
                >
                  Reject
                </button>
                <button
                  onClick={() => setShowRevisionInput(true)}
                  disabled={saving}
                  className="py-3 rounded-xl border border-[#E4E4E0] text-sm font-medium text-[#6366F1] hover:bg-[#EEF2FF] hover:border-[#6366F1] disabled:opacity-40 transition-all cursor-pointer"
                >
                  Revise
                </button>
                <button
                  onClick={handleApprove}
                  disabled={saving}
                  className="shine-sweep py-3 rounded-xl text-white text-sm font-semibold active:scale-[0.98] disabled:opacity-40 transition-all cursor-pointer"
                  style={{ background: 'linear-gradient(120deg, #FF5C26 0%, #FF4F17 45%, #F03D05 100%)', boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
                >
                  {saving ? '...' : 'Approve'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
