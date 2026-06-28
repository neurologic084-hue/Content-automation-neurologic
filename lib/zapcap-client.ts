import fs from 'fs'
import { chatCompletion, MODELS } from './openrouter'

const BASE = 'https://api.zapcap.ai'

export type ZapcapTemplateIndex = 1 | 2 | 3
export type ZapcapSmartProfile = 'balanced' | 'punchy' | 'bold' | 'warm' | 'minimal'

interface ZapcapRenderOptions {
  subsOptions?: {
    emoji?: boolean
    emojiAnimation?: boolean
    emphasizeKeywords?: boolean
    animation?: boolean
    punctuation?: boolean
    displayWords?: number
  }
  styleOptions?: {
    top?: number
    fontUppercase?: boolean
    fontShadow?: 'none' | 's' | 'm' | 'l'
    fontSize?: number
    fontWeight?: number
    fontColor?: string
    stroke?: 'none' | 's' | 'm' | 'l'
    strokeColor?: string
  }
  highlightOptions?: {
    randomColourOne?: string
    randomColourTwo?: string
    randomColourThree?: string
  }
}

interface ZapcapSmartSettings {
  brollPercent: number
  autoCut: {
    silenceRemoval: number
    disfluencyRemoval: boolean
  }
  renderOptions: ZapcapRenderOptions
  dictionary: string[]
}

export interface ZapcapProcessOptions {
  templateIndex?: ZapcapTemplateIndex
  brollPercent?: number
  autoCut?: {
    silenceRemoval?: number
    disfluencyRemoval?: boolean
  }
  renderOptions?: ZapcapRenderOptions
  dictionary?: string[]
  smart?: {
    profile: ZapcapSmartProfile
    hook?: string
    cta?: string
    moodTag?: string | null
    scriptFormat?: string
  }
}

function apiKey(): string {
  const k = process.env.ZAPCAP_API_KEY
  if (!k) throw new Error('Missing ZAPCAP_API_KEY in environment')
  return k
}

async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(`[zapcap] ${label} attempt ${attempt}/${attempts}`)
      return await fetch(url, init)
    } catch (e) {
      lastError = e
      const message = e instanceof Error ? e.message : String(e)
      console.warn(`[zapcap] ${label} attempt ${attempt}/${attempts} failed: ${message}`)
      if (attempt < attempts) await new Promise(r => setTimeout(r, attempt * 1500))
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`${label} failed after ${attempts} attempts: ${message}`)
}

async function req(method: string, endpoint: string, body?: unknown, timeoutMs = 30_000) {
  console.log(`[zapcap] ${method} ${endpoint}`, body ? JSON.stringify(body).slice(0, 200) : '')
  const res = await fetchWithRetry(`${BASE}${endpoint}`, {
    method,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  }, `ZapCap ${method} ${endpoint}`)
  const text = await res.text().catch(() => '')
  console.log(`[zapcap] ${res.status} ← ${method} ${endpoint}:`, text.slice(0, 400))
  if (!res.ok) throw new Error(`ZapCap ${method} ${endpoint} → ${res.status}: ${text.slice(0, 400)}`)
  if (res.status === 204) return null
  try { return JSON.parse(text) } catch {
    throw new Error(`ZapCap ${method} ${endpoint} non-JSON: ${text.slice(0, 200)}`)
  }
}

async function uploadFromUrl(videoUrl: string): Promise<string> {
  let host = 'unknown'
  try { host = new URL(videoUrl).host } catch { /* best-effort */ }
  console.log(`[zapcap] importing video by URL host=${host} url=${videoUrl.slice(0, 180)}`)
  const res = await req('POST', '/videos/url', { url: videoUrl }, 180_000)
  const videoId = res?.id
  if (!videoId) throw new Error(`ZapCap upload returned no id: ${JSON.stringify(res).slice(0, 200)}`)
  console.log(`[zapcap] uploaded via URL, videoId: ${videoId}`)
  return videoId as string
}

export async function uploadFile(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath)
  const blob = new Blob([fileBuffer], { type: 'video/mp4' })
  const form = new globalThis.FormData()
  form.append('file', blob, 'video.mp4')

  console.log(`[zapcap] uploading file ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB...`)
  const res = await fetchWithRetry(`${BASE}/videos`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey() },
    body: form,
    signal: AbortSignal.timeout(600_000),
  }, 'ZapCap file upload')
  const text = await res.text().catch(() => '')
  console.log(`[zapcap] ${res.status} ← POST /videos:`, text.slice(0, 400))
  if (!res.ok) throw new Error(`ZapCap file upload failed: ${res.status}: ${text.slice(0, 400)}`)
  const data = JSON.parse(text)
  const videoId = data?.id
  if (!videoId) throw new Error(`ZapCap file upload returned no id: ${JSON.stringify(data).slice(0, 200)}`)
  console.log(`[zapcap] uploaded file, videoId: ${videoId}`)
  return videoId as string
}

async function getTemplateId(templateIndex: ZapcapTemplateIndex = 1): Promise<string> {
  const envKey = templateIndex === 1 ? 'ZAPCAP_TEMPLATE_ID' : `ZAPCAP_TEMPLATE_ID_${templateIndex}`
  const configured = process.env[envKey]
  if (configured) return configured

  const templates = await req('GET', '/templates')
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error(`ZapCap returned no templates. Set ${envKey} in .env.local to lock in your preferred style.`)
  }

  console.log(`[zapcap] available templates:`)
  for (const t of templates) console.log(`  ${t.id}  ${t.name ?? ''}`)

  // Auto-pick: prefer bold/karaoke styles that sit in the lower third (not dead-center on the face).
  // Index 1/2/3 pick different preferred templates when explicit env vars are not set.
  const PREFERRED = /bold|viral|karaoke|word.by.word|highlight|neon|fire|pop|dynamic|animated|lower|bottom|safe/i
  const sorted = [...templates].sort((a, b) => {
    const aScore = PREFERRED.test(a.name ?? '') ? 0 : 1
    const bScore = PREFERRED.test(b.name ?? '') ? 0 : 1
    return aScore - bScore
  })
  const picked = (sorted[templateIndex - 1] ?? sorted[0])
  console.log(`[zapcap] auto-picked template (index ${templateIndex}): ${picked.id} "${picked.name ?? ''}"`)
  console.log(`[zapcap] to lock this in: set ${envKey}=${picked.id} in .env.local`)
  return picked.id as string
}

async function createTask(
  videoId: string,
  templateId: string,
  options: ZapcapProcessOptions = {},
  extra: { autoApprove?: boolean; transcriptTaskId?: string } = {},
): Promise<string> {
  const { brollPercent, autoCut, renderOptions, dictionary } = options
  const body: Record<string, unknown> = {
    templateId,
    language: 'en',
    autoApprove: extra.autoApprove ?? true,
  }
  if (extra.transcriptTaskId) body.transcriptTaskId = extra.transcriptTaskId
  if (brollPercent !== undefined) {
    body.transcribeSettings = { broll: { brollPercent } }
    console.log(`[zapcap] B-roll enabled at ${brollPercent}%`)
  }
  if (autoCut) {
    body.autoCutSettings = {
      ...(autoCut.silenceRemoval !== undefined ? { silenceRemoval: autoCut.silenceRemoval } : {}),
      ...(autoCut.disfluencyRemoval !== undefined ? { disfluencyRemoval: autoCut.disfluencyRemoval } : {}),
    }
    console.log('[zapcap] auto-cut enabled', JSON.stringify(body.autoCutSettings))
  }
  if (renderOptions) body.renderOptions = renderOptions
  if (dictionary?.length) body.dictionary = dictionary
  const res = await req('POST', `/videos/${videoId}/task`, body)
  const taskId = res?.taskId
  if (!taskId) throw new Error(`ZapCap task creation returned no taskId: ${JSON.stringify(res).slice(0, 200)}`)
  console.log(`[zapcap] task created: ${taskId}`)
  return taskId as string
}

interface ZapcapWordEntry {
  text: string
  type: string
  start_time: number
  end_time: number
  confidence?: number
}

async function getTranscript(videoId: string, taskId: string): Promise<ZapcapWordEntry[]> {
  const transcript = await req('GET', `/videos/${videoId}/task/${taskId}/transcript`)
  return Array.isArray(transcript) ? transcript as ZapcapWordEntry[] : []
}

async function createTranscriptTask(videoId: string, templateId: string): Promise<string> {
  const taskId = await createTask(videoId, templateId, {}, { autoApprove: false })
  console.log(`[zapcap] transcript task created: ${taskId}`)
  return taskId
}

async function pollTranscriptTask(
  videoId: string,
  taskId: string,
  intervalMs = 6_000,
  maxAttempts = 60,
): Promise<ZapcapWordEntry[]> {
  console.log(`[zapcap] polling transcript task ${taskId}...`)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const res = await req('GET', `/videos/${videoId}/task/${taskId}`)
    const status = res?.status as string
    console.log(`[zapcap] transcript task ${taskId} status: ${status} (attempt ${i + 1}/${maxAttempts})`)
    if (status === 'failed') throw new Error(`ZapCap transcript task ${taskId} failed: ${res?.error ?? ''}`)
    if (status === 'transcriptionCompleted' || status === 'completed') {
      const words = await getTranscript(videoId, taskId)
      if (!words.length) throw new Error('ZapCap transcript completed but returned no words')
      return words
    }
  }
  throw new Error(`ZapCap transcript task timed out after ${(maxAttempts * intervalMs / 60000).toFixed(0)} min`)
}

function transcriptText(words: ZapcapWordEntry[]): string {
  return words
    .filter(w => w.type === 'word' && w.text)
    .map(w => w.text)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, x))
}

function profileDefaults(profile: ZapcapSmartProfile) {
  switch (profile) {
    case 'punchy':
      return {
        broll: 16, brollMax: 20, silence: 0.34, displayWords: 2,
        emoji: true, uppercase: true, top: 70, fontSize: 48, fontWeight: 900,
        colours: ['#FF4F17', '#FDE047', '#22C55E'],
      }
    case 'bold':
      return {
        broll: 13, brollMax: 18, silence: 0.3, displayWords: 2,
        emoji: false, uppercase: true, top: 69, fontSize: 50, fontWeight: 900,
        colours: ['#F97316', '#FFFFFF', '#111827'],
      }
    case 'warm':
      return {
        broll: 8, brollMax: 12, silence: 0.48, displayWords: 4,
        emoji: false, uppercase: false, top: 68, fontSize: 42, fontWeight: 800,
        colours: ['#F59E0B', '#FDE68A', '#FFFFFF'],
      }
    case 'minimal':
      return {
        broll: 6, brollMax: 10, silence: 0.5, displayWords: 5,
        emoji: false, uppercase: false, top: 68, fontSize: 38, fontWeight: 750,
        colours: ['#FFFFFF', '#D1D5DB', '#A3E635'],
      }
    case 'balanced':
    default:
      return {
        broll: 11, brollMax: 15, silence: 0.42, displayWords: 3,
        emoji: false, uppercase: false, top: 69, fontSize: 44, fontWeight: 850,
        colours: ['#FF4F17', '#FDE047', '#22C55E'],
      }
  }
}

function normalizeSmartSettings(raw: Partial<ZapcapSmartSettings>, profile: ZapcapSmartProfile): ZapcapSmartSettings {
  const defaults = profileDefaults(profile)
  return {
    brollPercent: Math.round(clamp(raw.brollPercent, 5, defaults.brollMax, defaults.broll)),
    autoCut: {
      silenceRemoval: clamp(raw.autoCut?.silenceRemoval, 0.22, 0.52, defaults.silence),
      disfluencyRemoval: raw.autoCut?.disfluencyRemoval ?? true,
    },
    renderOptions: {
      subsOptions: {
        emoji: raw.renderOptions?.subsOptions?.emoji ?? defaults.emoji,
        emojiAnimation: raw.renderOptions?.subsOptions?.emojiAnimation ?? defaults.emoji,
        emphasizeKeywords: raw.renderOptions?.subsOptions?.emphasizeKeywords ?? true,
        animation: raw.renderOptions?.subsOptions?.animation ?? true,
        punctuation: raw.renderOptions?.subsOptions?.punctuation ?? true,
        displayWords: Math.round(clamp(raw.renderOptions?.subsOptions?.displayWords, 2, 5, defaults.displayWords)),
      },
      styleOptions: {
        // ZapCap top is a Y percentage; higher values sit lower. Keep it in the lower third:
        // below the face/center area, but above the mobile UI danger zone.
        top: clamp(raw.renderOptions?.styleOptions?.top, 68, 72, defaults.top),
        fontUppercase: raw.renderOptions?.styleOptions?.fontUppercase ?? defaults.uppercase,
        fontShadow: raw.renderOptions?.styleOptions?.fontShadow ?? 'm',
        fontSize: Math.round(clamp(raw.renderOptions?.styleOptions?.fontSize, 34, 52, defaults.fontSize)),
        fontWeight: Math.round(clamp(raw.renderOptions?.styleOptions?.fontWeight, 700, 900, defaults.fontWeight)),
        fontColor: raw.renderOptions?.styleOptions?.fontColor ?? '#ffffff',
        stroke: raw.renderOptions?.styleOptions?.stroke ?? 'm',
        strokeColor: raw.renderOptions?.styleOptions?.strokeColor ?? '#000000',
      },
      highlightOptions: {
        randomColourOne: raw.renderOptions?.highlightOptions?.randomColourOne ?? defaults.colours[0],
        randomColourTwo: raw.renderOptions?.highlightOptions?.randomColourTwo ?? defaults.colours[1],
        randomColourThree: raw.renderOptions?.highlightOptions?.randomColourThree ?? defaults.colours[2],
      },
    },
    dictionary: Array.isArray(raw.dictionary)
      ? raw.dictionary.filter(Boolean).slice(0, 20)
      : [],
  }
}

async function deriveSmartSettings(
  words: ZapcapWordEntry[],
  smart: NonNullable<ZapcapProcessOptions['smart']>,
): Promise<ZapcapSmartSettings> {
  const text = transcriptText(words)
  const duration = words.length ? Math.max(...words.map(w => w.end_time ?? 0)) : 0
  const fallback = normalizeSmartSettings({}, smart.profile)

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.25,
      max_tokens: 700,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'Choose ZapCap API render settings for a short-form talking-head video.',
          `Profile: ${smart.profile}`,
          `Mood: ${smart.moodTag ?? 'unspecified'}`,
          `Format: ${smart.scriptFormat ?? 'unspecified'}`,
          `Hook: ${smart.hook ?? ''}`,
          `CTA: ${smart.cta ?? ''}`,
          `Duration seconds: ${duration.toFixed(1)}`,
          '',
          'Rules:',
          '- Keep B-roll conservative. Do not cover too much of the speaker.',
          '- Use lower brollPercent for emotional/medical/personal content, slightly higher for educational/list-style content.',
          '- silenceRemoval is 0-1. Lower is more aggressive. Use 0.22-0.52 only.',
          '- Use disfluencyRemoval unless the transcript is very conversational and fillers are part of the meaning.',
          '- Captions should be readable on vertical shortform video.',
          '- styleOptions.top must stay between 68 and 72. Higher is lower; keep captions in the lower third, below the face/center area but not near/below the bottom.',
          '- styleOptions.fontSize must stay between 34 and 52. Prefer smaller text when the speaker face is likely centered.',
          '- displayWords must be 2-5. Never show more than 5 words per caption page.',
          '- Return JSON only with this shape:',
          '{"brollPercent": number, "autoCut": {"silenceRemoval": number, "disfluencyRemoval": boolean}, "renderOptions": {"subsOptions": {"emoji": boolean, "emojiAnimation": boolean, "emphasizeKeywords": boolean, "animation": boolean, "punctuation": boolean, "displayWords": number}, "styleOptions": {"top": number, "fontUppercase": boolean, "fontShadow": "none|s|m|l", "fontSize": number, "fontWeight": number, "fontColor": "#ffffff", "stroke": "none|s|m|l", "strokeColor": "#000000"}, "highlightOptions": {"randomColourOne": "#hex", "randomColourTwo": "#hex", "randomColourThree": "#hex"}}, "dictionary": ["brand/name terms"]}',
          '',
          `Transcript:\n${text.slice(0, 5000)}`,
        ].join('\n'),
      }],
    })
    const parsed = JSON.parse(raw) as Partial<ZapcapSmartSettings>
    const settings = normalizeSmartSettings(parsed, smart.profile)
    console.log('[zapcap] AI smart settings:', JSON.stringify(settings).slice(0, 600))
    return settings
  } catch (e) {
    console.warn('[zapcap] smart settings failed, using fallback:', (e as Error).message)
    return fallback
  }
}

async function pollTask(
  videoId: string,
  taskId: string,
  intervalMs = 6_000,
  maxAttempts = 100,
): Promise<string> {
  console.log(`[zapcap] polling task ${taskId}...`)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const res = await req('GET', `/videos/${videoId}/task/${taskId}`)
    const status = res?.status as string
    console.log(`[zapcap] task ${taskId} status: ${status} (attempt ${i + 1}/${maxAttempts})`)
    if (status === 'failed') throw new Error(`ZapCap task ${taskId} failed`)
    if (status === 'completed') {
      const url = res?.downloadUrl as string
      if (!url) throw new Error('ZapCap completed but no downloadUrl in response')
      console.log(`[zapcap] done: ${url}`)
      return url
    }
  }
  throw new Error(`ZapCap task timed out after ${(maxAttempts * intervalMs / 60000).toFixed(0)} min`)
}

// Full pipeline: upload (URL or local file path) → pick template → create task → poll → return download URL.
export async function processWithZapcap(
  videoInput: string,  // http(s):// URL or local file path
  templateIndexOrOptions: ZapcapTemplateIndex | ZapcapProcessOptions = 1,
  brollPercent?: number,
): Promise<string> {
  const options: ZapcapProcessOptions = typeof templateIndexOrOptions === 'number'
    ? { templateIndex: templateIndexOrOptions, brollPercent }
    : templateIndexOrOptions
  const videoId = videoInput.startsWith('http')
    ? await uploadFromUrl(videoInput)
    : await uploadFile(videoInput)
  const templateId = await getTemplateId(options.templateIndex ?? 1)
  if (options.smart) {
    const transcriptTaskId = await createTranscriptTask(videoId, templateId)
    const words = await pollTranscriptTask(videoId, transcriptTaskId)
    const settings = await deriveSmartSettings(words, options.smart)
    const taskId = await createTask(
      videoId,
      templateId,
      {
        ...options,
        brollPercent: settings.brollPercent,
        autoCut: settings.autoCut,
        renderOptions: settings.renderOptions,
        dictionary: settings.dictionary,
      },
      { autoApprove: true, transcriptTaskId },
    )
    return await pollTask(videoId, taskId)
  }

  const taskId = await createTask(videoId, templateId, options)
  return await pollTask(videoId, taskId)
}
