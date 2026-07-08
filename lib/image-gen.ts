// ── AI image generation via kie.ai (Nano Banana) ──────────────────────────────
// Text-to-image for the collage scenes (lib/collage-scenes.ts): createTask →
// poll recordInfo → download. Subjects are generated on a solid chroma-green
// background so a plain ffmpeg chromakey turns them into transparent cutouts —
// no matting model needed. Everything here is best-effort: a failed generation
// returns false and the caller degrades (scene drops, stock B-roll fills in).
//
// Requires KIE_AI_API_KEY in the environment. Paid per image — the collage
// planner caps scenes/cutouts so one render stays at a handful of generations.

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { ensureFfmpegOnPath } from './ffmpeg-env'

const KIE_BASE = 'https://api.kie.ai/api/v1/jobs'
const MODEL = process.env.KIE_IMAGE_MODEL || 'nano-banana-pro'
const POLL_INTERVAL_MS = 4_000
const POLL_TIMEOUT_MS = 240_000

// The keying green. Baked into both the generation prompt and the chromakey
// filter so they can never drift apart.
export const CHROMA_GREEN = '#00FF00'

export function hasImageGenKey(): boolean {
  return !!process.env.KIE_AI_API_KEY
}

function apiKey(): string {
  const key = process.env.KIE_AI_API_KEY
  if (!key) throw new Error('KIE_AI_API_KEY not set')
  return key
}

async function createTask(prompt: string, aspectRatio: string, resolution: string): Promise<string> {
  const res = await fetch(`${KIE_BASE}/createTask`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      input: { prompt, aspect_ratio: aspectRatio, resolution, output_format: 'png' },
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`kie.ai createTask failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const payload = await res.json()
  const taskId = payload?.data?.taskId
  if (!taskId) throw new Error(`kie.ai createTask returned no taskId: ${JSON.stringify(payload).slice(0, 300)}`)
  return taskId
}

async function pollTask(taskId: string): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(`${KIE_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) continue
    const data = (await res.json())?.data ?? {}
    if (data.state === 'success') {
      const raw = data.resultJson
      const result = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw ?? {})
      const url = result?.resultUrls?.[0]
      if (!url) throw new Error('kie.ai task succeeded but returned no result URL')
      return url
    }
    if (data.state === 'fail') {
      throw new Error(`kie.ai task failed: ${data.failMsg || data.failCode || 'unknown error'}`)
    }
  }
  throw new Error(`kie.ai task timed out after ${POLL_TIMEOUT_MS / 1000}s`)
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OlympusEditor/1.0' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`image download failed: HTTP ${res.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  if (fs.statSync(dest).size < 5_000) throw new Error('downloaded image is suspiciously small')
}

// Generate one image to `dest`. Returns false (never throws) on any failure so
// callers can degrade instead of failing the render.
export async function generateImage(
  prompt: string,
  dest: string,
  opts: { aspectRatio?: string; resolution?: '1K' | '2K' | '4K' } = {},
): Promise<boolean> {
  try {
    const taskId = await createTask(prompt, opts.aspectRatio ?? '3:4', opts.resolution ?? '1K')
    const url = await pollTask(taskId)
    await download(url, dest)
    return true
  } catch (e) {
    console.warn(`[image-gen] generation failed for "${prompt.slice(0, 60)}...":`, (e as Error).message)
    return false
  }
}

// Key the chroma-green background out of a generated PNG, leaving a
// transparent cutout. despill removes the green fringe the key leaves on
// edges. Returns false on failure (the caller drops that cutout).
export async function keyGreenscreen(src: string, dest: string): Promise<boolean> {
  ensureFfmpegOnPath()
  const hex = CHROMA_GREEN.replace('#', '0x')
  const cmd =
    `ffmpeg -y -i "${src}" ` +
    `-vf "chromakey=${hex}:0.22:0.08,despill=type=green,format=rgba" ` +
    `-frames:v 1 "${dest}"`
  try {
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) =>
        err ? reject(new Error(String(stderr).slice(-400) || err.message)) : resolve())
    })
    return fs.existsSync(dest) && fs.statSync(dest).size > 5_000
  } catch (e) {
    console.warn('[image-gen] chromakey failed:', (e as Error).message)
    return false
  }
}
