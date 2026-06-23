import FormData from 'form-data'

export interface SubmagicPreset {
  template: string
  broll: boolean
  zoom: boolean
  hookTitle: boolean
  silencePace: 'natural' | 'fast' | 'extra-fast'
  badTakes: boolean
}

export interface VideoVariantDef {
  id: string
  name: string
  description: string
  tool: 'submagic' | 'hyperframe'
  order: number
  submagicPreset?: SubmagicPreset
}

export interface VideoVariant extends VideoVariantDef {
  status: 'pending' | 'processing' | 'ready' | 'failed'
  external_id: string | null  // Submagic project ID when tool === 'submagic'
  preview_url: string | null
  download_url: string | null
  duration_seconds: number | null
  error: string | null
}

export interface VideoJob {
  id: string
  script_id: string
  source_drive_url: string
  status: 'processing' | 'complete' | 'failed'
  variants: VideoVariant[] | null
  selected_variant: string | null
  transcript: string | null
  created_at: string
}

// 3 Submagic (full premium: B-roll + zoom + silences + captions) + 7 HyperFrames (motion, format)
export const VARIANT_DEFINITIONS: VideoVariantDef[] = [
  // ── Submagic — full-feature variants ────────────────────────────────────────
  {
    id: 'bold', name: 'Bold', tool: 'submagic', order: 1,
    description: 'Hormozi bold captions + AI B-roll + auto zoom + silence cuts',
    submagicPreset: { template: 'Hormozi 1', broll: true, zoom: true, hookTitle: true, silencePace: 'natural', badTakes: true },
  },
  {
    id: 'minimal', name: 'Minimal', tool: 'submagic', order: 2,
    description: 'Sara clean captions + auto zoom + silence cuts (no B-roll)',
    submagicPreset: { template: 'Sara', broll: false, zoom: true, hookTitle: false, silencePace: 'natural', badTakes: true },
  },
  {
    id: 'karaoke', name: 'Karaoke', tool: 'submagic', order: 3,
    description: 'Beast word-by-word highlight + AI B-roll + zoom + silence cuts',
    submagicPreset: { template: 'Beast', broll: true, zoom: true, hookTitle: true, silencePace: 'fast', badTakes: true },
  },
  // ── HyperFrames motion variants ──────────────────────────────────────────────
  { id: 'liquid-glass', name: 'Liquid Glass',      tool: 'hyperframe', order: 4,  description: 'iOS-style frosted glass cards synced to transcript' },
  { id: 'branded',      name: 'Branded',           tool: 'hyperframe', order: 5,  description: 'Clinic lower-third + brand orange overlay' },
  { id: 'broll-med',    name: 'B-Roll: Medical',   tool: 'hyperframe', order: 6,  description: 'Medical Pexels clips intercut + captions' },
  { id: 'broll-life',   name: 'B-Roll: Lifestyle', tool: 'hyperframe', order: 7,  description: 'Wellness Pexels clips intercut + captions' },
  { id: 'cinematic',    name: 'Cinematic',         tool: 'hyperframe', order: 8,  description: 'Dark vignette + desaturation + letterbox bars' },
  { id: 'format-916',   name: '9:16 Vertical',     tool: 'hyperframe', order: 9,  description: '1080x1920 for Reels and TikTok' },
  { id: 'format-11',    name: '1:1 Square',        tool: 'hyperframe', order: 10, description: '1080x1080 for feed posts' },
]

export function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? null
}

// ── ElevenLabs — Transcription ────────────────────────────────────────────────

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

// ── Submagic — Submit full-featured job ───────────────────────────────────────

export interface SubmagicJobOptions {
  templateName: string
  title: string
  // Premium features
  magicBrolls?: boolean          // AI auto B-roll insertion
  magicBrollsPercentage?: number // 0-100, how much of the video to fill with B-roll
  magicZooms?: boolean           // Auto punch-in zoom on key moments
  hookTitle?: boolean | { text?: string; template?: string; top?: number; size?: number }
  removeSilencePace?: 'natural' | 'fast' | 'extra-fast' // cut silences
  removeBadTakes?: boolean       // AI removes bad takes
  cleanAudio?: boolean           // background noise removal
}

export async function submitSubmagicJob(
  videoUrl: string,
  opts: SubmagicJobOptions
): Promise<string> {
  const body: Record<string, unknown> = {
    title: opts.title,
    language: 'en',
    videoUrl,
    templateName: opts.templateName,
    // Premium features — enabled per variant
    magicBrolls: opts.magicBrolls ?? false,
    magicZooms: opts.magicZooms ?? false,
    cleanAudio: opts.cleanAudio ?? true,
    removeSilencePace: opts.removeSilencePace ?? 'natural',
    removeBadTakes: opts.removeBadTakes ?? false,
  }

  if (opts.magicBrolls) body.magicBrollsPercentage = opts.magicBrollsPercentage ?? 40
  if (opts.hookTitle !== undefined) body.hookTitle = opts.hookTitle

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

// ── Submagic — Poll job status ────────────────────────────────────────────────

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

// ── Pexels — Fetch B-roll clips ───────────────────────────────────────────────

export async function fetchBrollClips(keywords: string, count = 5): Promise<string[]> {
  const query = encodeURIComponent(keywords)
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${query}&per_page=${count}&orientation=portrait`,
    { headers: { Authorization: process.env.PEXELS_API_KEY! } }
  )

  if (!res.ok) return []

  const data = await res.json()
  return (data.videos ?? []).map((v: { video_files: { link: string; width: number }[] }) => {
    const hd = v.video_files.find(f => f.width <= 1080) ?? v.video_files[0]
    return hd?.link ?? ''
  }).filter(Boolean)
}
