'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { AudienceLane, LaneSuggestion } from '@/lib/types'
import { PulseLoader } from '@/components/pulse-loader'
import { ConfirmModal } from '@/components/confirm-modal'

const GENERATING_STEPS = [
  { label: 'Searching the web for relevant context...', delay: 0 },
  { label: 'Applying your brand voice & audience lane...', delay: 2800 },
  { label: 'Crafting hook, body & CTA...', delay: 5500 },
]

const FORMAT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  educational:    { label: 'Educational',    color: '#2563EB', bg: '#EFF6FF' },
  tips_tricks:    { label: 'Tips & Tricks',  color: '#7C3AED', bg: '#F5F3FF' },
  personal_story: { label: 'Personal Story', color: '#059669', bg: '#ECFDF5' },
  myth_busting:   { label: 'Myth Busting',   color: '#D97706', bg: '#FFFBEB' },
  lead_magnet:    { label: 'Lead Magnet',    color: '#FF4F17', bg: '#FFF8F6' },
}

type Step = 'input' | 'generating' | 'done' | 'choose-idea'
type Tab = 'write' | 'generate' | 'script'

const MOODS = [
  { id: 'educational', label: 'Educational' },
  { id: 'calm',        label: 'Calm' },
  { id: 'energetic',   label: 'Energetic' },
  { id: 'empathetic',  label: 'Empathetic' },
  { id: 'bold',        label: 'Bold' },
  { id: 'story-driven',label: 'Story' },
]

const FORMATS = [
  { id: 'educational',    label: 'Educational',    color: '#2563EB', bg: '#EFF6FF' },
  { id: 'tips_tricks',    label: 'Tips & Tricks',  color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'personal_story', label: 'Personal Story', color: '#059669', bg: '#ECFDF5' },
  { id: 'myth_busting',   label: 'Myth Busting',   color: '#D97706', bg: '#FFFBEB' },
  { id: 'lead_magnet',    label: 'Lead Magnet',    color: '#FF4F17', bg: '#FFF8F6' },
]

export default function NewIdeaPage() {
  const router = useRouter()
  const [settingsReady, setSettingsReady] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('input')
  const [tab, setTab] = useState<Tab>('write')
  const [idea, setIdea] = useState('')
  const [scriptId, setScriptId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Manual script state
  const [ownHook, setOwnHook] = useState('')
  const [ownBody, setOwnBody] = useState('')
  const [ownCta, setOwnCta] = useState('')
  const [ownMood, setOwnMood] = useState('')
  const [ownLane, setOwnLane] = useState<AudienceLane | null>(null)
  const [ownSaving, setOwnSaving] = useState(false)
  const [ownError, setOwnError] = useState('')
  const [visibleSteps, setVisibleSteps] = useState(0)
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Whether to use brand profile + few-shot context when generating (AI-assisted tab)
  const [useBrandContext, setUseBrandContext] = useState(true)
  // Shared tone and format state (used by AI-assisted tab)
  const [selectedFormat, setSelectedFormat] = useState('')
  const [selectedMood, setSelectedMood] = useState('')
  // Idea pending tone selection (generate tab)
  const [pendingIdeaItem, setPendingIdeaItem] = useState<{ format: string; idea: string } | null>(null)

  // Idea generation state
  const [generatedIdeas, setGeneratedIdeas] = useState<Array<{ format: string; idea: string }>>([])
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false)
  const [ideaGenError, setIdeaGenError] = useState('')
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false)

  useEffect(() => {
    async function checkSettings() {
      const supabase = createClient()
      const { data } = await supabase.from('brand_settings').select('creator_name').single()
      setSettingsReady(!!(data?.creator_name && data.creator_name.trim().length > 0))
    }
    checkSettings()
  }, [])

  useEffect(() => {
    if (step === 'generating') {
      setVisibleSteps(0)
      stepTimers.current.forEach(clearTimeout)
      stepTimers.current = GENERATING_STEPS.map((s, i) =>
        setTimeout(() => setVisibleSteps(i + 1), s.delay)
      )
    }
    return () => stepTimers.current.forEach(clearTimeout)
  }, [step])

  async function handleSuggestLane(overrideIdea?: string, overrideMood?: string, overrideBrandContext?: boolean, overrideFormat?: string) {
    const text = overrideIdea ?? idea
    if (!text.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/ideas/suggest-lane', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: text }),
      })
      const laneData = await res.json()
      if (!res.ok) throw new Error(laneData.error)
      const brandCtx = overrideBrandContext ?? useBrandContext
      const fmt = overrideFormat ?? selectedFormat
      await generateScript(text, laneData.suggested_lane, laneData, overrideMood ?? selectedMood, brandCtx, fmt)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function generateScript(ideaText: string, lane: AudienceLane, suggestionData: LaneSuggestion, mood?: string, brandContext = true, scriptFormat?: string) {
    setStep('generating')
    setError('')
    try {
      const supabase = createClient()

      // Delete all previous non-approved ideas and their scripts before creating a new one.
      // Approved ideas are kept because they serve as few-shot examples for future generation.
      const { data: oldIdeas } = await supabase
        .from('ideas')
        .select('id')
        .neq('status', 'approved')
      if (oldIdeas?.length) {
        const oldIds = oldIdeas.map((i: { id: string }) => i.id)
        await supabase.from('scripts').delete().in('idea_id', oldIds)
        await supabase.from('ideas').delete().in('id', oldIds)
      }

      const { data: newIdea, error: ideaErr } = await supabase
        .from('ideas')
        .insert({
          raw_idea: ideaText,
          ai_suggested_lane: suggestionData.suggested_lane,
          ai_lane_reasoning: suggestionData.reasoning,
          confirmed_lane: lane,
          status: 'generating',
        })
        .select('id')
        .single()

      if (ideaErr || !newIdea) throw new Error(ideaErr?.message ?? 'Failed to save idea')

      const res = await fetch('/api/scripts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea_id: newIdea.id, ...(mood ? { mood_tag: mood } : {}), use_brand_context: brandContext, ...(scriptFormat ? { script_format: scriptFormat } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setScriptId(data.script_id)
      setStep('done')
    } catch (err) {
      setError(String(err))
      setStep('input')
    }
  }

  function handleSelectGeneratedIdea(item: { format: string; idea: string }) {
    setIdea(item.idea)
    setSelectedMood('')
    setPendingIdeaItem(item)
  }

  async function handleConfirmPendingIdea() {
    if (!pendingIdeaItem) return
    const fmt = pendingIdeaItem.format
    setPendingIdeaItem(null)
    await handleSuggestLane(pendingIdeaItem.idea, selectedMood, undefined, fmt)
  }

  async function handleGenerateIdeas() {
    setIsGeneratingIdeas(true)
    setIdeaGenError('')
    setGeneratedIdeas([])

    try {
      const res = await fetch('/api/ideas/generate', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const ideas = data.ideas ?? []
      setGeneratedIdeas(ideas)
      if (ideas.length > 0) {
        setStep('choose-idea')
      }
    } catch (err) {
      setIdeaGenError(String(err))
    } finally {
      setIsGeneratingIdeas(false)
    }
  }

  async function handleSaveOwnScript(approve: boolean) {
    if (!ownHook.trim() || !ownBody.trim()) return
    setOwnSaving(true)
    setOwnError('')
    try {
      const res = await fetch('/api/scripts/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hook: ownHook,
          body: ownBody,
          cta: ownCta,
          audience_lane: ownLane,
          mood_tag: ownMood || null,
          approve,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (approve) {
        router.push(`/edit/${data.script_id}`)
      } else {
        router.push(`/review/${data.script_id}`)
      }
    } catch (err) {
      setOwnError(String(err))
    } finally {
      setOwnSaving(false)
    }
  }

  if (settingsReady === null) {
    return (
      <div className="p-6 md:p-8 max-w-2xl w-full mx-auto flex items-center justify-center min-h-64">
        <PulseLoader label="Loading..." />
      </div>
    )
  }

  if (!settingsReady) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">
        <div className="bg-white border border-[#E4E4E0] rounded-2xl overflow-hidden">
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: '#F4F3F0' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-[#18181B] mb-2" style={{ fontFamily: 'var(--font-jakarta)' }}>
              Brand voice required first
            </h2>
            <p className="text-sm text-[#71717A] leading-relaxed max-w-sm mb-6">
              Your script engine needs to know your brand identity, tone, and audience before it can write anything. Takes less than 3 minutes.
            </p>
            <Link
              href="/settings"
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: '#FF4F17', boxShadow: '0 4px 14px rgba(255,79,23,0.3)' }}
            >
              Set up brand voice →
            </Link>
          </div>
          <div className="border-t border-[#F0F0EE] px-8 py-4 bg-[#FAFAF9] flex items-center gap-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-xs text-[#A1A1AA]">
              Once saved, your settings train every future script   you only fill this out once.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-2xl w-full mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
          New content idea
        </h1>
        <p className="mt-1 text-sm text-[#71717A]">
          Type anything   or let AI generate 10 ideas from your brand profile.
        </p>
      </div>

      {/* Step: Input idea */}
      {step === 'input' && (
        <div>
          {/* Tab bar */}
          <div className="flex gap-1 mb-5 p-1 bg-[#F4F3F0] rounded-xl w-fit">
            <button
              onClick={() => setTab('write')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer"
              style={{
                background: tab === 'write' ? '#FFFFFF' : 'transparent',
                color: tab === 'write' ? '#18181B' : '#71717A',
                boxShadow: tab === 'write' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              AI-assisted
            </button>
            <button
              onClick={() => setTab('generate')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center gap-2"
              style={{
                background: tab === 'generate' ? '#FFFFFF' : 'transparent',
                color: tab === 'generate' ? '#18181B' : '#71717A',
                boxShadow: tab === 'generate' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              Generate 10 ideas
            </button>
            <button
              onClick={() => setTab('script')}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center gap-2"
              style={{
                background: tab === 'script' ? '#FFFFFF' : 'transparent',
                color: tab === 'script' ? '#18181B' : '#71717A',
                boxShadow: tab === 'script' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Paste my script
            </button>
          </div>

          {/* Write tab */}
          {tab === 'write' && (
            <div className="bg-white border border-[#E4E4E0] rounded-2xl p-6">
              <label className="block text-sm font-medium text-[#18181B] mb-2">
                What's the idea?
              </label>
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="e.g. A video about why kids with ADHD can't just 'try harder'   and what's actually happening in their nervous system"
                rows={5}
                className="w-full px-3.5 py-3 rounded-xl border border-[#E4E4E0] bg-[#FAFAF9] text-[#18181B] text-sm placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#FF4F17] focus:border-transparent transition-all resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && idea.trim()) {
                    handleSuggestLane()
                  }
                }}
              />
              <p className="text-xs text-[#A1A1AA] mt-2 mb-4">⌘ + Enter to continue</p>

              {/* Tone selector */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[#71717A] uppercase tracking-wider mb-2">Tone (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedMood(selectedMood === m.id ? '' : m.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                      style={{
                        borderColor: selectedMood === m.id ? '#FF4F17' : '#E4E4E0',
                        background: selectedMood === m.id ? '#FFF3EF' : 'transparent',
                        color: selectedMood === m.id ? '#FF4F17' : '#71717A',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format selector */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-[#71717A] uppercase tracking-wider mb-2">Format (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {FORMATS.map(f => {
                    const active = selectedFormat === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelectedFormat(active ? '' : f.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                        style={{
                          borderColor: active ? f.color : '#E4E4E0',
                          background: active ? f.bg : 'transparent',
                          color: active ? f.color : '#71717A',
                        }}
                      >
                        {f.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Brand context toggle */}
              <div className="flex items-center justify-between mb-4 py-2.5 px-3.5 rounded-xl bg-[#FAFAF9] border border-[#E4E4E0]">
                <div>
                  <p className="text-xs font-semibold text-[#18181B]">Use brand context</p>
                  <p className="text-[11px] text-[#A1A1AA] mt-0.5">
                    {useBrandContext ? 'Uses your brand voice, audience, and past scripts' : 'Generates purely from your idea'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseBrandContext(v => !v)}
                  className="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200 cursor-pointer focus:outline-none"
                  style={{ background: useBrandContext ? '#FF4F17' : '#D1D5DB' }}
                  aria-checked={useBrandContext}
                  role="switch"
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: useBrandContext ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </div>

              {error && (
                <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#FEE2E2] text-[#EF4444] text-sm">{error}</div>
              )}

              <button
                onClick={() => handleSuggestLane()}
                disabled={!idea.trim() || loading}
                className="w-full py-2.5 px-4 rounded-xl bg-[#FF4F17] text-white text-sm font-semibold hover:bg-[#E84410] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 cursor-pointer"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Analyzing idea...
                  </span>
                ) : (
                  'Analyze & continue →'
                )}
              </button>
            </div>
          )}

          {/* Paste my script tab */}
          {tab === 'script' && (
            <div className="bg-white border border-[#E4E4E0] rounded-2xl p-6 space-y-5">
              <div>
                <p className="text-xs font-semibold text-[#A1A1AA] uppercase tracking-wider mb-1">
                  Paste your own script   skip the AI, go straight to editing
                </p>
              </div>

              {/* Hook */}
              <div>
                <label className="block text-sm font-medium text-[#18181B] mb-1.5">
                  Opening hook <span className="text-[#FF4F17]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="The first line that hooks the viewer in 1–2 seconds"
                  value={ownHook}
                  onChange={e => setOwnHook(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4E4E0] bg-[#FAFAF9] text-[#18181B] text-sm placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#FF4F17] focus:border-transparent transition-all"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-[#18181B] mb-1.5">
                  Script body <span className="text-[#FF4F17]">*</span>
                </label>
                <textarea
                  placeholder="Paste your full script here. Write it exactly as you'll say it   the pipeline will use this for captions and editing."
                  value={ownBody}
                  onChange={e => setOwnBody(e.target.value)}
                  rows={8}
                  className="w-full px-3.5 py-3 rounded-xl border border-[#E4E4E0] bg-[#FAFAF9] text-[#18181B] text-sm placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#FF4F17] focus:border-transparent transition-all resize-none"
                />
              </div>

              {/* CTA */}
              <div>
                <label className="block text-sm font-medium text-[#18181B] mb-1.5">
                  Call to action
                </label>
                <input
                  type="text"
                  placeholder="e.g. Book a free call   link in bio"
                  value={ownCta}
                  onChange={e => setOwnCta(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#E4E4E0] bg-[#FAFAF9] text-[#18181B] text-sm placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-[#FF4F17] focus:border-transparent transition-all"
                />
              </div>

              {/* Mood */}
              <div>
                <label className="block text-sm font-medium text-[#18181B] mb-2">Tone</label>
                <div className="flex flex-wrap gap-2">
                  {MOODS.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setOwnMood(ownMood === m.id ? '' : m.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                      style={{
                        borderColor: ownMood === m.id ? '#FF4F17' : '#E4E4E0',
                        background: ownMood === m.id ? '#FFF3EF' : 'transparent',
                        color: ownMood === m.id ? '#FF4F17' : '#71717A',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {ownError && (
                <div className="px-3.5 py-2.5 rounded-xl bg-[#FEE2E2] text-[#EF4444] text-sm">{ownError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => handleSaveOwnScript(false)}
                  disabled={!ownHook.trim() || !ownBody.trim() || ownSaving}
                  className="flex-1 h-11 rounded-xl border border-[#E4E4E0] text-sm font-medium text-[#18181B] hover:bg-[#F4F3F0] disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  Save for review
                </button>
                <button
                  onClick={() => handleSaveOwnScript(true)}
                  disabled={!ownHook.trim() || !ownBody.trim() || ownSaving}
                  className="flex-[2] h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                  style={{ background: '#FF4F17', boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
                >
                  {ownSaving ? 'Saving...' : 'Approve and go to Edit →'}
                </button>
              </div>
            </div>
          )}

          {/* Generate tab */}
          {tab === 'generate' && (
            <div>
              {/* Generate button / loading */}
              {!generatedIdeas.length && (
                <div className="bg-white border border-[#E4E4E0] rounded-2xl p-6 flex flex-col items-center text-center">
                  {isGeneratingIdeas ? (
                    <>
                      <div className="relative w-14 h-14 mb-4">
                        <div className="absolute inset-0 rounded-full bg-[#FFF3EF] animate-pulse" />
                        <div className="relative w-14 h-14 rounded-full bg-[#FFF3EF] flex items-center justify-center">
                          <svg className="animate-spin w-6 h-6 text-[#FF4F17]" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-[#18181B]">Thinking about your brand...</p>
                      <p className="text-xs text-[#71717A] mt-1">Generating 10 tailored content ideas</p>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-2xl bg-[#FFF3EF] flex items-center justify-center mb-4">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF4F17" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-[#18181B] mb-1">AI-generated content ideas</p>
                      <p className="text-xs text-[#71717A] leading-relaxed max-w-xs mb-5">
                        Based on your brand profile, ICP, and positioning   10 specific ideas across different content angles.
                      </p>
                      {ideaGenError && (
                        <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#FEE2E2] text-[#EF4444] text-sm w-full">
                          {ideaGenError}
                        </div>
                      )}
                      <button
                        onClick={() => setShowGenerateConfirm(true)}
                        className="px-6 py-2.5 rounded-xl bg-[#FF4F17] text-white text-sm font-semibold hover:bg-[#E84410] active:scale-[0.98] transition-all cursor-pointer"
                        style={{ boxShadow: '0 4px 14px rgba(255,79,23,0.3)' }}
                      >
                        Generate 10 ideas →
                      </button>
                    </>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      )}

      {/* Step: Choose idea */}
      {step === 'choose-idea' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-[#18181B]" style={{ fontFamily: 'var(--font-jakarta)' }}>
                Choose an idea
              </h2>
              <p className="text-xs text-[#71717A] mt-0.5">{generatedIdeas.length} ideas generated from your brand profile</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setStep('input')
                  setGeneratedIdeas([])
                  setPendingIdeaItem(null)
                  setSelectedMood('')
                  setIdeaGenError('')
                }}
                className="h-9 px-4 rounded-xl border border-[#E4E4E0] text-sm text-[#71717A] hover:bg-[#F4F3F0] transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPendingIdeaItem(null)
                  setSelectedMood('')
                  handleGenerateIdeas()
                }}
                disabled={isGeneratingIdeas}
                className="h-9 px-4 rounded-xl border border-[#E4E4E0] text-sm text-[#71717A] hover:bg-[#F4F3F0] disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                {isGeneratingIdeas ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-[#A1A1AA] border-t-transparent animate-spin" />
                    Regenerating...
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 .49-4.5" />
                    </svg>
                    Regenerate
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Tone step: shown after clicking an idea */}
          {pendingIdeaItem ? (
            <div className="bg-white border border-[#FF4F17] rounded-2xl p-6 animate-fadeInUp">
              <button
                type="button"
                onClick={() => { setPendingIdeaItem(null); setSelectedMood('') }}
                className="flex items-center gap-1.5 text-xs text-[#A1A1AA] hover:text-[#71717A] mb-4 cursor-pointer transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back to ideas
              </button>
              {pendingIdeaItem.format === 'lead_magnet' && (
                <p className="text-[11px] text-[#FF4F17] bg-[#FFF3EF] px-2.5 py-1.5 rounded-lg mb-3 font-medium">
                  Lead Magnet   CTA will be "Comment [WORD] below and I'll send it to you"
                </p>
              )}
              <p className="text-[11px] font-bold text-[#FF4F17] uppercase tracking-widest mb-1.5">Selected idea</p>
              <p className="text-sm font-semibold text-[#18181B] leading-snug mb-5">
                &ldquo;{pendingIdeaItem.idea}&rdquo;
              </p>
              <label className="block text-xs font-semibold text-[#71717A] uppercase tracking-wider mb-2">Tone (optional)</label>
              <div className="flex flex-wrap gap-2 mb-5">
                {MOODS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMood(selectedMood === m.id ? '' : m.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer"
                    style={{
                      borderColor: selectedMood === m.id ? '#FF4F17' : '#E4E4E0',
                      background: selectedMood === m.id ? '#FFF3EF' : 'transparent',
                      color: selectedMood === m.id ? '#FF4F17' : '#71717A',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {error && (
                <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-[#FEE2E2] text-[#EF4444] text-sm">{error}</div>
              )}
              <button
                onClick={handleConfirmPendingIdea}
                disabled={loading}
                className="w-full py-3 rounded-xl bg-[#FF4F17] text-white text-sm font-semibold hover:bg-[#E84410] disabled:opacity-40 transition-all cursor-pointer"
                style={{ boxShadow: '0 4px 12px rgba(255,79,23,0.25)' }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Writing script...
                  </span>
                ) : selectedMood ? (
                  `Generate script (${MOODS.find(m => m.id === selectedMood)?.label} tone) →`
                ) : (
                  'Generate script →'
                )}
              </button>
            </div>
          ) : (
            /* Ideas list */
            <div className="space-y-2">
              {generatedIdeas.map((item, i) => {
                const fmt = FORMAT_LABELS[item.format] ?? FORMAT_LABELS.educational
                return (
                  <button
                    key={i}
                    onClick={() => handleSelectGeneratedIdea(item)}
                    className="w-full group flex items-start gap-4 p-4 bg-white border border-[#E4E4E0] rounded-xl text-left hover:border-[#FF4F17] hover:bg-[#FFF8F6] active:scale-[0.99] transition-all duration-150 cursor-pointer"
                  >
                    <span
                      className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold mt-0.5"
                      style={{ background: '#F4F3F0', color: '#A1A1AA' }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span
                        className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-1.5"
                        style={{ background: fmt.bg, color: fmt.color }}
                      >
                        {fmt.label}
                      </span>
                      <p className="text-sm text-[#18181B] leading-relaxed">{item.idea}</p>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-1 group-hover:stroke-[#FF4F17] transition-colors">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Step: Generating */}
      {step === 'generating' && (
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-6 sm:p-10 flex flex-col items-center text-center gap-6 sm:gap-8">
          {/* Pulse animation from shared component */}
          <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
            <div className="absolute rounded-full animate-ping" style={{ width: 88, height: 88, border: '1px solid #FF4F17', opacity: 0.1, animationDuration: '2.4s', animationDelay: '0.6s' }} />
            <div className="absolute rounded-full animate-ping" style={{ width: 60, height: 60, border: '1px solid #FF4F17', opacity: 0.2, animationDuration: '2.4s', animationDelay: '0.3s' }} />
            <div className="absolute rounded-full animate-ping" style={{ width: 40, height: 40, border: '1.5px solid #FF4F17', opacity: 0.32, animationDuration: '2.4s' }} />
            <div className="relative flex items-center justify-center rounded-2xl animate-pulse" style={{ width: 48, height: 48, background: 'linear-gradient(145deg, #FF6B3D 0%, #FF4F17 55%, #D93D00 100%)', boxShadow: '0 0 24px rgba(255,79,23,0.35)', animationDuration: '1.8s' }}>
              <svg width="22" height="20" viewBox="0 0 18 16" fill="none">
                <path d="M9 1 L17 15 L1 15 Z" fill="white" />
                <path d="M9 1 L13.5 9 L4.5 9 Z" fill="white" fillOpacity="0.28" />
              </svg>
            </div>
          </div>

          <div className="w-full max-w-xs space-y-3">
            {GENERATING_STEPS.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-left transition-all duration-500"
                style={{
                  opacity: visibleSteps > i ? 1 : 0,
                  transform: visibleSteps > i ? 'translateY(0)' : 'translateY(6px)',
                }}
              >
                <div
                  className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: visibleSteps > i + 1 ? '#DCFCE7' : '#FFF3EF' }}
                >
                  {visibleSteps > i + 1 ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-[#FF4F17] animate-pulse" />
                  )}
                </div>
                <span className="text-sm" style={{ color: visibleSteps > i + 1 ? '#A1A1AA' : '#18181B' }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && scriptId && (
        <div className="bg-white border border-[#E4E4E0] rounded-2xl p-8 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#DCFCE7] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-[#18181B] mb-2" style={{ fontFamily: 'var(--font-jakarta)' }}>
            Script ready
          </h2>
          <p className="text-sm text-[#71717A] mb-6">
            Your script has been generated and is waiting for your review.
          </p>

          {/* Re-looping info */}
          <div className="w-full max-w-xs mb-6 px-4 py-3 rounded-xl bg-[#F4F3F0] flex items-start gap-3 text-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
            <p className="text-xs text-[#71717A] leading-relaxed">
              If you approve this script, it trains your engine   future scripts will match its style and quality.
            </p>
          </div>

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={() => {
                setStep('input')
                setIdea('')
                setScriptId(null)
                setGeneratedIdeas([])
                setSelectedFormat('')
              }}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[#E4E4E0] text-[#71717A] text-sm font-medium hover:bg-[#F4F3F0] transition-all cursor-pointer"
            >
              New idea
            </button>
            <button
              onClick={() => router.push(`/review/${scriptId}`)}
              className="flex-[2] py-2.5 px-4 rounded-xl bg-[#FF4F17] text-white text-sm font-semibold hover:bg-[#E84410] transition-all cursor-pointer"
            >
              Review script →
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showGenerateConfirm}
        title="Generate ideas"
        message="Generate 10 ideas using your brand profile? This uses AI credits."
        confirmLabel="Generate"
        onConfirm={() => { setShowGenerateConfirm(false); handleGenerateIdeas() }}
        onCancel={() => setShowGenerateConfirm(false)}
      />
    </div>
  )
}
