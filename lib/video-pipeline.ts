import FormData from 'form-data'
import { chatCompletion, MODELS } from './openrouter'
import type { CaptionLane } from './variant-specs'

// Per-render background-music choice, picked in the video studio and stored on
// each variant. 'smart' = pick a mood-matched track from the curated library
// (with a safe neutral fallback); 'off' = no music. On the edit path (v4/v5)
// 'smart' uses our library; Submagic variants use their own music, so for them
// 'smart' just means "music on" and 'off' means "music off".
export type MusicMode = 'smart' | 'off'

export const DEFAULT_MUSIC_MODE: MusicMode = 'smart'

export interface SubmagicPreset {
  // Fully autonomous mode   Submagic handles everything (music, B-roll, cuts, style)
  aiEditTemplate?: 'kelly' | 'karl' | 'ella'
}

// Steers the AI's per-render settings choice instead of hardcoding numbers.
// useMusic is deterministic (not AI-guessed) so variants have real, predictable
// variety — some calm/voiceonly, some energetic/with music.
export interface SubmagicProfile {
  directive: string
  useMusic: boolean
}

export interface VideoVariantDef {
  id: string
  name: string
  description: string
  tool: 'submagic' | 'edit'
  order: number
  autoStart: boolean   // true = runs immediately on job creation; false = user starts manually
  submagicPreset?: SubmagicPreset
  submagicProfile?: SubmagicProfile
  nativeCaptions?: boolean     // burn ASS karaoke captions via ElevenLabs Scribe + FFmpeg
  captionTestOnly?: boolean    // skip Submagic entirely, caption the raw footage directly
  motionGraphicsTestOnly?: boolean  // skip Submagic entirely; raw footage + Remotion graphics only
  remotionEdit?: boolean       // Remotion-only FULL edit (cuts, captions, zooms, SFX) — no Submagic anywhere
  motionGraphics?: boolean     // plan + render front-loaded brand graphics (Remotion) and composite them in
  motionGraphicsStyle?: 'minimal' | 'bold'  // which Remotion visual treatment to render
  submagicMagicBrolls?: boolean    // Submagic's own stock B-roll (our-v4/v5's edit-tool path)
  submagicMagicZooms?: boolean     // Submagic's own zoom-ins (our-v4/v5's edit-tool path)
}

export interface VideoVariant extends VideoVariantDef {
  status: 'pending' | 'processing' | 'ready' | 'failed'
  external_id: string | null  // Submagic project ID when tool === 'submagic'
  preview_url: string | null
  download_url: string | null
  duration_seconds: number | null
  error: string | null
  progress?: { step: number; total: number; label: string } | null
  // CC-BY credit line for the background track used, when the chosen library
  // track requires attribution. The publish flow appends it to the post so the
  // license is satisfied. null when no credit is needed.
  music_attribution?: string | null
  // Per-render music choice for this job (same for every variant). Read by the
  // render path to decide source / whether to add music at all.
  music_mode?: MusicMode
}

export const VARIANT_DEFINITIONS: VideoVariantDef[] = [
  {
    id: 'our-v1',
    name: 'Calm & Clean',
    description: 'Soft pacing, minimal captions, gentle zooms. Your voice leads — ideal for sensitive or educational topics.',
    tool: 'submagic',
    order: 1,
    autoStart: false,
    submagicProfile: {
      directive: 'Calm, gentle energy suited to sensitive, personal, medical, or educational content. Keep B-roll light and unobtrusive, pacing natural (never extra-fast), zooms subtle. The voice should feel like it is carrying the video alone.',
      useMusic: false,
    },
  },
  {
    id: 'our-v2',
    name: 'Aesthetic',
    description: 'Elegant captions with italic accents, punch-in zooms, and B-roll cutaways. Music sits softly under the voice.',
    tool: 'submagic',
    order: 2,
    autoStart: false,
    submagicProfile: {
      directive: 'UGC-style aesthetic edit: small elegant captions, brisk-but-natural pacing, punch-in zooms, light photo-style B-roll grounded in what is said. Clean isolated voice carries the video; music stays subtle underneath.',
      useMusic: true,
    },
  },
  {
    id: 'our-v3',
    name: 'Creator Classic',
    description: 'Clean minimal captions, multi-angle punch-ins, and B-roll that follows what you say — with music underneath.',
    tool: 'submagic',
    order: 3,
    autoStart: false,
    submagicProfile: {
      directive: 'UGC-style aesthetic edit: small elegant captions, brisk-but-natural pacing, punch-in zooms, light stock B-roll grounded in what is said. Clean isolated voice carries the video; music stays subtle underneath.',
      useMusic: true,
    },
  },
  // v4/v5/v6 are the Remotion-only family: the full edit (voice isolation,
  // silence/retake cuts, captions, zooms, transitions, B-roll, SFX, music)
  // renders locally with zero Submagic involvement. Each variant has a FIXED
  // caption identity + B-roll flavor (see lib/render-kit.ts); transitions and
  // sound kits are smart-randomized per render so reruns give fresh takes.
  {
    id: 'our-v4',
    name: 'Concept Pro',
    description: 'Premium concept-driven edit: color-coded captions, on-screen checklists and frameworks that visualize your points, punch-in cuts, and tactile sound design.',
    tool: 'edit',
    order: 4,
    autoStart: false,
    remotionEdit: true,
  },
  {
    id: 'our-v5',
    name: 'Viral Energy',
    description: 'High-energy edit: golden accent captions, full-screen B-roll pushes, designed stat cards, and framing jumps on every beat.',
    tool: 'edit',
    order: 5,
    autoStart: false,
    remotionEdit: true,
  },
  {
    id: 'our-v6',
    name: 'Cinematic',
    description: 'Dark moody grade, minimal captions, and glowing on-screen graphics that visualize your key points as you speak.',
    tool: 'edit',
    order: 6,
    autoStart: false,
    remotionEdit: true,
  },
]

export function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? null
}

// ── ElevenLabs   Transcription ────────────────────────────────────────────────

export async function transcribeVideo(videoUrl: string): Promise<{
  transcript: string
  words: { text: string; start: number; end: number }[]
}> {
  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  form.append('cloud_storage_url', videoUrl)
  form.append('language_code', 'en')
  form.append('timestamps_granularity', 'word')

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      ...form.getHeaders(),
    },
    body: form as unknown as BodyInit,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs transcription failed: ${err}`)
  }

  const data = await res.json()
  return {
    transcript: data.text ?? '',
    words: (data.words ?? []).map((w: { text: string; start: number; end: number }) => ({
      text: w.text,
      start: w.start,
      end: w.end,
    })),
  }
}

// ── Submagic   Submit full-featured job ───────────────────────────────────────

export interface SubmagicJobOptions {
  title: string
  aiEditTemplate?: 'kelly' | 'karl' | 'ella'
  templateName?: string
  userThemeId?: string   // custom theme (mutually exclusive with templateName — wins when both set)
  magicBrolls?: boolean
  magicBrollsPercentage?: number
  magicZooms?: boolean
  hookTitle?: boolean | { text?: string; template?: string; top?: number; size?: number }
  removeSilencePace?: 'natural' | 'fast' | 'extra-fast'
  removeBadTakes?: boolean
  cleanAudio?: boolean
  musicTrackId?: string
}

interface SubmagicTemplateOption {
  id?: string
  name: string
  description?: string
}

interface SmartSubmagicSettings {
  templateName?: string
  magicBrolls: boolean
  magicBrollsPercentage: number
  hookTitle: boolean | { text?: string; template?: string; top?: number; size?: number }
  removeSilencePace: 'natural' | 'fast' | 'extra-fast'
}

// Non-negotiable baseline for every Submagic render — never left to the AI or
// a per-variant profile, always forced true at the call site. Zoom, bad-take
// removal, and audio cleanup are core quality bars, not stylistic choices.
export const SUBMAGIC_ALWAYS_ON = {
  removeBadTakes: true,
  // Conventional default. NOTE: requires a Submagic plan tier that includes Clean
  // Audio ("Clean audio requires a higher plan") — renders fail otherwise.
  cleanAudio: true,
  magicZooms: true,
} as const

let submagicTemplateCache: { expiresAt: number; templates: SubmagicTemplateOption[] } | null = null

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, value))
}

async function fetchSubmagicTemplates(): Promise<SubmagicTemplateOption[]> {
  if (submagicTemplateCache && submagicTemplateCache.expiresAt > Date.now()) {
    return submagicTemplateCache.templates
  }

  try {
    const res = await fetch('https://api.submagic.co/v1/templates', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY!, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[submagic] template discovery failed (${res.status}): ${text.slice(0, 250)}`)
      submagicTemplateCache = { expiresAt: Date.now() + 5 * 60 * 1000, templates: [] }
      return []
    }

    const data = JSON.parse(text)
    const rawTemplates = Array.isArray(data) ? data : (data.templates ?? data.items ?? data.results ?? [])
    const templates = (Array.isArray(rawTemplates) ? rawTemplates : [])
      .map((t: string | { id?: string; name?: string; title?: string; description?: string }) => (
        typeof t === 'string'
          ? { name: t }
          : {
              id: t.id,
              name: t.name ?? t.title ?? '',
              description: t.description,
            }
      ))
      .filter((t: SubmagicTemplateOption) => t.name)
      .slice(0, 50)

    console.log(`[submagic] discovered ${templates.length} templates`)
    submagicTemplateCache = { expiresAt: Date.now() + 60 * 60 * 1000, templates }
    return templates
  } catch (e) {
    console.warn('[submagic] template discovery error:', (e as Error).message)
    return []
  }
}

function normalizeSubmagicSettings(
  raw: Partial<SmartSubmagicSettings>,
  templates: SubmagicTemplateOption[],
): SmartSubmagicSettings {
  const allowedNames = new Set(templates.map(t => t.name))
  const templateName = raw.templateName && allowedNames.has(raw.templateName)
    ? raw.templateName
    : undefined

  const silence = raw.removeSilencePace === 'extra-fast' || raw.removeSilencePace === 'fast' || raw.removeSilencePace === 'natural'
    ? raw.removeSilencePace
    : 'natural'

  return {
    templateName,
    magicBrolls: raw.magicBrolls ?? true,
    magicBrollsPercentage: Math.round(clampNumber(raw.magicBrollsPercentage, 8, 26, 16)),
    hookTitle: raw.hookTitle ?? true,
    removeSilencePace: silence,
  }
}

export async function deriveSmartSubmagicSettings(
  script: { hook: string; cta: string; mood_tag: string | null; script_format?: string },
  opts: { profileDirective?: string; actualTranscript?: string } = {},
): Promise<SmartSubmagicSettings> {
  const templates = await fetchSubmagicTemplates()
  const fallback = normalizeSubmagicSettings({}, templates)

  try {
    const templateList = templates.length
      ? templates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
      : 'No templates available from API right now. Use null templateName.'

    // The actual transcript is what viewers hear — if the creator improvised
    // or deviated from the written script while filming, weight decisions
    // toward what's really in the footage, not just the intended hook/CTA.
    const transcriptBlock = opts.actualTranscript
      ? `\nActual spoken transcript from the recorded footage (this is what viewers will hear — if it differs from the hook/CTA above in tone, topic, or specificity, prioritize THIS over the written script):\n"${opts.actualTranscript.slice(0, 1500)}"\n`
      : ''

    const directiveBlock = opts.profileDirective
      ? `\nEditing direction for this specific variant (follow this style, but pick the actual numbers yourself based on the content above): ${opts.profileDirective}\n`
      : ''

    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      max_tokens: 600,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'Choose Submagic API settings for a short-form talking-head edit.',
          `Hook (written script): ${script.hook}`,
          `CTA (written script): ${script.cta}`,
          `Mood: ${script.mood_tag ?? 'unspecified'}`,
          `Format: ${script.script_format ?? 'unspecified'}`,
          transcriptBlock,
          directiveBlock,
          'Available caption/templates:',
          templateList,
          '',
          'Rules:',
          '- Choose templateName only from the exact available names, otherwise null.',
          '- Keep B-roll percentage and pacing consistent with the editing direction above, grounded in the actual content (transcript if given, else hook/CTA).',
          '- Use extra-fast pace only for very punchy sales/list-style content, never for calm/personal/medical content.',
          '- Return JSON only:',
          '{"templateName": string|null, "magicBrolls": boolean, "magicBrollsPercentage": number, "hookTitle": boolean, "removeSilencePace": "natural|fast|extra-fast"}',
        ].join('\n'),
      }],
    })

    const parsed = JSON.parse(raw) as Partial<SmartSubmagicSettings>
    const settings = normalizeSubmagicSettings(parsed, templates)
    console.log('[submagic] smart settings:', JSON.stringify(settings))
    return settings
  } catch (e) {
    console.warn('[submagic] smart settings failed, using fallback:', (e as Error).message)
    return fallback
  }
}

let premiumTemplateCache: { expiresAt: number; names: [string | undefined, string | undefined] } | null = null

// our-v4/our-v5 only use Submagic for the cut/clean/caption pass (no B-roll, no
// zooms -- the Remotion layer carries the visual interest), and want two
// genuinely distinct premium caption looks, never the punchy Hormozi-style
// templates. Cached briefly so both variants starting around the same time
// land on the same pair instead of each independently re-asking the model.
export async function pickPremiumTemplates(): Promise<[string | undefined, string | undefined]> {
  if (premiumTemplateCache && premiumTemplateCache.expiresAt > Date.now()) {
    return premiumTemplateCache.names
  }

  const templates = await fetchSubmagicTemplates()
  const candidates = templates.filter(t => !/hormozi/i.test(t.name))
  if (!candidates.length) return [undefined, undefined]

  let names: [string | undefined, string | undefined] = [candidates[0]?.name, candidates[1]?.name ?? candidates[0]?.name]
  try {
    const list = candidates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
    const raw = await chatCompletion({
      model: MODELS.fast,
      json: true,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Pick 2 distinct premium, clean caption styles from this list for a med-spa clinic's short-form videos — elegant and minimal, never punchy or meme-style. Return JSON only: {"a": "<exact name>", "b": "<exact name>"}\n\n${list}`,
      }],
    })
    const parsed = JSON.parse(raw) as { a?: string; b?: string }
    const allowed = new Set(candidates.map(t => t.name))
    const a = parsed.a && allowed.has(parsed.a) ? parsed.a : names[0]
    const b = parsed.b && allowed.has(parsed.b) && parsed.b !== a ? parsed.b : (candidates.find(t => t.name !== a)?.name ?? a)
    names = [a, b]
  } catch (e) {
    console.warn('[submagic] premium template pick failed, using fallback order:', (e as Error).message)
  }

  premiumTemplateCache = { expiresAt: Date.now() + 30 * 60 * 1000, names }
  return names
}

// ── Submagic   Caption lane classifier (V2) ───────────────────────────────────
// V2 variants each own a fixed caption "lane" (minimal / clean / bold) — that is
// the deliberate diversity Daniel picks from. This sorts the discovered template
// pool into those three lanes ONCE (cached), so a variant's lane resolves to a
// real Submagic templateName at render time. Hormozi-style templates are excluded
// to stay on-brand for the clinic (same rule as pickPremiumTemplates).

const LANE_ORDER: CaptionLane[] = ['minimal', 'clean', 'bold']

let captionLaneCache: { expiresAt: number; lanes: Record<CaptionLane, string[]> } | null = null

async function classifyCaptionLanes(): Promise<Record<CaptionLane, string[]>> {
  if (captionLaneCache && captionLaneCache.expiresAt > Date.now()) return captionLaneCache.lanes

  const templates = await fetchSubmagicTemplates()
  const candidates = templates.filter(t => !/hormozi/i.test(t.name))

  // Fallback: spread candidates across the three lanes by position so every lane
  // has something even if the model call fails or no templates are available.
  const lanes: Record<CaptionLane, string[]> = { minimal: [], clean: [], bold: [] }
  candidates.forEach((t, i) => { lanes[LANE_ORDER[i % 3]].push(t.name) })

  if (candidates.length) {
    try {
      const list = candidates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
      const raw = await chatCompletion({
        model: MODELS.fast,
        json: true,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Sort these caption templates into three lanes for a med-spa clinic's short-form videos:\n` +
            `- "minimal": most understated, elegant, barely-there\n` +
            `- "clean": balanced, premium, clearly readable\n` +
            `- "bold": punchiest of the tasteful set (never meme/Hormozi-style)\n\n` +
            `Every template goes in exactly one lane; use the exact names. Return JSON only: ` +
            `{"minimal": ["..."], "clean": ["..."], "bold": ["..."]}\n\n${list}`,
        }],
      })
      const parsed = JSON.parse(raw) as Partial<Record<CaptionLane, string[]>>
      const allowed = new Set(candidates.map(t => t.name))
      const cleaned: Record<CaptionLane, string[]> = { minimal: [], clean: [], bold: [] }
      for (const lane of LANE_ORDER) {
        cleaned[lane] = (parsed[lane] ?? []).filter(n => typeof n === 'string' && allowed.has(n))
      }
      // Only trust the model's split if it actually placed templates; else keep
      // the positional fallback so no lane ends up empty.
      if (LANE_ORDER.some(l => cleaned[l].length)) {
        for (const lane of LANE_ORDER) if (cleaned[lane].length) lanes[lane] = cleaned[lane]
      }
    } catch (e) {
      console.warn('[submagic] caption lane classification failed, using positional fallback:', (e as Error).message)
    }
  }

  captionLaneCache = { expiresAt: Date.now() + 30 * 60 * 1000, lanes }
  return lanes
}

// Resolve a variant's fixed lane (nudged by the profile's caption mood) to a
// concrete Submagic templateName. Returns undefined only when the pool is empty
// (Submagic then uses its default), which the render tolerates.
export async function resolveCaptionTemplate(
  lane: CaptionLane,
  mood: 'calm' | 'clean' | 'energetic' = 'clean',
): Promise<string | undefined> {
  const lanes = await classifyCaptionLanes()

  // Mood is a gentle secondary nudge: an energetic read bumps toward bolder, a
  // calm read toward softer — but only borrows a neighbor lane if the variant's
  // own lane is empty, so the deliberate per-variant diversity stays intact.
  const neighbors: Record<CaptionLane, CaptionLane[]> =
    mood === 'energetic'
      ? { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'bold', 'minimal'], bold: ['bold', 'clean', 'minimal'] }
      : mood === 'calm'
        ? { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'minimal', 'bold'], bold: ['bold', 'clean', 'minimal'] }
        : { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'minimal', 'bold'], bold: ['bold', 'clean', 'minimal'] }

  for (const l of neighbors[lane]) {
    const picks = lanes[l]
    if (picks?.length) {
      // Within a lane, an energetic mood reaches for the last (boldest) entry, a
      // calm mood the first; otherwise the first.
      return mood === 'energetic' ? picks[picks.length - 1] : picks[0]
    }
  }
  return undefined
}

// Resolve a variant's pinned template pool: first pool entry that actually
// exists on the account wins, so a renamed/removed Submagic template degrades
// to the next choice instead of breaking the render. Returns undefined when
// none match (caller falls back to lane resolution).
export async function resolvePooledTemplate(pool: string[]): Promise<string | undefined> {
  const templates = await fetchSubmagicTemplates()
  const available = new Set(templates.map(t => t.name))
  return pool.find(name => available.has(name))
}

// ── Submagic   Fetch first available audio track for music param ──────────────

// The creator's library tracks seeded into Submagic user-media, keyed by the
// library's mood categories (fileName is how the API identifies them). Music
// is mixed BY SUBMAGIC in-render — our local library is never touched here.
const SUBMAGIC_TRACKS_BY_MOOD: Record<string, string[]> = {
  calm: ['aglow.mp3', 'dragonfly.mp3'],
  curious: ['first-kiss.mp3', 'going-quietly.mp3'],
  emotional: ['3-am-walk-slowed-reverb-version.mp3', '7-years-lukas-graham-slowed-chill-piano-version.mp3'],
  funny: ['greedy.mp3'],
  happy: ['cheri-cheri-lady.mp3', 'dip-dip.mp3'],
  motivation: ['cocaina.mp3', 'gravitational-forces.mp3'],
  sad: ['another-love-instrumental.mp3', 'freaks-guitar.mp3'],
}

// Script mood tags -> library mood categories.
const MOOD_TAG_TO_CATEGORY: Record<string, string> = {
  calm: 'calm',
  energetic: 'motivation',
  empathetic: 'emotional',
  educational: 'curious',
  bold: 'motivation',
  'story-driven': 'emotional',
}

export async function fetchSubmagicAudioTrack(moodTag?: string | null): Promise<string | null> {
  try {
    const res = await fetch('https://api.submagic.co/v1/user-media?type=AUDIO&limit=50', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[submagic] audio media lookup failed (${res.status}): ${text.slice(0, 250)}`)
      return null
    }
    const data = JSON.parse(text)
    const items: Array<{ id?: string; fileName?: string; name?: string; title?: string }> =
      Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : []
    if (!items.length) return null

    const nameOf = (item: (typeof items)[number]) => item.fileName ?? item.name ?? item.title ?? ''

    // Mood-matched pick first, calm as the safe default, then anything.
    const category = MOOD_TAG_TO_CATEGORY[moodTag ?? ''] ?? 'calm'
    const wanted = SUBMAGIC_TRACKS_BY_MOOD[category] ?? []
    const calmSet = SUBMAGIC_TRACKS_BY_MOOD.calm
    const picked =
      items.find(i => wanted.includes(nameOf(i)))
      ?? items.find(i => calmSet.includes(nameOf(i)))
      ?? items[0]
    if (picked?.id) console.log(`[submagic] selected audio media: ${nameOf(picked) || picked.id} (mood: ${moodTag ?? 'none'} -> ${category})`)
    return picked?.id ?? null
  } catch {
    return null
  }
}

export async function submitSubmagicJob(
  videoUrl: string,
  opts: SubmagicJobOptions
): Promise<string> {
  // aiEditTemplate mode: Submagic controls everything   only base fields allowed
  const body: Record<string, unknown> = opts.aiEditTemplate
    ? {
        title: opts.title,
        language: 'en',
        videoUrl,
        aiEditTemplate: opts.aiEditTemplate,
      }
    : {
        title: opts.title,
        language: 'en',
        videoUrl,
        templateName: opts.templateName,
        magicBrolls: opts.magicBrolls ?? false,
        magicZooms: opts.magicZooms ?? false,
        cleanAudio: opts.cleanAudio ?? true,
        removeSilencePace: opts.removeSilencePace ?? 'extra-fast',
        removeBadTakes: opts.removeBadTakes ?? false,
      }

  if (!opts.aiEditTemplate) {
    if (opts.magicBrolls) body.magicBrollsPercentage = opts.magicBrollsPercentage ?? 40
    if (opts.hookTitle !== undefined) body.hookTitle = opts.hookTitle
    if (opts.musicTrackId) body.music = { userMediaId: opts.musicTrackId, volume: 30, fade: true }
    if (opts.userThemeId) {
      body.userThemeId = opts.userThemeId
      delete body.templateName
    }
  }

  console.log('[submagic] create project body:', JSON.stringify({
    ...body,
    videoUrl: typeof body.videoUrl === 'string' ? `${body.videoUrl.slice(0, 120)}...` : body.videoUrl,
  }))

  const res = await fetch('https://api.submagic.co/v1/projects', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.SUBMAGIC_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Submagic job failed: ${err}`)
  }

  const data = await res.json()
  return data.id as string
}

// ── Submagic   Poll job status ────────────────────────────────────────────────

export async function pollSubmagicJob(projectId: string): Promise<{
  status: 'processing' | 'ready' | 'failed'
  previewUrl: string | null
  downloadUrl: string | null
  error: string | null
}> {
  const res = await fetch(`https://api.submagic.co/v1/projects/${projectId}`, {
    headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
  })

  if (!res.ok) return { status: 'failed', previewUrl: null, downloadUrl: null, error: 'Poll failed' }

  const data = await res.json()

  if (data.transcriptionStatus === 'FAILED') {
    return { status: 'failed', previewUrl: null, downloadUrl: null, error: data.failureReason ?? 'Transcription failed' }
  }

  // A project can report completed with no rendered file yet (e.g. transcription
  // finished but the export hasn't produced a video). Only a completed status
  // WITH a download URL is truly ready.
  const hasFile = Boolean(data.videoUrl ?? data.downloadUrl ?? data.directUrl)
  const done = (data.status === 'done' || data.status === 'completed') && hasFile
  const processing = !done && data.status !== 'failed'

  return {
    status: done ? 'ready' : processing ? 'processing' : 'failed',
    previewUrl: data.previewUrl ?? null,
    downloadUrl: data.videoUrl ?? data.downloadUrl ?? data.directUrl ?? null,
    error: done || processing ? null : (data.failureReason ?? 'Unknown error'),
  }
}

// ── Google Drive   Verify file is accessible before processing ────────────────

// Validates the Drive share URL has a file ID. No HTTP fetch   Submagic downloads the file itself.
export function verifyDriveFile(directUrl: string): { ok: boolean; resolvedUrl: string; error?: string } {
  const fileId = directUrl.match(/[?&]id=([^&]+)/)?.[1]
  if (!fileId) {
    return { ok: false, resolvedUrl: directUrl, error: 'Could not parse a file ID from the Google Drive URL.' }
  }
  // Use the confirm=t variant so large files bypass the virus-scan warning page on Submagic's end
  const resolvedUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`
  return { ok: true, resolvedUrl }
}
