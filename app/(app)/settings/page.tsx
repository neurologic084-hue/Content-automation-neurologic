'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const TONE_OPTIONS = [
  'Warm', 'Direct', 'Science-backed', 'Empathetic', 'Calm',
  'Confident', 'Conversational', 'Educational', 'Motivating', 'Honest',
  'Grounded', 'Bold', 'Nurturing', 'No-nonsense', 'Hopeful',
]

const MAX_PROFILES = 3

type Offering = { name: string; description: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface ProfileData {
  id: string | null
  profile_slot: number
  profile_name: string
  is_active: boolean
  creator_name: string
  tagline: string
  location: string
  tone_keywords: string[]
  unique_angle: string
  audience_transformation: string
  audience_description: string
  offerings: string
  social_proof: string
  extra_context: string
}

function emptyProfile(slot: number): ProfileData {
  return {
    id: null,
    profile_slot: slot,
    profile_name: `Profile ${slot}`,
    is_active: false,
    creator_name: '',
    tagline: '',
    location: '',
    tone_keywords: [],
    unique_angle: '',
    audience_transformation: '',
    audience_description: '',
    offerings: '',
    social_proof: '',
    extra_context: '',
  }
}

function parseOfferings(raw: string): Offering[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length) return parsed
  } catch {}
  return raw.split('\n').filter(Boolean).map(line => {
    const idx = line.indexOf(': ')
    return idx > -1
      ? { name: line.slice(0, idx), description: line.slice(idx + 2) }
      : { name: line, description: '' }
  })
}

function serializeOfferings(items: Offering[]): string {
  return items
    .filter(o => o.name.trim())
    .map(o => o.description.trim() ? `${o.name}: ${o.description}` : o.name)
    .join('\n')
}

function Section({
  num, title, description, action, children,
}: {
  num: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div
      className="bg-white rounded-2xl border border-[#EAEAE6] overflow-hidden"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)' }}
    >
      <div className="px-4 sm:px-7 pt-5 sm:pt-6 pb-4 sm:pb-5 border-b border-[#F2F2EF] flex items-start justify-between gap-4">
        <div>
          <span className="inline-block text-[10px] font-semibold tracking-widest text-[#BABAB6] uppercase mb-2.5 font-mono">{num}</span>
          <h2
            className="text-[15px] font-semibold text-[#111111] leading-snug"
            style={{ fontFamily: 'var(--font-jakarta)' }}
          >
            {title}
          </h2>
          <p className="text-[13px] text-[#9B9B97] mt-1.5 leading-relaxed">{description}</p>
        </div>
        {action && <div className="flex-shrink-0 mt-1">{action}</div>}
      </div>
      <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">{children}</div>
    </div>
  )
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube',
  facebook: 'Facebook', linkedin: 'LinkedIn', twitter: 'X / Twitter', threads: 'Threads',
}

// Live list of the social accounts connected in Blotato. Read-only on purpose:
// connecting/swapping an account is an OAuth flow that has to run in Blotato's
// own dashboard — this section makes that path obvious instead of hidden.
function ConnectedAccounts() {
  const [accounts, setAccounts] = useState<{ id: string; platform: string; username?: string; fullname?: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/publish/accounts')
      .then(r => r.json())
      .then(d => d.accounts ? setAccounts(d.accounts) : setError(d.error ?? 'Could not load accounts.'))
      .catch(e => setError((e as Error).message))
  }, [])

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-[13px] text-[#EF4444]">{error}</p>
      ) : !accounts ? (
        <p className="text-[13px] text-[#9B9B97]">Loading connected accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-[13px] text-[#9B9B97]">No accounts connected yet.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[#FAFAF8] border border-[#F0F0EC]">
              <span className="text-[13px] font-semibold text-[#333330] w-24 flex-shrink-0">
                {PLATFORM_LABEL[a.platform.toLowerCase()] ?? a.platform}
              </span>
              <span className="text-[13px] text-[#71717A] truncate">
                {a.username ? `@${a.username}` : a.fullname || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12px] text-[#9B9B97] leading-relaxed">
          To connect a different account, open Blotato → Accounts, disconnect the old one and connect the new one. Changes appear here and in Publish automatically.
        </p>
        <a
          href="https://my.blotato.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 px-4 py-2 rounded-xl text-[13px] font-semibold border border-[#E4E4E0] text-[#333330] hover:border-[#FF4F17] hover:text-[#FF4F17] transition-colors"
        >
          Manage in Blotato ↗
        </a>
      </div>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[13px] font-medium text-[#333330]">
          {label}
          {required && <span className="text-[#FF4F17] ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[11px] text-[#BABAB6]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputCls =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#E4E0DA] bg-[#FAFAF8] text-[14px] text-[#111111] placeholder:text-[#C4C0BB] focus:outline-none focus:ring-2 focus:ring-[#FF4F17]/25 focus:border-[#FF4F17] transition-all'
const textareaCls = `${inputCls} resize-none leading-relaxed`
const rowInputCls =
  'px-3.5 py-2.5 rounded-xl border border-[#E4E0DA] bg-[#FAFAF8] text-[13px] text-[#111111] placeholder:text-[#C4C0BB] focus:outline-none focus:ring-2 focus:ring-[#FF4F17]/25 focus:border-[#FF4F17] transition-all'

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [activating, setActivating] = useState(false)

  const [selectedSlot, setSelectedSlot] = useState(1)
  const [profileCache, setProfileCache] = useState<Record<number, ProfileData>>({})

  const [form, setForm] = useState<ProfileData>(emptyProfile(1))
  const [offerings, setOfferings] = useState<Offering[]>([])

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('brand_settings')
        .select('*')
        .order('profile_slot', { ascending: true })

      const cache: Record<number, ProfileData> = {}
      for (const row of data ?? []) {
        const slot = row.profile_slot ?? 1
        if (slot >= 1 && slot <= MAX_PROFILES) {
          cache[slot] = row as ProfileData
        }
      }
      setProfileCache(cache)

      const activeSlot = (Object.values(cache).find(p => p.is_active) ?? cache[1])?.profile_slot ?? 1
      const startProfile = cache[activeSlot] ?? emptyProfile(activeSlot)
      setSelectedSlot(activeSlot)
      setForm(startProfile)
      setOfferings(parseOfferings(startProfile.offerings ?? ''))
      setLoading(false)
    }
    load()
  }, [])

  function switchSlot(slot: number) {
    if (slot === selectedSlot) return
    setProfileCache(prev => ({
      ...prev,
      [selectedSlot]: { ...form, offerings: serializeOfferings(offerings) },
    }))
    const profile = profileCache[slot] ?? emptyProfile(slot)
    setSelectedSlot(slot)
    setForm(profile)
    setOfferings(parseOfferings(profile.offerings ?? ''))
    setSaveState('idle')
  }

  function set(field: keyof ProfileData, value: unknown) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleTone(tone: string) {
    setForm(prev => ({
      ...prev,
      tone_keywords: prev.tone_keywords.includes(tone)
        ? prev.tone_keywords.filter(t => t !== tone)
        : prev.tone_keywords.length < 6
          ? [...prev.tone_keywords, tone]
          : prev.tone_keywords,
    }))
  }

  function addOffering() {
    setOfferings(prev => [...prev, { name: '', description: '' }])
  }
  function removeOffering(i: number) {
    setOfferings(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateOffering(i: number, field: 'name' | 'description', value: string) {
    setOfferings(prev => prev.map((o, idx) => idx === i ? { ...o, [field]: value } : o))
  }

  async function saveProfile(silent = false): Promise<string | null> {
    if (!silent) setSaveState('saving')
    const supabase = createClient()

    const saveData = {
      profile_slot: selectedSlot,
      profile_name: `Profile ${selectedSlot}`,
      is_active: form.is_active,
      creator_name: form.creator_name,
      tagline: form.tagline,
      location: form.location,
      tone_keywords: form.tone_keywords,
      unique_angle: form.unique_angle,
      audience_transformation: form.audience_transformation,
      audience_description: form.audience_description,
      offerings: serializeOfferings(offerings),
      social_proof: form.social_proof,
      extra_context: form.extra_context,
      updated_at: new Date().toISOString(),
    }

    let savedId = form.id

    if (form.id) {
      const { error } = await supabase.from('brand_settings').update(saveData).eq('id', form.id)
      if (error) {
        if (!silent) { setSaveState('error'); setTimeout(() => setSaveState('idle'), 3000) }
        return null
      }
    } else {
      const { data, error } = await supabase.from('brand_settings').insert(saveData).select('id').single()
      if (error || !data) {
        if (!silent) { setSaveState('error'); setTimeout(() => setSaveState('idle'), 3000) }
        return null
      }
      savedId = data.id
      setForm(prev => ({ ...prev, id: data.id }))
    }

    const updatedProfile: ProfileData = {
      ...form,
      id: savedId,
      profile_name: `Profile ${selectedSlot}`,
      offerings: serializeOfferings(offerings),
    }
    setProfileCache(prev => ({ ...prev, [selectedSlot]: updatedProfile }))

    if (!silent) {
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2500)
    }

    return savedId
  }

  async function handleSetActive() {
    setActivating(true)
    let currentId = form.id
    if (!currentId) {
      currentId = await saveProfile(true)
      if (!currentId) { setActivating(false); return }
    }

    const supabase = createClient()
    await supabase.from('brand_settings').update({ is_active: false }).in('profile_slot', [1, 2, 3])
    await supabase.from('brand_settings').update({ is_active: true }).eq('id', currentId)

    setForm(prev => ({ ...prev, is_active: true }))
    setProfileCache(prev => {
      const updated: Record<number, ProfileData> = {}
      for (const [slotKey, profile] of Object.entries(prev)) {
        updated[Number(slotKey)] = { ...profile, is_active: Number(slotKey) === selectedSlot }
      }
      return updated
    })
    setActivating(false)
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-[#FF4F17] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isActive = form.is_active
  const canSave = form.creator_name.trim().length > 0

  return (
    <div className="p-6 md:p-8 max-w-2xl w-full mx-auto pb-32">

      {/* Header */}
      <div className="mb-6 animate-fadeInUp">
        <h1
          className="text-2xl font-bold text-[#111111]"
          style={{ fontFamily: 'var(--font-jakarta)' }}
        >
          Brand voice
        </h1>
        <p className="mt-1.5 text-[13px] text-[#9B9B97] leading-relaxed">
          Everything here feeds into every script the AI writes. The active profile is used for all script generation.
        </p>
      </div>

      {/* Profile Switcher */}
      <div className="animate-fadeInUp p-1 bg-[#F4F3F0] rounded-2xl mb-5 flex gap-1" style={{ animationDelay: '50ms' }}>
        {Array.from({ length: MAX_PROFILES }, (_, i) => i + 1).map(slot => {
          const profile = profileCache[slot]
          const isSelected = selectedSlot === slot
          const slotIsActive = profile?.is_active ?? false

          return (
            <button
              key={slot}
              onClick={() => switchSlot(slot)}
              className="flex-1 relative flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-[13px] font-medium transition-all duration-150 cursor-pointer"
              style={{
                background: isSelected ? 'white' : 'transparent',
                color: isSelected ? '#111111' : '#9B9B97',
                boxShadow: isSelected ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <span>Profile {slot}</span>
              {slotIsActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: '#22C55E' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Active / not-active banner */}
      {isActive ? (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#DCFCE7] border border-[#BBF7D0] mb-5">
          <span className="w-2 h-2 rounded-full bg-[#22C55E] flex-shrink-0" />
          <p className="text-[13px] font-medium text-[#16A34A]">
            Active profile — all scripts use this brand context
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#FFF8F6] border border-[#FFD7CC] mb-5">
          <p className="text-[13px] text-[#9B6B5E]">
            This profile is not active. Scripts are using a different profile.
          </p>
          <button
            onClick={handleSetActive}
            disabled={activating}
            className="flex-shrink-0 text-[13px] font-semibold text-[#FF4F17] hover:text-[#E84410] transition-colors cursor-pointer disabled:opacity-50"
          >
            {activating ? 'Activating...' : 'Use this profile →'}
          </button>
        </div>
      )}

      <div className="space-y-4">

        {/* 01 — Identity */}
        <Section num="01" title="Identity" description="Brand name, location and tagline injected into every hook and CTA.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Brand / Creator name" required>
              <input
                type="text"
                value={form.creator_name}
                onChange={e => set('creator_name', e.target.value)}
                placeholder="Dr. Jessica Wandeling"
                maxLength={80}
                className={inputCls}
              />
            </Field>
            <Field label="Location" hint="optional">
              <input
                type="text"
                value={form.location}
                onChange={e => set('location', e.target.value)}
                placeholder="Seattle, WA"
                maxLength={60}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Tagline" hint="optional">
            <input
              type="text"
              value={form.tagline}
              onChange={e => set('tagline', e.target.value)}
              placeholder="Your nervous system is the medicine"
              maxLength={120}
              className={inputCls}
            />
          </Field>
        </Section>

        {/* 02 — Positioning */}
        <Section num="02" title="Positioning & background" description="Your story, credentials, and what makes your approach different. The AI uses this to add credibility to every hook.">
          <textarea
            value={form.unique_angle}
            onChange={e => set('unique_angle', e.target.value)}
            placeholder={`I'm a functional neurologist with 12 years in clinical practice. Before starting my own practice I worked at the Seattle Integrative Health Center. I've personally recovered from adrenal burnout using the same protocols I now teach. I combine neurology, lifestyle medicine, and nervous system work — not just symptom management.`}
            rows={5}
            maxLength={1200}
            className={textareaCls}
          />
          <p className="text-right text-[11px] text-[#C4C0BB]">{form.unique_angle.length} / 1200</p>
        </Section>

        {/* 03 — Voice */}
        <Section
          num="03"
          title="Tone of voice"
          description="Pick up to 6 keywords. The AI calibrates sentence length, energy and word choice to match your style."
        >
          <div>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map(tone => {
                const active = form.tone_keywords.includes(tone)
                const maxed = form.tone_keywords.length >= 6 && !active
                return (
                  <button
                    key={tone}
                    type="button"
                    onClick={() => toggleTone(tone)}
                    disabled={maxed}
                    className="px-4 py-1.5 rounded-full text-[13px] font-medium border transition-all duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: active ? '#FF4F17' : '#F7F7F4',
                      color: active ? 'white' : '#6B6B68',
                      borderColor: active ? '#FF4F17' : '#E4E0DA',
                      boxShadow: active ? '0 2px 8px rgba(255,79,23,0.22)' : 'none',
                    }}
                  >
                    {tone}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-[#C4C0BB] mt-3">{form.tone_keywords.length} / 6 selected</p>
          </div>
        </Section>

        {/* 04 — Offerings */}
        <Section
          num="04"
          title="Products & programs"
          description="Your courses, communities, or services. The AI names these accurately in every CTA."
          action={
            <button
              onClick={addOffering}
              className="flex items-center gap-1.5 text-[13px] font-semibold text-[#FF4F17] hover:text-[#E84410] transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add
            </button>
          }
        >
          {offerings.length === 0 ? (
            <p className="text-[13px] text-[#C4C0BB] py-1">
              No offerings yet.{' '}
              <button onClick={addOffering} className="text-[#FF4F17] hover:underline cursor-pointer">Add one</button>
            </p>
          ) : (
            <div className="space-y-2.5">
              {offerings.map((o, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-[#F4F3F0] flex items-center justify-center text-[11px] font-semibold text-[#BABAB6] flex-shrink-0">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={o.name}
                    onChange={e => updateOffering(i, 'name', e.target.value)}
                    placeholder="Nervous System Reset"
                    maxLength={60}
                    className={`w-[160px] flex-shrink-0 font-medium ${rowInputCls}`}
                  />
                  <input
                    type="text"
                    value={o.description}
                    onChange={e => updateOffering(i, 'description', e.target.value)}
                    placeholder="90-day 1:1 program / $1,200"
                    maxLength={120}
                    className={`flex-1 min-w-0 ${rowInputCls}`}
                  />
                  <button
                    onClick={() => removeOffering(i)}
                    className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-[#C4C0BB] hover:text-[#EF4444] hover:bg-[#FEF2F2] transition-all cursor-pointer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* 05 — Ideal Client */}
        <Section num="05" title="Ideal audience" description="Who you are talking to. The more specific this is, the more targeted every hook and CTA becomes.">
          <textarea
            value={form.audience_description}
            onChange={e => set('audience_description', e.target.value)}
            placeholder={`Women 30–50, often high-achievers dealing with anxiety, exhaustion, or ADHD that doctors dismiss as "just stress." They've tried therapy, medication, and cutting back on work but nothing fixes the root cause. They find me through Instagram or Google searching "nervous system burnout" or "why am I always tired."`}
            rows={6}
            maxLength={1500}
            className={textareaCls}
          />
          <p className="text-right text-[11px] text-[#C4C0BB]">{form.audience_description.length} / 1500</p>
        </Section>

        {/* 06 — Social Proof */}
        <Section num="06" title="Results & social proof" description="Real wins from your community. The AI weaves these into scripts as specific, credible proof.">
          <textarea
            value={form.social_proof}
            onChange={e => set('social_proof', e.target.value)}
            placeholder={`Emily — panic attacks 3x/week, zero after 12 weeks, now off Lexapro with her psychiatrist's sign-off\nSarah, burned-out marketing director — recovered energy in 8 weeks, got promoted 3 months later\n35% of clients report measurable sleep improvement within the first 30 days`}
            rows={6}
            maxLength={1500}
            className={textareaCls}
          />
          <p className="text-right text-[11px] text-[#C4C0BB]">{form.social_proof.length} / 1500</p>
        </Section>

        {/* 07 — Rules */}
        <Section num="07" title="Rules" description="Hard constraints the AI must never break. One rule per line. These override everything else.">
          <textarea
            value={form.extra_context}
            onChange={e => set('extra_context', e.target.value)}
            placeholder={`Never tell someone to stop their prescribed medication\nNever claim to cure or treat — say "support" or "address"\nNever name-drop other practitioners or compare to competitors\nNever use the word "journey"\nAlways keep an empowering tone — no shame, no catastrophising`}
            rows={7}
            maxLength={1500}
            className={`${textareaCls} font-mono text-[12px]`}
            style={{ fontFamily: 'var(--font-geist-mono)' }}
          />
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-[#EEF2FF]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-[12px] text-[#4F52E0] leading-relaxed">
              Injected at the top of every prompt as non-negotiable constraints — they override tone, style, and everything else.
            </p>
          </div>
        </Section>

        <Section
          num="08"
          title="Connected social accounts"
          description="Where your videos get published. Accounts are linked through Blotato — connect or swap them there and they show up here automatically."
        >
          <ConnectedAccounts />
        </Section>

      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-6 mt-6 z-10">
        <div
          className="flex items-center justify-between px-6 py-4 rounded-2xl border border-[#EAEAE6] bg-white/95"
          style={{
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.09), 0 2px 8px rgba(0,0,0,0.05)',
          }}
        >
          <p className="text-[12px] text-[#ADADAA]">
            {form.id
              ? 'Changes apply to all future scripts immediately.'
              : 'Save to create this profile.'}
          </p>
          <button
            onClick={() => saveProfile(false)}
            disabled={saveState === 'saving' || !canSave}
            className="px-6 py-2 rounded-xl text-[13px] font-semibold transition-all duration-200 cursor-pointer disabled:cursor-not-allowed"
            style={{
              background:
                saveState === 'saved' ? '#16A34A'
                  : saveState === 'error' ? '#EF4444'
                  : canSave ? '#FF4F17'
                  : '#E4E0DA',
              color: !canSave ? '#A0A09C' : 'white',
              opacity: saveState === 'saving' ? 0.7 : 1,
              boxShadow: saveState === 'idle' && canSave ? '0 4px 14px rgba(255,79,23,0.25)' : 'none',
            }}
          >
            {saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
              ? '✓ Saved'
              : saveState === 'error'
              ? 'Error — retry'
              : 'Save settings'}
          </button>
        </div>
      </div>

    </div>
  )
}
