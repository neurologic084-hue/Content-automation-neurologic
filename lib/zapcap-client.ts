import fs from 'fs'

const BASE = 'https://api.zapcap.ai'

function apiKey(): string {
  const k = process.env.ZAPCAP_API_KEY
  if (!k) throw new Error('Missing ZAPCAP_API_KEY in environment')
  return k
}

async function req(method: string, endpoint: string, body?: unknown) {
  console.log(`[zapcap] ${method} ${endpoint}`, body ? JSON.stringify(body).slice(0, 200) : '')
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text().catch(() => '')
  console.log(`[zapcap] ${res.status} ← ${method} ${endpoint}:`, text.slice(0, 400))
  if (!res.ok) throw new Error(`ZapCap ${method} ${endpoint} → ${res.status}: ${text.slice(0, 400)}`)
  if (res.status === 204) return null
  try { return JSON.parse(text) } catch {
    throw new Error(`ZapCap ${method} ${endpoint} non-JSON: ${text.slice(0, 200)}`)
  }
}

async function uploadFromUrl(videoUrl: string): Promise<string> {
  const res = await req('POST', '/videos/url', { url: videoUrl })
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
  const res = await fetch(`${BASE}/videos`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey() },
    body: form,
    signal: AbortSignal.timeout(600_000),
  })
  const text = await res.text().catch(() => '')
  console.log(`[zapcap] ${res.status} ← POST /videos:`, text.slice(0, 400))
  if (!res.ok) throw new Error(`ZapCap file upload failed: ${res.status}: ${text.slice(0, 400)}`)
  const data = JSON.parse(text)
  const videoId = data?.id
  if (!videoId) throw new Error(`ZapCap file upload returned no id: ${JSON.stringify(data).slice(0, 200)}`)
  console.log(`[zapcap] uploaded file, videoId: ${videoId}`)
  return videoId as string
}

async function getTemplateId(templateIndex: 1 | 2 = 1): Promise<string> {
  const envKey = templateIndex === 2 ? 'ZAPCAP_TEMPLATE_ID_2' : 'ZAPCAP_TEMPLATE_ID'
  const configured = process.env[envKey]
  if (configured) return configured

  const templates = await req('GET', '/templates')
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error(`ZapCap returned no templates. Set ${envKey} in .env.local to lock in your preferred style.`)
  }

  console.log(`[zapcap] available templates:`)
  for (const t of templates) console.log(`  ${t.id}  ${t.name ?? ''}`)

  // Auto-pick: prefer bold/karaoke styles that sit in the lower third (not dead-center on the face).
  // Index 1 → best match, index 2 → second-best (so the two variants use different styles).
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

async function createTask(videoId: string, templateId: string, brollPercent?: number): Promise<string> {
  const body: Record<string, unknown> = {
    templateId,
    language: 'en',
    autoApprove: true,
  }
  if (brollPercent !== undefined) {
    body.transcribeSettings = { broll: { brollPercent } }
    console.log(`[zapcap] B-roll enabled at ${brollPercent}%`)
  }
  const res = await req('POST', `/videos/${videoId}/task`, body)
  const taskId = res?.taskId
  if (!taskId) throw new Error(`ZapCap task creation returned no taskId: ${JSON.stringify(res).slice(0, 200)}`)
  console.log(`[zapcap] task created: ${taskId}`)
  return taskId as string
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
  templateIndex: 1 | 2 = 1,
  brollPercent?: number,
): Promise<string> {
  const videoId = videoInput.startsWith('http')
    ? await uploadFromUrl(videoInput)
    : await uploadFile(videoInput)
  const templateId = await getTemplateId(templateIndex)
  const taskId = await createTask(videoId, templateId, brollPercent)
  return await pollTask(videoId, taskId)
}
