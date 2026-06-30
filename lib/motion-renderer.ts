import { ensureFfmpegOnPath } from './ffmpeg-env'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createClient } from '@supabase/supabase-js'
import { uploadToStorage } from './storage'
import type { VideoVariant, MusicMode } from './video-pipeline'
import { submitSubmagicJob, pollSubmagicJob, DEFAULT_MUSIC_MODE } from './video-pipeline'
import { transcribeLocalFile, generateASSCaptions, writeASSFile, FONTS_DIR } from './caption-renderer'
import { getLibraryMusic } from './music-library'
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
//
// The raw download is dropped once compressed, so a finished job only keeps
// the smaller file on disk. If the compressed file already exists, skip
// straight to it instead of re-downloading the (now-deleted) raw file for
// nothing.
async function getLocalCompressedSource(
  jobId: string,
  sourceUrl: string,
  outDir: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true })
  const compressedPath = path.join(outDir, 'source-compressed.mp4')
  if (fs.existsSync(compressedPath)) return compressedPath

  // Local disk for this job may have been wiped (server restart/redeploy, an
  // old job revisited later) while the compressed copy still lives in R2 from
  // a previous run -- pull that back down instead of re-fetching from the
  // original Drive link, which may have gone stale or been revoked by then.
  if (process.env.R2_PUBLIC_URL) {
    try {
      const r2Url = `${process.env.R2_PUBLIC_URL}/${jobId}/source-compressed.mp4`
      await downloadFile(r2Url, compressedPath, onProgress)
      return compressedPath
    } catch {
      // not in R2 yet (first run for this job) -- fall through to Drive
      try { if (fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath) } catch { /* best-effort */ }
    }
  }

  const rawLocalPath = await getSharedSourceFile(jobId, sourceUrl, outDir, onProgress)
  await onProgress?.(80, 'Compressing footage')
  const result = await compressSourceFile(rawLocalPath, outDir)
  await onProgress?.(95, 'Compressed footage ready')

  // Nothing else needs the raw file once it's compressed -- clear the
  // in-memory cache alongside the on-disk delete so a re-run never resolves
  // to a path that no longer exists.
  try { if (fs.existsSync(rawLocalPath)) fs.unlinkSync(rawLocalPath) } catch { /* best-effort */ }
  sourceFileCache.delete(jobId)
  return result
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
  // Back the compressed copy up to R2 right away rather than waiting for the
  // first Submagic variant to start -- so the job survives a server restart
  // without needing to re-pull from Drive, and every variant just reuses this
  // cached upload (getSubmagicSourceUrl) instead of re-uploading.
  await onProgress?.(97, 'Backing up footage to storage')
  await getSubmagicSourceUrl(jobId, sourceUrl)
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
  const { hook, cta, nativeCaptions, moodTag, scriptFormat, motionGraphics, motionGraphicsStyle, submagicTemplateName, submagicMagicBrolls, submagicMagicZooms, musicMode = DEFAULT_MUSIC_MODE } = opts

  const musicStep = MUSIC_ENABLED && musicMode !== 'off' ? 1 : 0
  const STEPS = 1 + (nativeCaptions ? 1 : 0) + (motionGraphics ? 1 : 0) + musicStep
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
    await renderSmartCinematic(jobId, variantId, sourceUrl, outDir, opts)
  }

  launch()
    .catch(e => console.error('[motion-renderer] startSingleVariant fatal:', e))
    .finally(() => {
      clearTimeout(timeoutId)
      active.delete(key)
    })
}
