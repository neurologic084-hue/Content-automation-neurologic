import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createClient } from '@supabase/supabase-js'
import { tryUploadToStorage, storageFileName } from './storage'
import { chatCompletion, MODELS } from './openrouter'
import type { VideoVariant } from './video-pipeline'
import { submitSubmagicJob, pollSubmagicJob } from './video-pipeline'
import { processWithDescript } from './descript-client'
import { processWithZapcap } from './zapcap-client'

const active = new Set<string>()

// Cache Descript-edited URLs per job so multiple variants don't re-encode the same footage.
// Stores either a pending Promise (first variant is running Descript) or a resolved URL.
// Second variant arriving while the first is mid-run waits on the same Promise instead of
// starting a duplicate Descript job.
const descriptUrlCache = new Map<string, Promise<string> | { url: string; expiresAt: number }>()

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

function run(cmd: string, timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderrBuf = ''
    const proc = exec(cmd, { timeout: timeoutMs, maxBuffer: 512 * 1024 * 1024 }, (err) => {
      if (err) {
        const detail = stderrBuf.slice(-800).trim()
        reject(new Error(detail || err.message))
      } else {
        resolve()
      }
    })
    proc.stderr?.on('data', (d) => {
      const line = String(d)
      process.stdout.write(`[ffmpeg] ${line}`)
      stderrBuf += line
    })
  })
}

async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (_err, stdout) => resolve(parseFloat(stdout.trim()) || 60)
    )
  })
}

async function streamBodyToFile(body: ReadableStream<Uint8Array>, dest: string): Promise<void> {
  const file = fs.createWriteStream(dest)
  const reader = body.getReader()
  await new Promise<void>((resolve, reject) => {
    file.on('error', reject)
    file.on('finish', resolve)
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { file.end(); break }
          if (!file.write(Buffer.from(value))) await new Promise<void>(r => file.once('drain', r))
        }
      } catch (e) { file.destroy(e as Error) }
    }
    pump()
  })
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const isGdrive = url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')

  let res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)

  const contentType = res.headers.get('content-type') ?? ''

  if (isGdrive && contentType.includes('text/html')) {
    const html = await res.text()
    let realUrl: string | null = null

    const actionMatch = html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/)
    if (actionMatch) {
      const base = actionMatch[1].replace(/&amp;/g, '&')
      const params: Record<string, string> = {}
      const re = /<input\b[^>]*>/gi
      let tag: RegExpExecArray | null
      while ((tag = re.exec(html)) !== null) {
        const t = tag[0]
        if (!/type=["']hidden["']/i.test(t)) continue
        const name = t.match(/\bname=["']([^"']+)["']/i)?.[1]
        const value = t.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? ''
        if (name) params[name] = value
      }
      realUrl = Object.keys(params).length
        ? `${base}?${new URLSearchParams(params).toString()}`
        : base
    }

    if (!realUrl) {
      const confirmMatch = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/)
      const idMatch = url.match(/[?&]id=([^&]+)/)
      if (confirmMatch && idMatch) {
        realUrl = `https://drive.google.com/uc?export=download&id=${idMatch[1]}&confirm=${confirmMatch[1]}`
      }
    }

    if (!realUrl) {
      throw new Error(
        'Google Drive returned a confirmation page and no download link was found. ' +
        'Set the file sharing to "Anyone with the link can view" and try again.'
      )
    }

    res = await fetch(realUrl, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`Google Drive confirmed download failed: HTTP ${res.status}`)
  }

  await streamBodyToFile(res.body!, dest)

  const buf = Buffer.alloc(12)
  const fd = fs.openSync(dest, 'r')
  fs.readSync(fd, buf, 0, 12, 0)
  fs.closeSync(fd)
  const boxType = buf.slice(4, 8).toString('ascii')
  if (boxType !== 'ftyp' && boxType !== 'moov' && boxType !== 'mdat' && boxType !== 'wide') {
    const preview = buf.slice(0, 12).toString('utf8').replace(/[^\x20-\x7e]/g, '.')
    throw new Error(
      `Downloaded file is not a valid video (expected MP4, got "${preview}"). ` +
      'The Google Drive link may have returned an HTML page. ' +
      'Set the file sharing to "Anyone with the link can view".'
    )
  }
}

async function markVariant(
  jobId: string,
  variantId: string,
  status: 'ready' | 'failed',
  downloadUrl: string | null,
  error: string | null
) {
  const db = supabaseAdmin()
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  if (!job?.variants) return

  const variants = (job.variants as VideoVariant[]).map((v) =>
    v.id === variantId
      ? { ...v, status, download_url: downloadUrl, preview_url: downloadUrl, error, progress: null }
      : v
  )

  const allDone = variants.every((v) => v.status === 'ready' || v.status === 'failed')
  await db
    .from('video_jobs')
    .update({ variants, ...(allDone ? { status: 'complete' } : {}) })
    .eq('id', jobId)
}

async function setVariantProgress(
  jobId: string,
  variantId: string,
  step: number,
  total: number,
  label: string
): Promise<void> {
  try {
    const db = supabaseAdmin()
    const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    if (!job?.variants) return
    const variants = (job.variants as VideoVariant[]).map((v) =>
      v.id === variantId ? { ...v, progress: { step, total, label } } : v
    )
    await db.from('video_jobs').update({ variants }).eq('id', jobId)
  } catch { /* best-effort */ }
}

async function finishVariant(
  jobId: string,
  variantId: string,
  localPath: string
) {
  const storageUrl = await tryUploadToStorage(localPath, storageFileName(variantId), jobId)
  const url = storageUrl ?? `/renders/${jobId}/${path.basename(localPath)}`
  await markVariant(jobId, variantId, 'ready', url, null)
}

function cleanTempFiles(outDir: string, variantId: string): void {
  try {
    const tmpDir = os.tmpdir()
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith('descript-src-') && f.endsWith('.mp4')) {
        try { fs.unlinkSync(path.join(tmpDir, f)) } catch { /* best-effort */ }
      }
    }
  } catch { /* best-effort */ }
  for (const suffix of ['_edited.mp4', '.mp4', '_captions.ass', '_edited_tmp.mp4', '_mx.mp4', '_dt.mp4', '_broll.mp4']) {
    const p = path.join(outDir, `${variantId}${suffix}`)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch { /* best-effort */ }
  }
}

async function getVideoStreamDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      (_err, stdout) => {
        const d = parseFloat(stdout.trim())
        resolve(d > 0 ? d : 0)
      }
    )
  })
}

// ── Background music via ElevenLabs Sound Generation ─────────────────────────

// Derive a music prompt from the video's hook using a fast AI call.
// This makes music match the actual content   calm for a reflective video, upbeat for energetic, etc.
async function deriveMusicPrompt(hook: string): Promise<string> {
  const fallback = 'subtle ambient background music with soft piano, slow tempo, no vocals, designed for spoken word video'
  if (!hook) return fallback
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{
        role: 'user',
        content: `A short-form video has this opening hook: "${hook.slice(0, 200)}"\n\nIn one sentence under 20 words, describe the ideal background music for this video. Focus only on: tempo, mood, and instruments. Do not mention the video topic. Always end with "no vocals". Example: "slow ambient piano with warm pads, calm and grounding, no vocals"`,
      }],
      max_tokens: 60,
    })
    const prompt = raw.trim().replace(/^["']|["']$/g, '')
    console.log(`[motion-renderer] derived music prompt: "${prompt}"`)
    return prompt
  } catch {
    return fallback
  }
}

async function generateBackgroundMusic(hook: string): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) { console.warn('[motion-renderer] ELEVENLABS_API_KEY not set   skipping music'); return null }
  const prompt = process.env.BACKGROUND_MUSIC_PROMPT || await deriveMusicPrompt(hook)
  console.log(`[motion-renderer] generating background music: "${prompt.slice(0, 80)}..."`)
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      // Always generate 22s (max quality); FFmpeg loops it to fill any video length.
      body: JSON.stringify({ text: prompt, duration_seconds: 22, prompt_influence: 0.4 }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      console.warn(`[motion-renderer] ElevenLabs music gen ${res.status}:`, await res.text().catch(() => ''))
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const out = path.join(os.tmpdir(), `bgmusic_${Date.now()}.mp3`)
    fs.writeFileSync(out, buf)
    console.log(`[motion-renderer] music ready: ${(buf.byteLength / 1024).toFixed(0)} KB`)
    return out
  } catch (e) {
    console.warn('[motion-renderer] music generation error:', (e as Error).message)
    return null
  }
}

// Mix generated music under the video. Fades in/out, ducks under the voice via sidechain compression.
async function mixBackgroundMusic(videoPath: string, hook: string): Promise<void> {
  const duration = await getVideoDuration(videoPath)
  const musicPath = await generateBackgroundMusic(hook)
  if (!musicPath) return

  // Fade in over 1.5s at start, fade out in the last 1.5s
  const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2)
  const tmp = videoPath + '_mx.mp4'

  try {
    // Music chain: loop → fade in/out → set level → sidechain-compress under voice
    // sidechaincompress ducks music when voice is present (ratio=6), releases slowly (300ms) so it breathes naturally
    await run(
      `ffmpeg -y -i "${videoPath}" -stream_loop -1 -i "${musicPath}" ` +
      `-filter_complex ` +
      `"[1:a]asetpts=N/SR/TB,afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=1.5,volume=0.28[bgfade];` +
      `[bgfade][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=5:release=300[ducked];` +
      `[0:a][ducked]amix=inputs=2:duration=first:normalize=0[out]" ` +
      `-map 0:v -map "[out]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${tmp}"`,
      300_000
    )
    if (fs.existsSync(tmp)) fs.renameSync(tmp, videoPath)
    else console.warn('[motion-renderer] music mix produced no output, keeping original')
  } catch (e) {
    console.warn('[motion-renderer] music mix failed, keeping original:', (e as Error).message)
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
  } finally {
    try { fs.unlinkSync(musicPath) } catch { /* best-effort */ }
  }
}

// Trim trailing audio tail from Descript exports (video stream ends before container duration).
// Uses video stream duration via getVideoStreamDuration.
async function trimDescriptTail(filePath: string): Promise<void> {
  const videoSec = await getVideoStreamDuration(filePath)
  if (!videoSec || videoSec <= 0) return
  const containerSec = await getVideoDuration(filePath)
  if (containerSec - videoSec < 0.2) return // nothing meaningful to trim
  console.log(`[motion-renderer] trimming Descript tail: ${containerSec.toFixed(2)}s → ${videoSec.toFixed(2)}s`)
  const tmp = filePath + '_dt.mp4'
  try {
    await run(
      `ffmpeg -y -i "${filePath}" -t ${videoSec.toFixed(3)} -c:v copy -c:a aac -movflags +faststart "${tmp}"`,
      120_000
    )
    fs.renameSync(tmp, filePath)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
    throw e
  }
}

// ── Custom B-roll from Google Drive ──────────────────────────────────────────

function parseDriveUrl(url: string): { type: 'file' | 'folder'; id: string } | null {
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch) return { type: 'file', id: fileMatch[1] }
  const folderMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/) ?? url.match(/[?&]id=([^&]+)/)
  if (folderMatch) return { type: 'folder', id: folderMatch[1] }
  return null
}

async function listBRollFiles(driveUrl: string): Promise<{ url: string; name: string }[]> {
  const parsed = parseDriveUrl(driveUrl)
  if (!parsed) {
    console.warn('[motion-renderer] could not parse Drive URL for B-roll:', driveUrl)
    return []
  }

  const toUrl = (id: string) =>
    `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`

  if (parsed.type === 'file') {
    return [{ url: toUrl(parsed.id), name: parsed.id }]
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY
  if (!apiKey) {
    console.warn('[motion-renderer] GOOGLE_DRIVE_API_KEY not set   cannot list Drive folder, skipping B-roll')
    return []
  }

  try {
    const params = new URLSearchParams({
      q: `'${parsed.id}' in parents and mimeType contains 'video/' and trashed=false`,
      fields: 'files(id,name)',
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Drive API ${res.status}`)
    const data = await res.json() as { files?: { id: string; name: string }[] }
    const files = data.files ?? []
    console.log(`[motion-renderer] found ${files.length} B-roll files in Drive folder`)
    return files.map(f => ({ url: toUrl(f.id), name: f.name }))
  } catch (e) {
    console.warn('[motion-renderer] Drive folder listing failed:', (e as Error).message)
    return []
  }
}

// AI picks the most relevant clip from a folder based on filenames vs video content.
async function pickBestBRollClip(
  files: { url: string; name: string }[],
  hook: string,
  cta: string,
): Promise<{ url: string; name: string }> {
  if (files.length === 1) return files[0]
  try {
    const list = files.map((f, i) => `${i + 1}. ${f.name}`).join('\n')
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{
        role: 'user',
        content: `A short-form video opens with: "${hook.slice(0, 200)}"\nCTA: "${cta.slice(0, 100)}"\n\nWhich B-roll clip would visually reinforce this message best? Reply with only the number.\n\n${list}`,
      }],
      max_tokens: 10,
    })
    const idx = parseInt(raw.trim()) - 1
    if (idx >= 0 && idx < files.length) {
      console.log(`[motion-renderer] AI selected B-roll clip: "${files[idx].name}"`)
      return files[idx]
    }
  } catch (e) {
    console.warn('[motion-renderer] B-roll AI selection failed, using first clip:', (e as Error).message)
  }
  return files[0]
}

async function findBRollInsertionPoints(
  videoPath: string,
): Promise<{ insertAt: number; duration: number }[]> {
  const totalDuration = await getVideoDuration(videoPath)
  // One clip only, placed at the single best pause   short and purposeful
  const CLIP_MAX = 2.5
  const maxInsertions = 1

  return new Promise((resolve) => {
    let stderr = ''
    const proc = exec(
      `ffmpeg -i "${videoPath}" -af "silencedetect=noise=-38dB:d=0.4" -f null -`,
      { timeout: 60_000 },
      () => {
        const starts: number[] = []
        const ends: number[] = []
        for (const m of stderr.matchAll(/silence_start: ([\d.]+)/g)) starts.push(parseFloat(m[1]))
        for (const m of stderr.matchAll(/silence_end: ([\d.]+)/g)) ends.push(parseFloat(m[1]))

        const gaps: { insertAt: number; gap: number }[] = []
        for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
          const gap = ends[i] - starts[i]
          if (gap >= 0.4 && starts[i] > 2 && ends[i] < totalDuration - 2) {
            gaps.push({ insertAt: starts[i], gap })
          }
        }

        const points = gaps
          .sort((a, b) => b.gap - a.gap)
          .slice(0, maxInsertions)
          .sort((a, b) => a.insertAt - b.insertAt)
          .map(p => ({ insertAt: p.insertAt, duration: Math.min(p.gap * 0.6, CLIP_MAX) }))

        console.log(`[motion-renderer] found ${points.length} B-roll insertion points (target ~10% of ${totalDuration.toFixed(1)}s)`)
        resolve(points)
      }
    )
    proc.stderr?.on('data', d => { stderr += String(d) })
  })
}

async function insertBRoll(
  inputPath: string,
  brollPaths: string[],
  insertionPoints: { insertAt: number; duration: number }[],
  outputPath: string,
): Promise<void> {
  const pairs = Math.min(brollPaths.length, insertionPoints.length)
  if (pairs === 0) return

  const allInputs = [inputPath, ...brollPaths.slice(0, pairs)]
  const inputFlags = allInputs.map(p => `-i "${p}"`).join(' ')
  const filterParts: string[] = []
  let currentLayer = '[0:v]'

  for (let i = 0; i < pairs; i++) {
    const { insertAt, duration: windowDuration } = insertionPoints[i]
    const bIdx = i + 1
    const brLabel = `[br${i}]`
    const outLabel = i < pairs - 1 ? `[ov${i}]` : '[outv]'

    filterParts.push(
      `[${bIdx}:v]trim=duration=${windowDuration.toFixed(3)},setpts=PTS-STARTPTS+${insertAt.toFixed(3)}/TB,` +
      `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black${brLabel}`
    )
    filterParts.push(
      `${currentLayer}${brLabel}overlay=0:0:enable='between(t,${insertAt.toFixed(3)},${(insertAt + windowDuration).toFixed(3)})'${outLabel}`
    )
    currentLayer = outLabel
  }

  await run(
    `ffmpeg -y ${inputFlags} ` +
    `-filter_complex "${filterParts.join(';')}" ` +
    `-map "[outv]" -map "0:a" ` +
    `-c:v libx264 -preset fast -crf 22 -c:a copy -pix_fmt yuv420p -movflags +faststart "${outputPath}"`,
    300_000
  )
}

async function insertCustomBRoll(
  videoPath: string,
  brollDriveUrl: string,
  hook: string,
  cta: string,
): Promise<void> {
  console.log('[motion-renderer] inserting custom B-roll from:', brollDriveUrl)
  const files = await listBRollFiles(brollDriveUrl)
  if (!files.length) {
    console.warn('[motion-renderer] no B-roll files found, skipping')
    return
  }

  const chosen = await pickBestBRollClip(files, hook, cta)

  const insertionPoints = await findBRollInsertionPoints(videoPath)
  if (!insertionPoints.length) {
    console.warn('[motion-renderer] no suitable insertion points found, skipping custom B-roll')
    return
  }

  const tmpPath = path.join(os.tmpdir(), `broll_${Date.now()}.mp4`)
  try {
    await downloadFile(chosen.url, tmpPath)
  } catch (e) {
    console.warn('[motion-renderer] failed to download B-roll clip:', (e as Error).message)
    return
  }

  const outPath = videoPath + '_broll.mp4'
  try {
    await insertBRoll(videoPath, [tmpPath], insertionPoints, outPath)
    if (fs.existsSync(outPath)) fs.renameSync(outPath, videoPath)
  } catch (e) {
    console.warn('[motion-renderer] B-roll insertion failed, keeping original:', (e as Error).message)
    try { fs.unlinkSync(outPath) } catch { /* best-effort */ }
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* best-effort */ }
  }
}

// Main pipeline:
//   V1: Descript single pass   cuts + Studio Sound + B-roll + captions
//   V2: Descript cuts only → ZapCap captions + B-roll
async function renderSmartCinematic(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  outDir: string,
  hook: string,
  cta: string,
  zapcapTemplateIndex?: 1 | 2,
  zapcapBrollPercent?: number,
  descriptBroll?: boolean,
  descriptCaptions?: boolean,
  brollDriveUrl?: string,
): Promise<void> {
  // Steps: Descript + optional custom B-roll + optional ZapCap + music
  const STEPS = 1 + (brollDriveUrl ? 1 : 0) + (zapcapTemplateIndex ? 1 : 0) + 1
  let step = 1
  try {
    cleanTempFiles(outDir, variantId)

    // Cache key includes Descript options   V1 (broll+captions) and V2 (clean) are different outputs.
    // Promise stored while running so concurrent variants wait instead of launching duplicates.
    const cacheKey = `${jobId}:${descriptBroll ? 'b' : ''}${descriptCaptions ? 'c' : ''}`
    const existing = descriptUrlCache.get(cacheKey)
    let editedUrl: string

    await setVariantProgress(jobId, variantId, step++, STEPS, 'Editing with Descript')

    if (existing instanceof Promise) {
      console.log(`[motion-renderer] waiting for in-progress Descript edit (${cacheKey})`)
      editedUrl = await existing
    } else if (existing && existing.expiresAt > Date.now()) {
      console.log(`[motion-renderer] reusing cached Descript URL (${cacheKey})`)
      editedUrl = existing.url
    } else {
      const projectName = `cinematic-${jobId.slice(0, 8)}`
      const promise = processWithDescript(sourceUrl, projectName, { broll: descriptBroll, captions: descriptCaptions })
      descriptUrlCache.set(cacheKey, promise)
      try {
        editedUrl = await promise
        descriptUrlCache.set(cacheKey, { url: editedUrl, expiresAt: Date.now() + 2 * 60 * 60 * 1000 })
        console.log(`[motion-renderer] Descript done, URL cached (${cacheKey})`)
      } catch (e) {
        descriptUrlCache.delete(cacheKey)
        throw e
      }
    }

    const outputPath = path.join(outDir, `${variantId}.mp4`)

    if (zapcapTemplateIndex) {
      // Download Descript output to temp, trim the black tail, optionally insert custom B-roll,
      // then let ZapCap add captions (and stock B-roll if not using custom).
      const tmpEdited = path.join(outDir, `${variantId}_edited_tmp.mp4`)
      await downloadFile(editedUrl, tmpEdited)
      await trimDescriptTail(tmpEdited)

      if (brollDriveUrl) {
        await setVariantProgress(jobId, variantId, step++, STEPS, 'Inserting custom B-roll')
        await insertCustomBRoll(tmpEdited, brollDriveUrl, hook, cta)
      }

      // Vary stock B-roll coverage slightly each run for natural variety (target ±5%)
      const actualBrollPct = zapcapBrollPercent !== undefined
        ? Math.max(7, zapcapBrollPercent + (Math.floor(Math.random() * 3) - 1) * 3)
        : undefined

      const label = actualBrollPct ? 'Adding captions + B-roll with ZapCap' : 'Adding captions with ZapCap'
      await setVariantProgress(jobId, variantId, step++, STEPS, label)
      const captionedUrl = await processWithZapcap(tmpEdited, zapcapTemplateIndex, actualBrollPct)
      console.log('[motion-renderer] ZapCap done')
      try { fs.unlinkSync(tmpEdited) } catch { /* best-effort */ }
      await downloadFile(captionedUrl, outputPath)
    } else {
      await downloadFile(editedUrl, outputPath)
      await trimDescriptTail(outputPath)

      if (brollDriveUrl) {
        await setVariantProgress(jobId, variantId, step++, STEPS, 'Inserting custom B-roll')
        await insertCustomBRoll(outputPath, brollDriveUrl, hook, cta)
      }
    }

    console.log('[motion-renderer] output ready, adding music')
    await setVariantProgress(jobId, variantId, STEPS, STEPS, 'Adding background music')
    await mixBackgroundMusic(outputPath, hook)
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

export function startSingleVariant(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  hook: string,
  cta: string,
  zapcapTemplateIndex?: 1 | 2,
  zapcapBrollPercent?: number,
  descriptBroll?: boolean,
  descriptCaptions?: boolean,
  brollDriveUrl?: string,
) {
  const key = jobId + ':' + variantId
  if (active.has(key)) return
  active.add(key)

  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  fs.mkdirSync(outDir, { recursive: true })

  // When custom B-roll is provided, disable stock B-roll from Descript/ZapCap to avoid stacking.
  const effectiveDescriptBroll = brollDriveUrl ? false : descriptBroll
  const effectiveZapcapBrollPercent = brollDriveUrl ? undefined : zapcapBrollPercent

  const launch = async () => {
    await renderSmartCinematic(
      jobId, variantId, sourceUrl, outDir, hook, cta,
      zapcapTemplateIndex, effectiveZapcapBrollPercent,
      effectiveDescriptBroll, descriptCaptions,
      brollDriveUrl,
    )
  }

  launch()
    .catch(e => console.error('[motion-renderer] startSingleVariant fatal:', e))
    .finally(() => active.delete(key))
}
