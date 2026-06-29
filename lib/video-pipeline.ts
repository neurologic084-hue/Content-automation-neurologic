import FormData from 'form-data'
import { chatCompletion, MODELS } from './openrouter'

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
  descriptBroll?: boolean      // ask Underlord to insert stock B-roll
  descriptCaptions?: boolean   // ask Underlord to add captions
  nativeCaptions?: boolean     // burn ASS karaoke captions via ElevenLabs Scribe + FFmpeg
  captionTestOnly?: boolean    // skip Descript + smart-cut entirely, caption the raw footage directly
  motionGraphics?: boolean     // plan + render front-loaded brand graphics (Remotion) and composite them in
  motionGraphicsStyle?: 'minimal' | 'bold'  // which Remotion visual treatment to render
  submagicCutOnly?: boolean        // skip Descript; Submagic handles cut/clean/captions/B-roll instead
  submagicMagicBrolls?: boolean    // Submagic's own stock B-roll, used by the submagicCutOnly path
  submagicMagicZooms?: boolean     // Submagic's own zoom-ins, used by the submagicCutOnly path
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

export interface VideoJob {
  id: string
  script_id: string
  source_drive_url: string
  broll_drive_url: string | null
  status: 'processing' | 'complete' | 'failed'
  variants: VideoVariant[] | null
  selected_variant: string | null
  transcript: string | null
  created_at: string
}

export const VARIANT_DEFINITIONS: VideoVariantDef[] = [
  {
    id: 'our-v1',
    name: 'Submagic Calm & Clean',
    description: 'Gentle pacing, light B-roll, no music — voice carries the video alone. Best for sensitive, personal, or educational content.',
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
    name: 'Submagic Balanced Energy',
    description: 'Natural-to-brisk pacing, moderate B-roll, subtle background music. A balanced general-purpose edit.',
    tool: 'submagic',
    order: 2,
    autoStart: false,
    submagicProfile: {
      directive: 'Balanced, natural energy suited to general short-form content. Moderate B-roll coverage, natural-to-brisk pacing, noticeable but not aggressive zooms. Subtle background music sits quietly under the voice.',
      useMusic: true,
    },
  },
  {
    id: 'our-v3',
    name: 'Submagic Bold & Punchy',
    description: 'Fast cuts, heavier B-roll, strong zooms, energetic music. For punchy, attention-grabbing content.',
    tool: 'submagic',
    order: 3,
    autoStart: false,
    submagicProfile: {
      directive: 'High energy, fast-paced, attention-grabbing edit. Heavier B-roll coverage, tight cuts, strong confident zooms, a bold hook title. Energetic background music under the voice.',
      useMusic: true,
    },
  },
  {
    id: 'our-v4',
    name: 'Premium Captions + Motion Graphics A',
    description: 'Submagic cuts, cleans, captions, and adds B-roll (a premium template, never Hormozi-style, zooms off for a calmer feel) — then front-loaded Neuro Logic motion graphics (intro, callouts, stats) render on top in the minimal house style.',
    tool: 'edit',
    order: 4,
    autoStart: false,
    submagicCutOnly: true,
    submagicMagicBrolls: true,
    submagicMagicZooms: false,
    motionGraphics: true,
    motionGraphicsStyle: 'minimal',
  },
  {
    id: 'our-v5',
    name: 'Premium Captions + Motion Graphics B',
    description: 'Same recipe as variant A — Submagic cuts, cleans, captions, and adds B-roll with a second premium template — but zooms on for extra energy, paired with the bolder, punchier motion-graphics style.',
    tool: 'edit',
    order: 5,
    autoStart: false,
    submagicCutOnly: true,
    submagicMagicBrolls: true,
    submagicMagicZooms: true,
    motionGraphics: true,
    motionGraphicsStyle: 'bold',
  },
]

// Generates 2 Submagic variants with AI-named styles tailored to the script mood
// Names describe the feel/energy, not the underlying template
export async function generateSubmagicVariants(
  script: { hook: string; body: string; cta: string; mood_tag: string | null }
): Promise<VideoVariantDef[]> {
  const prompt = [
    'You are naming two short-form video editing styles for this script.',
    '',
    'Hook: ' + (script.hook || ''),
    'Mood: ' + (script.mood_tag || 'unspecified'),
    '',
    'Generate exactly 2 distinct editing style names that suit this script.',
    'Rules:',
    '- Each name is 2-4 words, style/energy focused (e.g. "Bold & Direct", "Warm & Cinematic", "Clean & Fast", "Sharp & Minimal")',
    '- Each description is one short sentence about how it will feel to watch',
    '- Make them genuinely different from each other in energy and tone',
    '- Do NOT use template names (kelly, ella, etc.)',
    '',
    'Return JSON only: {"styles":[{"name":"...","description":"..."},{"name":"...","description":"..."}]}',
  ].join('\n')

  const FALLBACKS = [
    { name: 'Bold & Direct', description: 'Fast cuts, strong captions, high energy.' },
    { name: 'Clean & Cinematic', description: 'Smooth pace, polished captions, premium feel.' },
  ]

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    })
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const data = JSON.parse(cleaned) as { styles: { name: string; description: string }[] }
    const styles = data.styles?.slice(0, 2) ?? []
    if (styles.length < 2) throw new Error('not enough styles')

    return [
      { id: 'submagic-a', name: styles[0].name, description: styles[0].description, tool: 'submagic', order: 4, autoStart: false, submagicPreset: { aiEditTemplate: 'kelly' } },
      { id: 'submagic-b', name: styles[1].name, description: styles[1].description, tool: 'submagic', order: 5, autoStart: false, submagicPreset: { aiEditTemplate: 'ella' } },
    ]
  } catch {
    return [
      { id: 'submagic-a', name: FALLBACKS[0].name, description: FALLBACKS[0].description, tool: 'submagic', order: 4, autoStart: false, submagicPreset: { aiEditTemplate: 'kelly' } },
      { id: 'submagic-b', name: FALLBACKS[1].name, description: FALLBACKS[1].description, tool: 'submagic', order: 5, autoStart: false, submagicPreset: { aiEditTemplate: 'ella' } },
    ]
  }
}

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

// ── Submagic   Fetch first available audio track for music param ──────────────

export async function fetchSubmagicAudioTrack(): Promise<string | null> {
  try {
    const res = await fetch('https://api.submagic.co/v1/user-media?type=AUDIO&limit=20', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[submagic] audio media lookup failed (${res.status}): ${text.slice(0, 250)}`)
      return null
    }
    const data = JSON.parse(text)
    const items = Array.isArray(data.items) ? data.items : []
    const calm = items.find((item: { id?: string; name?: string; title?: string }) =>
      /calm|soft|lofi|ambient|chill|minimal|subtle|warm/i.test(`${item.name ?? ''} ${item.title ?? ''}`)
    )
    const picked = calm ?? items[0]
    if (picked?.id) console.log(`[submagic] selected audio media: ${picked.name ?? picked.title ?? picked.id}`)
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

  const done = data.status === 'done' || data.status === 'completed'
  const processing = !done && data.status !== 'failed'

  return {
    status: done ? 'ready' : processing ? 'processing' : 'failed',
    previewUrl: data.previewUrl ?? null,
    downloadUrl: data.videoUrl ?? data.downloadUrl ?? null,
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
