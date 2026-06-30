import { ensureFfmpegOnPath } from './ffmpeg-env'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createClient } from '@supabase/supabase-js'
import { tryUploadToStorage, uploadToStorage } from './storage'
import { chatCompletion, MODELS } from './openrouter'
import type { VideoVariant, MusicMode } from './video-pipeline'
import { submitSubmagicJob, pollSubmagicJob, DEFAULT_MUSIC_MODE } from './video-pipeline'
import { transcribeLocalFile, generateASSCaptions, writeASSFile, FONTS_DIR } from './caption-renderer'
import { getLibraryMusic } from './music-library'
import { getWhooshSfx, getSfx } from './sound-effects'
import { planScenes, type MediaFile, type ScenePlan } from './scene-planner'
import { planMotionGraphics, type MotionGraphic } from './graphics-plan'

// Patch PATH to the bundled ffmpeg/ffprobe before any exec runs. Called
// explicitly (not a bare side-effect import) so the bundler can't drop it.
ensureFfmpegOnPath()

const active = new Set<string>()

const MUSIC_ENABLED = true

const sourceFileCache = new Map<string, Promise<string>>()

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

type ProgressCallback = (percent: number, label: string) => void | Promise<void>

async function streamBodyToFile(
  body: ReadableStream<Uint8Array>,
  dest: string,
  contentLength?: number,
  onProgress?: ProgressCallback,
): Promise<void> {
  const file = fs.createWriteStream(dest)
  const reader = body.getReader()
  await new Promise<void>((resolve, reject) => {
    file.on('error', reject)
    file.on('finish', resolve)
    let downloaded = 0
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { file.end(); break }
          const chunk = Buffer.from(value)
          downloaded += chunk.byteLength
          if (contentLength && onProgress) {
            await onProgress(Math.min(75, 10 + Math.round((downloaded / contentLength) * 65)), 'Downloading footage')
          }
          if (!file.write(chunk)) await new Promise<void>(r => file.once('drain', r))
        }
      } catch (e) { file.destroy(e as Error) }
    }
    pump()
  })
}

async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, init)
    } catch (e) {
      lastError = e
      if (attempt < attempts) await new Promise(r => setTimeout(r, attempt * 1500))
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`${label} failed after ${attempts} attempts: ${message}`)
}

async function downloadFile(url: string, dest: string, onProgress?: ProgressCallback): Promise<void> {
  const isGdrive = url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')
  await onProgress?.(10, `Connecting to ${isGdrive ? 'Google Drive' : 'download URL'}`)

  let res = await fetchWithRetry(url, { redirect: 'follow' }, `Download ${isGdrive ? 'from Google Drive' : 'from remote URL'}`)
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

    res = await fetchWithRetry(realUrl, { redirect: 'follow' }, 'Google Drive confirmed download')
    if (!res.ok || !res.body) throw new Error(`Google Drive confirmed download failed: HTTP ${res.status}`)
  }

  const contentLength = parseInt(res.headers.get('content-length') ?? '', 10)
  await streamBodyToFile(res.body!, dest, Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined, onProgress)
  await onProgress?.(78, 'Validating footage')

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

async function getSharedSourceFile(
  jobId: string,
  sourceUrl: string,
  outDir: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const finalPath = path.join(outDir, 'source.mp4')
  if (fs.existsSync(finalPath)) return finalPath

  const existing = sourceFileCache.get(jobId)
  if (existing) return existing

  const promise = (async () => {
    const partialPath = path.join(outDir, 'source.download')
    try { if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath) } catch { /* best-effort */ }
    await downloadFile(sourceUrl, partialPath, onProgress)
    fs.renameSync(partialPath, finalPath)
    return finalPath
  })()

  sourceFileCache.set(jobId, promise)
  try {
    return await promise
  } catch (e) {
    sourceFileCache.delete(jobId)
    throw e
  }
}

interface VideoDimensions {
  width: number
  height: number
}

async function probeVideoDimensions(filePath: string): Promise<VideoDimensions> {
  return new Promise((resolve) => {
    exec(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of json "${filePath}"`,
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return resolve({ width: 1080, height: 1920 })
        try {
          const data = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] }
          const v = data.streams?.[0]
          resolve(v?.width && v?.height ? { width: v.width, height: v.height } : { width: 1080, height: 1920 })
        } catch {
          resolve({ width: 1080, height: 1920 })
        }
      }
    )
  })
}

// Compresses for file size only -- never touches resolution, aspect ratio,
// or framing. Whatever shape the source was filmed in, it stays that shape.
async function compressSourceFile(inputPath: string, outDir: string): Promise<string> {
  const outputPath = path.join(outDir, 'source-compressed.mp4')
  if (fs.existsSync(outputPath)) return outputPath

  const tmpPath = path.join(outDir, 'source-compressed.tmp.mp4')
  try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* best-effort */ }

  await run(
    `ffmpeg -y -i "${inputPath}" ` +
    `-r 30 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p ` +
    `-c:a aac -b:a 128k -ar 48000 -movflags +faststart "${tmpPath}"`,
    600_000,
  )

  fs.renameSync(tmpPath, outputPath)
  return outputPath
}

// Ensures the shared compressed local copy exists for this job -- downloads
// raw if needed, compresses if needed (file size only, original resolution/
// aspect ratio untouched). Both steps are idempotent (check for an existing
// file first), so calling this from multiple places (job creation, each
// variant) only ever does the real work once per job. Every variant
// (our-v1 through our-v6) ends up reading the same compressed file.
async function getLocalCompressedSource(
  jobId: string,
  sourceUrl: string,
  outDir: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true })
  const rawLocalPath = await getSharedSourceFile(jobId, sourceUrl, outDir, onProgress)
  await onProgress?.(80, 'Compressing footage')
  const compressedPath = await compressSourceFile(rawLocalPath, outDir)
  await onProgress?.(95, 'Compressed footage ready')
  return compressedPath
}

const submagicSourceCache = new Map<string, Promise<string>>()

// Submagic-using variants (our-v1 through our-v5) always get the compressed,
// normalized copy uploaded to Storage -- never the raw Drive file. Cached
// per job so every Submagic variant shares one upload. Throws rather than
// silently falling back to the raw Drive link, since a silent fallback
// caused real confusion before.
export async function getSubmagicSourceUrl(jobId: string, rawSourceUrl: string): Promise<string> {
  const cached = submagicSourceCache.get(jobId)
  if (cached) return cached

  const promise = (async () => {
    const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
    const compressedPath = await getLocalCompressedSource(jobId, rawSourceUrl, outDir)
    return uploadToStorage(compressedPath, 'source-compressed.mp4', jobId)
  })()

  submagicSourceCache.set(jobId, promise)
  try {
    return await promise
  } catch (e) {
    submagicSourceCache.delete(jobId)
    throw e
  }
}

// Runs at job creation (Phase 0), before any variant is started, so the
// compressed copy is already sitting on disk by the time you click any
// "Start Edit" button -- v1-v6 all read this same file.
export async function prepareJobSource(
  jobId: string,
  sourceUrl: string,
  onProgress?: ProgressCallback,
): Promise<{ localPath: string }> {
  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  const localPath = await getLocalCompressedSource(jobId, sourceUrl, outDir, onProgress)
  await onProgress?.(100, 'Footage ready')
  return { localPath }
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
  const url = `/renders/${jobId}/${path.basename(localPath)}`
  await markVariant(jobId, variantId, 'ready', url, null)
}

// Pulls a finished Submagic render down to a local file instead of just
// linking to Submagic's hosted URL, so the video survives even if Submagic
// later expires or removes the file from their end.
export async function retrieveAndStoreSubmagicResult(
  jobId: string,
  variantId: string,
  downloadUrl: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string } | null = null,
): Promise<string> {
  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  fs.mkdirSync(outDir, { recursive: true })
  const localPath = path.join(outDir, `${variantId}_submagic.mp4`)
  await downloadFile(downloadUrl, localPath)

  // Add our own library music on top of the finished Submagic video, so v2/v3
  // share the exact v4/v5 music system (mood match, best-part offset, ducking,
  // -13 LUFS). Best-effort — a music failure must never lose the rendered video.
  if (music) {
    try {
      await mixBackgroundMusic(localPath, music.hook, music.moodTag, music.scriptFormat, 'smart')
      console.log(`[motion-renderer] mixed library music onto Submagic result ${jobId}:${variantId}`)
    } catch (e) {
      console.warn('[motion-renderer] post-Submagic music mix failed, keeping video without it:', (e as Error).message)
    }
  }

  return `/renders/${jobId}/${path.basename(localPath)}`
}

function cleanTempFiles(outDir: string, variantId: string): void {
  for (const suffix of ['.mp4', '_captions.ass', '_mx.mp4', '_broll.mp4', '_mg.mp4']) {
    const p = path.join(outDir, `${variantId}${suffix}`)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch { /* best-effort */ }
  }
}

// ── Background music from the curated library ────────────────────────────────

// Picks a mood-matched track from the creator's own library, starts it at the
// detected best part (chorus/drop), and mixes it under the voice: EQ-carve the
// vocal band, light sidechain duck so the music stays present, then master the
// whole thing to -13 LUFS / -1.5 dBTP (short-form loudness). mode 'off' = no
// music. Library files are the creator's own and are never deleted.
async function mixBackgroundMusic(
  videoPath: string,
  hook: string,
  moodTag: string | null,
  scriptFormat?: string,
  mode: MusicMode = DEFAULT_MUSIC_MODE,
): Promise<void> {
  if (mode === 'off') return
  const duration = await getVideoDuration(videoPath)

  const lib = await getLibraryMusic({ hook, moodTag, scriptFormat })
  if (!lib) {
    console.warn('[motion-renderer] no library track available — skipping music for this render')
    return
  }
  const musicPath = lib.filePath
  // Start the music at its detected best part (chorus/drop). 0 = from the top.
  const startOffset = Math.max(0, lib.track.startOffset ?? 0)
  const ssArg = startOffset > 0 ? `-ss ${startOffset} ` : ''
  console.log(`[motion-renderer] using library track "${lib.track.title}" (${lib.track.categories.join('/')})${startOffset ? ` @ ${startOffset}s` : ''}`)

  // Fade in over 1.5s at start, fade out in the last 1.5s
  const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2)
  const tmp = videoPath + '_mx.mp4'

  try {
    // loop → fade in/out → EQ-carve the vocal presence band (-5dB ~2.5kHz so
    // music never masks speech) → present level (0.22) → light sidechain duck
    // (ratio 4) so music stays audible under continuous speech → master to
    // -13 LUFS / -1.5 dBTP.
    await run(
      `ffmpeg -y -i "${videoPath}" -stream_loop -1 ${ssArg}-i "${musicPath}" ` +
      `-filter_complex ` +
      `"[1:a]asetpts=N/SR/TB,afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=1.5,` +
      `equalizer=f=2500:width_type=q:w=1.4:g=-5,volume=0.22[bgfade];` +
      `[bgfade][0:a]sidechaincompress=threshold=0.04:ratio=4:attack=5:release=300[ducked];` +
      `[0:a][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-13:TP=-1.5:LRA=11[out]" ` +
      `-map 0:v -map "[out]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${tmp}"`,
      300_000
    )
    if (fs.existsSync(tmp)) fs.renameSync(tmp, videoPath)
    else console.warn('[motion-renderer] music mix produced no output, keeping original')
  } catch (e) {
    console.warn('[motion-renderer] music mix failed, keeping original:', (e as Error).message)
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
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

async function listBRollFiles(driveUrl: string): Promise<MediaFile[]> {
  const parsed = parseDriveUrl(driveUrl)
  if (!parsed) {
    console.warn('[motion-renderer] could not parse Drive URL for B-roll:', driveUrl)
    return []
  }

  const toUrl = (id: string) =>
    `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`

  if (parsed.type === 'file') {
    // Single file links don't carry a mimeType from the URL alone — assume
    // video, the overwhelmingly common case for a single B-roll link.
    return [{ url: toUrl(parsed.id), name: parsed.id, type: 'video' }]
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY
  if (!apiKey) {
    console.warn('[motion-renderer] GOOGLE_DRIVE_API_KEY not set   cannot list Drive folder, skipping B-roll')
    return []
  }

  try {
    const params = new URLSearchParams({
      q: `'${parsed.id}' in parents and (mimeType contains 'video/' or mimeType contains 'image/') and trashed=false`,
      fields: 'files(id,name,mimeType)',
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`Drive API ${res.status}`)
    const data = await res.json() as { files?: { id: string; name: string; mimeType?: string }[] }
    const files = data.files ?? []
    const videoCount = files.filter(f => f.mimeType?.startsWith('video/')).length
    console.log(`[motion-renderer] found ${files.length} B-roll files in Drive folder (${videoCount} video, ${files.length - videoCount} image)`)
    return files.map(f => ({
      url: toUrl(f.id),
      name: f.name,
      type: f.mimeType?.startsWith('image/') ? 'image' as const : 'video' as const,
    }))
  } catch (e) {
    console.warn('[motion-renderer] Drive folder listing failed:', (e as Error).message)
    return []
  }
}

// Scales insertion count with video length so a 90s video doesn't get
// stretched to fit one giant clip, and a 20s video doesn't get carved into
// three tiny ones. Total B-roll budget stays 20-30% regardless of how many
// points it's split across.
async function findBRollInsertionPoints(
  videoPath: string,
): Promise<{ insertAt: number; duration: number }[]> {
  const totalDuration = await getVideoDuration(videoPath)
  const TARGET_BROLL_PERCENT = 0.25
  const CLIP_MIN = 0.8
  const CLIP_MAX_ABS = 4

  const maxInsertions = totalDuration < 30 ? 1 : totalDuration < 60 ? 2 : 3
  const totalTargetDuration = totalDuration * TARGET_BROLL_PERCENT
  const perClipTarget = Math.min(Math.max(totalTargetDuration / maxInsertions, CLIP_MIN), CLIP_MAX_ABS)

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

        // Spread picks across the timeline (not just the N longest gaps,
        // which could all cluster in one section) by taking the best gap
        // from each of maxInsertions roughly-equal time buckets.
        const bucketSize = totalDuration / maxInsertions
        const points: { insertAt: number; duration: number }[] = []
        for (let b = 0; b < maxInsertions; b++) {
          const bucketStart = b * bucketSize
          const bucketEnd = bucketStart + bucketSize
          const inBucket = gaps.filter(g => g.insertAt >= bucketStart && g.insertAt < bucketEnd)
          if (!inBucket.length) continue
          const best = inBucket.sort((a, b2) => b2.gap - a.gap)[0]
          points.push({ insertAt: best.insertAt, duration: Math.min(best.gap * 0.6, perClipTarget) })
        }
        points.sort((a, b) => a.insertAt - b.insertAt)

        console.log(`[motion-renderer] found ${points.length}/${maxInsertions} B-roll insertion points (target ~25% of ${totalDuration.toFixed(1)}s, ~${perClipTarget.toFixed(1)}s each)`)
        resolve(points)
      }
    )
    proc.stderr?.on('data', d => { stderr += String(d) })
  })
}

interface BRollPlacement {
  mediaPath: string
  mediaType: 'video' | 'image'
  insertAt: number
  duration: number
  sfxCategory: ScenePlan['sfxCategory']
}

async function insertBRoll(
  inputPath: string,
  placements: BRollPlacement[],
  outputPath: string,
): Promise<void> {
  if (!placements.length) return

  // Resolve each unique SFX category once (cached after first render),
  // skip 'none' entirely. Multiple placements sharing a category re-use
  // the same input stream — ffmpeg duplicates it per consumer automatically.
  const neededCategories = Array.from(new Set(
    placements.map(p => p.sfxCategory).filter((c): c is Exclude<ScenePlan['sfxCategory'], 'none'> => c !== 'none')
  ))
  const sfxPathByCategory = new Map<string, string>()
  for (const cat of neededCategories) {
    const p = await getSfx(cat).catch(() => null)
    if (p) sfxPathByCategory.set(cat, p)
  }
  const sfxInputPaths = Array.from(new Set(sfxPathByCategory.values()))
  const sfxInputIndex = new Map<string, number>()

  const inputFlags = [`-i "${inputPath}"`]
  placements.forEach(p => {
    inputFlags.push(
      p.mediaType === 'image'
        ? `-loop 1 -t ${p.duration.toFixed(3)} -i "${p.mediaPath}"`
        : `-i "${p.mediaPath}"`
    )
  })
  sfxInputPaths.forEach((p, i) => {
    inputFlags.push(`-i "${p}"`)
    sfxInputIndex.set(p, 1 + placements.length + i)
  })

  const filterParts: string[] = []
  let currentLayer = '[0:v]'
  const FADE_DUR = 0.25

  placements.forEach((p, i) => {
    const bIdx = i + 1
    const brLabel = `[br${i}]`
    const outLabel = i < placements.length - 1 ? `[ov${i}]` : '[outv]'
    const fadeDur = Math.min(FADE_DUR, p.duration / 4)
    const fadeOutStart = p.insertAt + p.duration - fadeDur

    // Video: trim the window then shift to insertAt. Image: already exactly
    // `duration` long via -loop/-t above, just needs the same time shift.
    const timing = p.mediaType === 'image'
      ? `setpts=PTS-STARTPTS+${p.insertAt.toFixed(3)}/TB`
      : `trim=duration=${p.duration.toFixed(3)},setpts=PTS-STARTPTS+${p.insertAt.toFixed(3)}/TB`

    // Cross-dissolve: alpha fade in/out on the B-roll layer itself so it
    // blends with the main footage instead of popping in/out as a hard cut.
    // format=yuva420p gives the layer an alpha channel for the fade to use.
    filterParts.push(
      `[${bIdx}:v]${timing},` +
      `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `format=yuva420p,` +
      `fade=t=in:st=${p.insertAt.toFixed(3)}:d=${fadeDur.toFixed(3)}:alpha=1,` +
      `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDur.toFixed(3)}:alpha=1${brLabel}`
    )
    filterParts.push(
      `${currentLayer}${brLabel}overlay=0:0:enable='between(t,${p.insertAt.toFixed(3)},${(p.insertAt + p.duration).toFixed(3)})'${outLabel}`
    )
    currentLayer = outLabel
  })

  // Per-scene content-matched SFX, delayed to land exactly as each clip appears.
  const delayedLabels: string[] = []
  placements.forEach((p, i) => {
    if (p.sfxCategory === 'none') return
    const sfxPath = sfxPathByCategory.get(p.sfxCategory)
    const idx = sfxPath ? sfxInputIndex.get(sfxPath) : undefined
    if (idx === undefined) return
    const delayMs = Math.max(0, Math.round((p.insertAt - 0.1) * 1000))
    const label = `[sfx${i}]`
    filterParts.push(`[${idx}:a]adelay=${delayMs}:all=1,volume=0.3${label}`)
    delayedLabels.push(label)
  })

  let audioMap = '0:a'
  if (delayedLabels.length) {
    const mixInputs = ['[0:a]', ...delayedLabels].join('')
    filterParts.push(`${mixInputs}amix=inputs=${1 + delayedLabels.length}:duration=first:normalize=0[outa]`)
    audioMap = '[outa]'
  }

  await run(
    `ffmpeg -y ${inputFlags.join(' ')} ` +
    `-filter_complex "${filterParts.join(';')}" ` +
    `-map "[outv]" -map "${audioMap}" ` +
    `-c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k -pix_fmt yuv420p -movflags +faststart "${outputPath}"`,
    300_000
  )
}

// AI picks the best matching file for one specific scene's sentence content
// (not a single global pick for the whole video) — falls back to any file
// of a different type if none of the planned type are available.
async function pickMediaForScene(
  files: MediaFile[],
  mediaType: 'video' | 'image',
  sentenceContext: string,
): Promise<MediaFile> {
  const matching = files.filter(f => f.type === mediaType)
  const pool = matching.length ? matching : files
  if (pool.length === 1) return pool[0]
  try {
    const list = pool.map((f, i) => `${i + 1}. ${f.name}`).join('\n')
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{
        role: 'user',
        content: `A video moment follows this sentence: "${sentenceContext.slice(0, 200) || '(no clear sentence)'}"\n\nWhich file would visually reinforce this moment best? Reply with only the number.\n\n${list}`,
      }],
      max_tokens: 10,
    })
    const idx = parseInt(raw.trim()) - 1
    if (idx >= 0 && idx < pool.length) {
      console.log(`[motion-renderer] scene media pick: "${pool[idx].name}" for "${sentenceContext.slice(0, 60)}"`)
      return pool[idx]
    }
  } catch (e) {
    console.warn('[motion-renderer] scene media selection failed, using first match:', (e as Error).message)
  }
  return pool[0]
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
  const hasImages = files.some(f => f.type === 'image')

  const insertionPoints = await findBRollInsertionPoints(videoPath)
  if (!insertionPoints.length) {
    console.warn('[motion-renderer] no suitable insertion points found, skipping custom B-roll')
    return
  }

  // Real transcript of THIS footage (post-cut) gives the scene planner actual
  // sentence content to judge, not just the script's hook/CTA.
  let words: { text: string; start: number; end: number }[] = []
  try {
    words = await transcribeLocalFile(videoPath)
  } catch (e) {
    console.warn('[motion-renderer] transcription for scene planning failed, using generic placement:', (e as Error).message)
  }

  const scenes = words.length
    ? await planScenes(words, insertionPoints, hook, cta, hasImages)
    : insertionPoints.map(p => ({ insertAt: p.insertAt, duration: p.duration, sentenceContext: '', mediaType: 'video' as const, sfxCategory: 'whoosh' as const }))

  const activeScenes = scenes.filter(s => s.mediaType !== 'skip')
  if (!activeScenes.length) {
    console.log('[motion-renderer] scene plan chose to skip B-roll entirely for this video')
    return
  }

  const tmpPaths: string[] = []
  const placements: BRollPlacement[] = []

  try {
    for (const scene of activeScenes) {
      const mediaType = scene.mediaType as 'video' | 'image'
      const chosen = await pickMediaForScene(files, mediaType, scene.sentenceContext)
      const ext = chosen.type === 'image' ? 'jpg' : 'mp4'
      const tmpPath = path.join(os.tmpdir(), `broll_${Date.now()}_${placements.length}.${ext}`)
      try {
        await downloadFile(chosen.url, tmpPath)
      } catch (e) {
        console.warn(`[motion-renderer] failed to download "${chosen.name}", skipping this scene:`, (e as Error).message)
        continue
      }
      tmpPaths.push(tmpPath)
      placements.push({
        mediaPath: tmpPath,
        mediaType: chosen.type,
        insertAt: scene.insertAt,
        duration: scene.duration,
        sfxCategory: scene.sfxCategory,
      })
    }

    if (!placements.length) {
      console.warn('[motion-renderer] no B-roll media could be downloaded, skipping')
      return
    }

    const outPath = videoPath + '_broll.mp4'
    try {
      await insertBRoll(videoPath, placements, outPath)
      if (fs.existsSync(outPath)) fs.renameSync(outPath, videoPath)
    } catch (e) {
      console.warn('[motion-renderer] B-roll insertion failed, keeping original:', (e as Error).message)
      try { fs.unlinkSync(outPath) } catch { /* best-effort */ }
    }
  } finally {
    for (const p of tmpPaths) {
      try { fs.unlinkSync(p) } catch { /* best-effort */ }
    }
  }
}

// Submagic needs a fetchable URL, not a local file, so this downloads the
// shared source, runs our own FFmpeg custom-B-roll insertion on a dedicated
// copy (the shared source.mp4 stays untouched for other variants), and
// re-uploads the result to Storage. Caller should disable Submagic's own
// magicBrolls when using this, to avoid stacking two B-roll passes.
export async function prepareSubmagicCustomBrollSource(
  jobId: string,
  sourceUrl: string,
  brollDriveUrl: string,
  hook: string,
  cta: string,
): Promise<string> {
  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  fs.mkdirSync(outDir, { recursive: true })
  const localPath = await getSharedSourceFile(jobId, sourceUrl, outDir)

  const brollPath = path.join(outDir, 'submagic-broll-source.mp4')
  fs.copyFileSync(localPath, brollPath)
  await insertCustomBRoll(brollPath, brollDriveUrl, hook, cta)

  const publicUrl = await tryUploadToStorage(brollPath, 'submagic-broll-source.mp4', jobId)
  try { fs.unlinkSync(brollPath) } catch { /* best-effort */ }
  if (!publicUrl) throw new Error('Could not upload custom B-roll source for Submagic (Storage upload failed)')
  return publicUrl
}

// ── Native karaoke captions ───────────────────────────────────────────────────
// Transcribes the (already-cut) video with ElevenLabs Scribe, generates a tone-
// aware ASS subtitle file, and burns it into the video with FFmpeg. This is an
// alternative to Submagic's own captions for on-device caption control.

async function addNativeCaptions(
  videoPath: string,
  moodTag: string | null,
  scriptFormat?: string,
): Promise<void> {
  console.log('[motion-renderer] generating native karaoke captions...')

  let words
  try {
    words = await transcribeLocalFile(videoPath)
  } catch (e) {
    console.warn('[motion-renderer] transcription failed, skipping native captions:', (e as Error).message)
    return
  }

  if (!words.length) {
    console.warn('[motion-renderer] no words transcribed, skipping native captions')
    return
  }

  const assContent = generateASSCaptions(words, moodTag, scriptFormat)
  const assPath = writeASSFile(assContent)
  const tmp = videoPath + '_captioned.mp4'

  try {
    // FFmpeg ass filter path: escape colons (Windows drive letters) and backslashes.
    // On macOS/Linux this is a no-op, but guards against edge cases.
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    const escapedFontsDir = FONTS_DIR.replace(/\\/g, '/').replace(/:/g, '\\:')
    // fontsdir points libass at the bundled /fonts folder so caption rendering
    // never depends on what's installed on whatever machine runs FFmpeg.
    await run(
      `ffmpeg -y -i "${videoPath}" -vf "ass='${escapedAss}':fontsdir='${escapedFontsDir}'" -c:a copy -c:v libx264 -preset fast -crf 20 -movflags +faststart "${tmp}"`,
      300_000
    )
    if (fs.existsSync(tmp)) {
      fs.renameSync(tmp, videoPath)
      console.log('[motion-renderer] native captions burned in')
    } else {
      console.warn('[motion-renderer] caption burn produced no output, keeping original')
    }
  } catch (e) {
    console.warn('[motion-renderer] caption burn-in failed, keeping original:', (e as Error).message)
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
  } finally {
    try { fs.unlinkSync(assPath) } catch { /* best-effort */ }
  }
}

// ── Brand motion graphics (Remotion overlay) ──────────────────────────────────
// Plans front-loaded brand graphics from the transcript via OpenRouter (mirrors
// OVRHAUL's editing/graphics_plan.py), renders them as one transparent Remotion
// overlay, then composites over the edited video with FFmpeg. Footage and its
// audio play continuously from frame 0 -- intro_card/outro_card handle not
// blocking the view themselves (quick shrink-to-header / footage-stays-visible
// designs in IntroCard.tsx and OutroCard.tsx) rather than the video structure
// pausing for them.
const REMOTION_DIR = path.join(process.cwd(), 'remotion')

async function renderMotionGraphicsOverlay(
  outDir: string,
  variantId: string,
  graphics: MotionGraphic[],
  durationSec: number,
  style: 'minimal' | 'bold',
  dimensions: VideoDimensions,
): Promise<string> {
  const manifestPath = path.join(outDir, `${variantId}_graphics.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ graphics, durationSec, style, ...dimensions }))

  const overlayPath = path.join(outDir, `${variantId}_overlay.mov`)
  try {
    await run(
      `cd "${REMOTION_DIR}" && npx remotion render src/Root.tsx Overlay "${overlayPath}" ` +
      `--props="${manifestPath}" --codec=prores --prores-profile=4444 ` +
      `--image-format=png --pixel-format=yuva444p10le`,
      600_000,
    )
  } finally {
    try { fs.unlinkSync(manifestPath) } catch { /* best-effort */ }
  }
  return overlayPath
}

async function addMotionGraphics(
  videoPath: string,
  hook: string,
  cta: string,
  moodTag: string | null,
  scriptFormat: string | undefined,
  outDir: string,
  variantId: string,
  style: 'minimal' | 'bold' = 'minimal',
): Promise<void> {
  console.log('[motion-renderer] planning brand motion graphics...')

  let words
  try {
    words = await transcribeLocalFile(videoPath)
  } catch (e) {
    console.warn('[motion-renderer] transcription for motion graphics failed, skipping:', (e as Error).message)
    return
  }
  if (!words.length) {
    console.warn('[motion-renderer] no words transcribed, skipping motion graphics')
    return
  }

  const graphics = await planMotionGraphics(words, hook, cta, moodTag, scriptFormat)
  if (!graphics.length) {
    console.log('[motion-renderer] graphics plan returned nothing, skipping')
    return
  }

  const transcriptEnd = words[words.length - 1]?.end
  const duration = transcriptEnd && transcriptEnd > 0 ? transcriptEnd : await getVideoDuration(videoPath)
  const dimensions = await probeVideoDimensions(videoPath)

  let overlayPath: string | null = null
  try {
    overlayPath = await renderMotionGraphicsOverlay(outDir, variantId, graphics, duration, style, dimensions)
    const tmp = videoPath + '_mg.mp4'
    await run(
      `ffmpeg -y -i "${videoPath}" -i "${overlayPath}" ` +
      `-filter_complex "[0:v][1:v]overlay=0:0[outv]" ` +
      `-map "[outv]" -map 0:a? -c:v libx264 -preset fast -crf 20 -c:a copy -movflags +faststart "${tmp}"`,
      300_000,
    )
    if (fs.existsSync(tmp)) {
      fs.renameSync(tmp, videoPath)
      console.log('[motion-renderer] motion graphics composited')
    } else {
      console.warn('[motion-renderer] motion graphics composite produced no output, keeping original')
    }
  } catch (e) {
    console.warn('[motion-renderer] motion graphics overlay failed, keeping video without it:', (e as Error).message)
  } finally {
    if (overlayPath) { try { fs.unlinkSync(overlayPath) } catch { /* best-effort */ } }
  }
}

// Caption-only test path: downloads the raw source footage and burns in
// captions directly — no Submagic. For iterating on caption styles without
// spending a Submagic job on every test run.
async function renderCaptionTestOnly(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  outDir: string,
  moodTag?: string | null,
  scriptFormat?: string,
): Promise<void> {
  const STEPS = 2
  try {
    cleanTempFiles(outDir, variantId)
    const outputPath = path.join(outDir, `${variantId}.mp4`)

    await setVariantProgress(jobId, variantId, 1, STEPS, 'Downloading footage')
    await downloadFile(sourceUrl, outputPath)

    await setVariantProgress(jobId, variantId, 2, STEPS, 'Generating karaoke captions')
    await addNativeCaptions(outputPath, moodTag ?? null, scriptFormat)

    console.log('[motion-renderer] caption test output ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

// Motion-graphics-only test path: downloads the raw source footage and runs
// the Remotion overlay directly on it — no Submagic. For iterating on
// graphics/styles without spending a Submagic job on every test run.
async function renderMotionGraphicsTestOnly(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  outDir: string,
  hook: string,
  cta: string,
  moodTag: string | null | undefined,
  scriptFormat: string | undefined,
  motionGraphicsStyle: 'minimal' | 'bold' | undefined,
  musicMode: MusicMode = DEFAULT_MUSIC_MODE,
): Promise<void> {
  const STEPS = 2 + (musicMode !== 'off' ? 1 : 0)
  try {
    cleanTempFiles(outDir, variantId)
    const outputPath = path.join(outDir, `${variantId}.mp4`)

    await setVariantProgress(jobId, variantId, 1, STEPS, 'Preparing footage')
    const compressedPath = await getLocalCompressedSource(jobId, sourceUrl, outDir)
    fs.copyFileSync(compressedPath, outputPath)

    await setVariantProgress(jobId, variantId, 2, STEPS, 'Adding brand motion graphics')
    await addMotionGraphics(outputPath, hook, cta, moodTag ?? null, scriptFormat, outDir, variantId, motionGraphicsStyle)

    if (musicMode !== 'off') {
      await setVariantProgress(jobId, variantId, 3, STEPS, 'Adding background music')
      await mixBackgroundMusic(outputPath, hook, moodTag ?? null, scriptFormat, musicMode)
    }

    console.log('[motion-renderer] motion graphics test output ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

// Polls a Submagic project to completion and returns its download URL. Used by
// the submagicCutOnly path below, which needs to await the result inline
// (unlike the separate fire-and-forget poll loop the plain Submagic variants
// use from the API route).
async function pollSubmagicUntilReady(projectId: string): Promise<string> {
  const INTERVAL_MS = 8_000
  const MAX_ATTEMPTS = 75 // ~10 minutes
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, INTERVAL_MS))
    const result = await pollSubmagicJob(projectId).catch(() => null)
    if (!result || result.status === 'processing') continue
    if (result.status === 'ready' && result.downloadUrl) return result.downloadUrl
    throw new Error(result.error ?? 'Submagic job failed')
  }
  throw new Error('Submagic job timed out after 10 minutes')
}

export interface RenderVariantOptions {
  hook: string
  cta: string
  brollDriveUrl?: string
  nativeCaptions?: boolean
  moodTag?: string | null
  scriptFormat?: string
  captionTestOnly?: boolean
  motionGraphicsTestOnly?: boolean  // skip Submagic entirely; raw footage + Remotion graphics only
  motionGraphics?: boolean
  motionGraphicsStyle?: 'minimal' | 'bold'
  submagicTemplateName?: string    // premium caption template
  submagicMagicBrolls?: boolean    // Submagic's own stock B-roll
  submagicMagicZooms?: boolean     // Submagic's own zoom-ins
  musicMode?: MusicMode            // per-render music choice (smart / off); defaults to 'smart'
}

// Main pipeline (no Descript anywhere in this app):
//   our-v1/v2/v3: handled entirely by the API route's Submagic branch (tool: 'submagic')
//   our-v4/v5 (this function): Submagic for cut + clean + captions + B-roll, then Remotion
//     graphics on top -- the same transcribe -> plan -> render (ProRes 4444 alpha) -> composite
//     pattern as OVRHAUL's content engine.
async function renderSmartCinematic(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  outDir: string,
  opts: RenderVariantOptions,
): Promise<void> {
  const { hook, cta, brollDriveUrl, nativeCaptions, moodTag, scriptFormat, motionGraphics, motionGraphicsStyle, submagicTemplateName, submagicMagicBrolls, submagicMagicZooms, musicMode = DEFAULT_MUSIC_MODE } = opts

  const musicStep = MUSIC_ENABLED && musicMode !== 'off' ? 1 : 0
  const STEPS = 1 + (brollDriveUrl ? 1 : 0) + (nativeCaptions ? 1 : 0) + (motionGraphics ? 1 : 0) + musicStep
  let step = 1
  try {
    cleanTempFiles(outDir, variantId)
    const outputPath = path.join(outDir, `${variantId}.mp4`)

    await setVariantProgress(jobId, variantId, step++, STEPS, 'Editing with Submagic')
    const submagicSourceUrl = await getSubmagicSourceUrl(jobId, sourceUrl)
    const projectId = await submitSubmagicJob(submagicSourceUrl, {
      title: `${variantId}-${jobId.slice(0, 8)}`,
      templateName: submagicTemplateName,
      magicBrolls: submagicMagicBrolls ?? false,
      magicBrollsPercentage: submagicMagicBrolls ? 16 : undefined,
      magicZooms: submagicMagicZooms ?? false,
      // cleanAudio requires a Submagic plan tier this account doesn't have yet
      // ("Clean audio requires a higher plan") -- confirmed by a live test
      // failing on this exact validation error. Re-enable once upgraded:
      // cleanAudio: true,
      cleanAudio: false,
      removeBadTakes: true,
      removeSilencePace: 'natural',
    })
    const captionedUrl = await pollSubmagicUntilReady(projectId)
    console.log('[motion-renderer] Submagic edit done')
    await downloadFile(captionedUrl, outputPath)

    if (brollDriveUrl) {
      await setVariantProgress(jobId, variantId, step++, STEPS, 'Inserting custom B-roll')
      await insertCustomBRoll(outputPath, brollDriveUrl, hook, cta)
    }

    if (nativeCaptions) {
      await setVariantProgress(jobId, variantId, step++, STEPS, 'Generating karaoke captions')
      await addNativeCaptions(outputPath, moodTag ?? null, scriptFormat)
    }

    if (motionGraphics) {
      await setVariantProgress(jobId, variantId, step++, STEPS, 'Adding brand motion graphics')
      await addMotionGraphics(outputPath, hook, cta, moodTag ?? null, scriptFormat, outDir, variantId, motionGraphicsStyle)
    }

    if (MUSIC_ENABLED && musicMode !== 'off') {
      await setVariantProgress(jobId, variantId, step++, STEPS, 'Adding background music')
      await mixBackgroundMusic(outputPath, hook, moodTag ?? null, scriptFormat, musicMode)
    }

    console.log('[motion-renderer] output ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

export function startSingleVariant(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  opts: RenderVariantOptions,
) {
  const key = jobId + ':' + variantId
  if (active.has(key)) return
  active.add(key)

  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  fs.mkdirSync(outDir, { recursive: true })

  // When custom B-roll is provided, disable Submagic's own stock B-roll to avoid stacking.
  const effectiveOpts: RenderVariantOptions = opts.brollDriveUrl
    ? { ...opts, submagicMagicBrolls: false }
    : opts

  // Caption/motion-graphics test runs skip Submagic (no round-trip), but keep
  // the same safety timeout in case transcription, Remotion, or FFmpeg ever hangs.
  const isTestOnly = opts.captionTestOnly || opts.motionGraphicsTestOnly
  const TIMEOUT_MS = isTestOnly ? 5 * 60 * 1000 : 30 * 60 * 1000
  const timeoutId = setTimeout(() => {
    console.error(`[motion-renderer] variant ${variantId} timed out`)
    markVariant(jobId, variantId, 'failed', null, 'Render timed out').catch(() => {})
  }, TIMEOUT_MS)

  const launch = async () => {
    if (opts.captionTestOnly) {
      await renderCaptionTestOnly(jobId, variantId, sourceUrl, outDir, opts.moodTag, opts.scriptFormat)
      return
    }
    if (opts.motionGraphicsTestOnly) {
      await renderMotionGraphicsTestOnly(jobId, variantId, sourceUrl, outDir, opts.hook, opts.cta, opts.moodTag, opts.scriptFormat, opts.motionGraphicsStyle, opts.musicMode)
      return
    }
    await renderSmartCinematic(jobId, variantId, sourceUrl, outDir, effectiveOpts)
  }

  launch()
    .catch(e => console.error('[motion-renderer] startSingleVariant fatal:', e))
    .finally(() => {
      clearTimeout(timeoutId)
      active.delete(key)
    })
}
