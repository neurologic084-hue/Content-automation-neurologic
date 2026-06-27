import fs from 'fs'
import os from 'os'
import path from 'path'

const BASE = 'https://descriptapi.com/v1'

function apiKey(): string {
  const k = process.env.DESCRIPT_API_KEY
  if (!k) throw new Error('Missing DESCRIPT_API_KEY in environment')
  return k
}

async function req(method: string, path: string, body?: unknown) {
  console.log(`[descript] ${method} ${path}`, body ? JSON.stringify(body).slice(0, 200) : '')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text().catch(() => '')
  console.log(`[descript] ${res.status} ← ${method} ${path}:`, text.slice(0, 500))
  if (!res.ok) throw new Error(`Descript ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`)
  if (res.status === 204) return null
  try { return JSON.parse(text) } catch {
    throw new Error(`Descript ${method} ${path} → non-JSON: ${text.slice(0, 200)}`)
  }
}

async function pollJob(jobId: string, intervalMs = 8_000, maxAttempts = 90) {
  console.log(`[descript] polling job ${jobId}...`)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const job = await req('GET', `/jobs/${jobId}`)
    console.log(`[descript] job ${jobId} state: ${job.job_state} (attempt ${i + 1}/${maxAttempts})`)
    if (job.job_state !== 'stopped') continue
    if (job.result?.status === 'failed' || job.result?.status === 'error') {
      throw new Error(`Descript job ${jobId} failed: ${JSON.stringify(job.result).slice(0, 300)}`)
    }
    console.log(`[descript] job ${jobId} done:`, JSON.stringify(job.result).slice(0, 300))
    return job
  }
  throw new Error(`Descript job ${jobId} timed out after ${(maxAttempts * intervalMs / 60000).toFixed(0)} minutes`)
}

// Download a Google Drive (or any) URL to a local temp file, following all redirects.
// Drive shows a virus-scan HTML warning for large files   we follow through it.
async function downloadToTemp(sourceUrl: string): Promise<{ filePath: string; fileSize: number }> {
  // Convert Drive share URL to direct download
  let url = sourceUrl
  const fileIdMatch = sourceUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
                      sourceUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (fileIdMatch && sourceUrl.includes('google.com')) {
    url = `https://drive.usercontent.google.com/download?id=${fileIdMatch[1]}&export=download&authuser=0&confirm=t`
  }

  console.log(`[descript] downloading source video from: ${url}`)
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`Failed to download source video: ${res.status}`)

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new Error(`Source URL returned HTML instead of video. URL may require authentication: ${url}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  const filePath = path.join(os.tmpdir(), `descript-src-${Date.now()}.mp4`)
  fs.writeFileSync(filePath, buffer)
  const fileSize = fs.statSync(filePath).size
  console.log(`[descript] downloaded ${(fileSize / 1024 / 1024).toFixed(1)} MB to ${filePath}`)
  return { filePath, fileSize }
}

// Upload a local file to Descript using their signed upload URL flow.
async function uploadFile(filePath: string, fileSize: number, projectName: string) {
  // Step 1: request a signed upload URL
  const res = await req('POST', '/jobs/import/project_media', {
    project_name: projectName,
    add_media: {
      'footage.mp4': { content_type: 'video/mp4', file_size: fileSize },
    },
    add_compositions: [{
      name: 'Main',
      clips: [{ media: 'footage.mp4' }],
    }],
  })

  const uploadUrl = res.upload_urls?.['footage.mp4']?.upload_url
  if (!uploadUrl) throw new Error(`Descript did not return an upload URL. Response: ${JSON.stringify(res).slice(0, 300)}`)

  // Step 2: PUT the file bytes to the signed URL
  console.log(`[descript] uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB to signed URL...`)
  const fileBytes = fs.readFileSync(filePath)
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileBytes,
    signal: AbortSignal.timeout(600_000),
  })
  if (!uploadRes.ok) {
    const t = await uploadRes.text().catch(() => '')
    throw new Error(`Descript signed upload failed: ${uploadRes.status} ${t.slice(0, 200)}`)
  }
  console.log(`[descript] upload complete`)

  // Step 3: poll for import job completion
  const job = await pollJob(res.job_id)
  const compositionId = job.result?.created_compositions?.[0]?.id
  if (!compositionId) throw new Error('Descript import returned no composition ID')
  return { projectId: res.project_id as string, compositionId: compositionId as string }
}

async function agentEdit(
  projectId: string,
  compositionId: string,
  opts: { broll?: boolean; captions?: boolean } = {},
) {
  const { broll = false, captions = false } = opts
  console.log(`[descript] agent edit project=${projectId} broll=${broll} captions=${captions}`)
  const extras = [
    broll ? 'Insert relevant stock B-roll footage covering 20-25% of the video total. Place it only at sentence endings, topic transitions, and moments where a visual would reinforce the message. Before every B-roll clip, use a short smooth cross-dissolve transition under 300 milliseconds   never cut directly from the speaker to B-roll without one. Fewer, well-placed clips are better than frequent ones   3 perfect placements beat 8 generic ones. Do not overlay B-roll while the speaker is mid-sentence.' : '',
    captions ? 'Add bold word-level captions styled for viral short-form video. Position captions in the lower center of the frame   around 65-70% down from the top   so they sit below the speaker\'s face without covering it. Never place captions in the dead center of the screen where they block the face. Show 2-4 words at a time in large, high-contrast text. Bold or enlarge the single most impactful word in each phrase   never bold full lines, only the key word. Match timing exactly word-by-word. Style like TikTok and Instagram Reels: punchy, readable at a glance, and energetic. Vary the emphasis and sizing throughout to match the speaker\'s intensity.' : '',
    !broll ? 'Do not add B-roll.' : '',
    !captions ? 'Do not add captions.' : '',
    'Do not add music.',
  ].filter(Boolean).join(' ')
  const res = await req('POST', '/jobs/agent', {
    project_id: projectId,
    composition_id: compositionId,
    prompt: 'Remove all filler words, cut silences longer than half a second, and remove all bad takes and false starts. When making each cut, always leave at least 100 milliseconds of audio before the next spoken word so the beginning of words are never clipped. Never cut the end of the video   after the last spoken word, hold the video for at least 300 milliseconds before ending so the video and audio finish together and there is no black screen while audio is still playing. Apply Studio Sound to enhance the audio and focus on the speaker\'s voice while removing background noise. ' + extras,
  })
  await pollJob(res.job_id)
}

// Publish the edited composition and return a direct download URL.
async function publish(projectId: string, compositionId: string): Promise<string> {
  console.log(`[descript] publishing project ${projectId}, composition ${compositionId}`)
  const res = await req('POST', '/jobs/publish', {
    project_id: projectId,
    composition_id: compositionId,
    media_type: 'Video',
    resolution: '1080p',
    access_level: 'unlisted',
  })

  const job = await pollJob(res.job_id)
  const url = job.result?.download_url
  if (!url) throw new Error(`Descript publish returned no download URL. Result: ${JSON.stringify(job.result).slice(0, 300)}`)
  return url as string
}

// Full pipeline: download source → upload → Underlord edit → publish → return download URL.
export async function processWithDescript(
  videoUrl: string,
  projectName: string,
  opts: { broll?: boolean; captions?: boolean } = {},
): Promise<string> {
  const { filePath, fileSize } = await downloadToTemp(videoUrl)
  try {
    const { projectId, compositionId } = await uploadFile(filePath, fileSize, projectName)
    await agentEdit(projectId, compositionId, opts)
    return await publish(projectId, compositionId)
  } finally {
    try { fs.unlinkSync(filePath) } catch { /* best-effort cleanup */ }
  }
}
