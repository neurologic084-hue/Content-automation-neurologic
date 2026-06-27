import FormData from 'form-data'
import { chatCompletion, MODELS } from './openrouter'

export interface SubmagicPreset {
  // Fully autonomous mode   Submagic handles everything (music, B-roll, cuts, style)
  aiEditTemplate?: 'kelly' | 'karl' | 'ella'
  // Manual mode fields   only used when aiEditTemplate is not set
  template?: string
  broll?: boolean
  brollPct?: number   // 0-100, how much of the video to fill with B-roll
  zoom?: boolean
  hookTitle?: boolean
  silencePace?: 'natural' | 'fast' | 'extra-fast'
  badTakes?: boolean
  music?: boolean     // true = use audio track from Submagic library if available
}

export interface VideoVariantDef {
  id: string
  name: string
  description: string
  tool: 'submagic' | 'hyperframe'
  order: number
  autoStart: boolean   // true = runs immediately on job creation; false = user starts manually
  submagicPreset?: SubmagicPreset
  zapcapTemplateIndex?: 1 | 2  // 1 = ZAPCAP_TEMPLATE_ID, 2 = ZAPCAP_TEMPLATE_ID_2
  zapcapBrollPercent?: number  // 0-100, enables ZapCap auto B-roll
  descriptBroll?: boolean      // ask Underlord to insert stock B-roll
  descriptCaptions?: boolean   // ask Underlord to add captions
}

export interface VideoVariant extends VideoVariantDef {
  status: 'pending' | 'processing' | 'ready' | 'failed'
  external_id: string | null  // Submagic project ID when tool === 'submagic'
  preview_url: string | null
  download_url: string | null
  duration_seconds: number | null
  error: string | null
  progress?: { step: number; total: number; label: string } | null
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
    name: 'Descript Full',
    description: 'Descript handles everything   cuts, Studio Sound, B-roll, and captions.',
    tool: 'hyperframe',
    order: 1,
    autoStart: false,
    descriptBroll: true,
    descriptCaptions: true,
  },
  {
    id: 'our-v2',
    name: 'ZapCap Captions + B-roll',
    description: 'Descript cuts only, then ZapCap adds captions and auto B-roll.',
    tool: 'hyperframe',
    order: 2,
    autoStart: false,
    zapcapTemplateIndex: 1,
    zapcapBrollPercent: 10,
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


// ── Submagic   Fetch first available audio track for music param ──────────────

export async function fetchSubmagicAudioTrack(): Promise<string | null> {
  try {
    const res = await fetch('https://api.submagic.co/v1/user-media?type=AUDIO&limit=1', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.items?.[0]?.id ?? null
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
