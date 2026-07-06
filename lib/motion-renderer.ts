import { ensureFfmpegOnPath } from './ffmpeg-env'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createClient } from '@supabase/supabase-js'
import { uploadToStorage, deleteStorageKey } from './storage'
import type { MusicMode } from './video-pipeline'
import { submitSubmagicJob, pollSubmagicJob, DEFAULT_MUSIC_MODE, resolveCaptionTemplate, pickPremiumTemplates, VARIANT_DEFINITIONS } from './video-pipeline'
import type { VideoVariant } from './video-pipeline'
import { transcribeLocalFile, generateASSCaptions, writeASSFile, FONTS_DIR } from './caption-renderer'
import { getLibraryMusic } from './music-library'
import { planMotionGraphics, type MotionGraphic } from './graphics-plan'
import { analyzeVideoFile, FALLBACK_PROFILE, type ContentProfile } from './video-analysis'
import { VARIANT_SPECS, resolveSubmagicSettings } from './variant-specs'
import { patchVariant } from './job-lock'
import { rendersDir } from './paths'
import { buildEditPlan, planViralCaptions, planEubankCaptions, planInsetSegments, type CaptionPage } from './edit-plan'
import { cleanAudioInPlace, detectSilences } from './audio-clean'
import { buildRenderKit, planSfxCues, pickTransitionSmart, transitionSoundFamily } from './render-kit'
import { stageSfxCues } from './sfx-stage'
import { getSfx, probeSfxTiming, type TransitionStyle, type SfxCategory } from './sound-effects'
import { planBrollSlots, resolveBrollMedia, resolveExtraImages, avoidCaptionCollisions, applyViralCoverTreatment } from './broll'
import { buildSubjectMatte, type SubjectMatte } from './subject-matte'
import { planKoeGraphics, planKoeSfxCues, type KoeGraphic } from './koe-graphics'
import { planEubankGraphics, planEubankSfxCues, type EubankGraphic } from './eubank-graphics'

// Patch PATH to the bundled ffmpeg/ffprobe before any exec runs. Called
// explicitly (not a bare side-effect import) so the bundler can't drop it.
ensureFfmpegOnPath()

const active = new Set<string>()

const MUSIC_ENABLED = true

// ── Process-wide state, pinned on globalThis ─────────────────────────────────
// In `next dev`, every hot reload creates a FRESH copy of this module — plain
// module-level queues/locks/caches fork silently, so two renders started
// across a reload stop being serialized against each other and dedup caches
// stop deduping. globalThis survives reloads; module code does not.
const g = globalThis as unknown as {
  __olySourceFiles?: Map<string, Promise<string>>
  __olySubmagicSources?: Map<string, Promise<string>>
  __olyContentProfiles?: Map<string, Promise<ContentProfile>>
  __olySubmagicFinalizes?: Set<string>
  __olyAudioQueue?: Promise<unknown>
  __olyRemotionQueue?: Promise<unknown>
}

const sourceFileCache = (g.__olySourceFiles ??= new Map<string, Promise<string>>())

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

const submagicSourceCache = (g.__olySubmagicSources ??= new Map<string, Promise<string>>())

// Submagic-using variants (our-v1 through our-v5) always get the compressed,
// normalized copy uploaded to Storage -- never the raw Drive file. Cached
// per job so every Submagic variant shares one upload. Throws rather than
// silently falling back to the raw Drive link, since a silent fallback
// caused real confusion before.
export async function getSubmagicSourceUrl(jobId: string, rawSourceUrl: string): Promise<string> {
  const cached = submagicSourceCache.get(jobId)
  if (cached) return cached

  const promise = (async () => {
    // A previous run may have already uploaded the compressed source — reuse
    // that URL directly instead of downloading + re-uploading ~50MB. Matters
    // most on Vercel, where this runs inside a request handler.
    if (process.env.R2_PUBLIC_URL) {
      const existingUrl = `${process.env.R2_PUBLIC_URL}/${jobId}/source-compressed.mp4`
      try {
        const head = await fetch(existingUrl, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
        if (head.ok) return existingUrl
      } catch { /* not there or unreachable — fall through to the full path */ }
    }
    const outDir = rendersDir(jobId)
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

// The compressed source in R2 is only needed while variants render (Submagic
// downloads it from there). Once every started variant is done, drop it to
// free storage. The in-memory cache must be cleared alongside, otherwise a
// later re-render would reuse the now-deleted URL instead of re-uploading.
// Re-renders recover via getLocalCompressedSource: local disk copy first,
// then the original Drive link.
export async function releaseJobSource(jobId: string): Promise<void> {
  submagicSourceCache.delete(jobId)
  await deleteStorageKey(`${jobId}/source-compressed.mp4`)
}

const contentProfileCache = (g.__olyContentProfiles ??= new Map<string, Promise<ContentProfile>>())

// One Gemini read of the footage per job, cached on the job row and shared by
// every variant (see lib/video-analysis.ts + lib/VARIANTS-V2-PLAN.md). Idempotent
// and best-effort: returns the cached profile if present, otherwise analyzes the
// compressed source once and stores it. Any failure resolves to FALLBACK_PROFILE
// so a render never blocks on analysis. Grounds the text fields in the ElevenLabs
// transcript (reused/cached on the same `transcript` column as before).
export async function ensureContentProfile(jobId: string, sourceUrl: string): Promise<ContentProfile> {
  const inFlight = contentProfileCache.get(jobId)
  if (inFlight) return inFlight

  const promise = (async (): Promise<ContentProfile> => {
    const db = supabaseAdmin()

    // Read the cached profile + transcript. If the content_profile column isn't on
    // this project yet (migration not applied), that select errors — fall back to
    // reading transcript alone so we still reuse it, and rely on the in-process
    // cache (contentProfileCache) for de-duping within this server.
    let cachedProfile: ContentProfile | null = null
    let transcript: string | null = null
    const full = await db.from('video_jobs').select('content_profile, transcript').eq('id', jobId).single()
    if (!full.error && full.data) {
      cachedProfile = (full.data.content_profile as ContentProfile | null) ?? null
      transcript = (full.data.transcript as string | null) ?? null
    } else {
      const t = await db.from('video_jobs').select('transcript').eq('id', jobId).single()
      transcript = (t.data?.transcript as string | null) ?? null
    }

    if (cachedProfile) return cachedProfile

    try {
      const outDir = rendersDir(jobId)
      const localPath = await getLocalCompressedSource(jobId, sourceUrl, outDir)

      // Transcribe once if we don't have it yet, from the LOCAL compressed file
      // (transcribeLocalFile) rather than the cloud URL — the cloud-URL path
      // (transcribeVideo) has been failing with a body-parse error, while the
      // local upload path is what the caption/graphics steps already use reliably.
      if (!transcript) {
        try {
          const words = await transcribeLocalFile(localPath)
          transcript = words.map(w => w.text).join(' ').trim() || null
          if (transcript) await db.from('video_jobs').update({ transcript }).eq('id', jobId)
        } catch (e) {
          console.warn('[content-profile] transcription failed, analyzing video only:', (e as Error).message)
        }
      }

      const profile = await analyzeVideoFile(localPath, { transcript: transcript ?? undefined })
      // Only persist a REAL profile — never cache the neutral fallback, so a
      // transient Gemini failure doesn't get baked in and can be re-attempted.
      if (profile !== FALLBACK_PROFILE) {
        const { error: upErr } = await db.from('video_jobs').update({ content_profile: profile }).eq('id', jobId)
        if (upErr) console.warn(`[content-profile] not persisted (add the content_profile column to enable caching): ${upErr.message}`)
      }
      return profile
    } catch (e) {
      console.warn('[content-profile] analysis failed, using fallback profile:', (e as Error).message)
      return FALLBACK_PROFILE
    }
  })()

  contentProfileCache.set(jobId, promise)
  try {
    const result = await promise
    // Don't let a transient failure poison the in-memory cache — drop it so the
    // next call (or next variant) re-attempts instead of reusing the fallback.
    if (result === FALLBACK_PROFILE) contentProfileCache.delete(jobId)
    return result
  } catch {
    contentProfileCache.delete(jobId)
    return FALLBACK_PROFILE
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
  const outDir = rendersDir(jobId)
  const localPath = await getLocalCompressedSource(jobId, sourceUrl, outDir, onProgress)
  // Back the compressed copy up to R2 right away rather than waiting for the
  // first Submagic variant to start -- so the job survives a server restart
  // without needing to re-pull from Drive, and every variant just reuses this
  // cached upload (getSubmagicSourceUrl) instead of re-uploading.
  // BEST-EFFORT: the local file is what variants actually need to start.
  // If the network flakes here (e.g. TLS "bad record mac" mid-upload), the
  // job must NOT fail — Submagic variants re-attempt this exact upload when
  // they start (the source-URL cache drops rejected promises).
  await onProgress?.(97, 'Backing up footage to storage')
  try {
    await getSubmagicSourceUrl(jobId, sourceUrl)
  } catch (e) {
    console.warn(`[motion-renderer] source backup to R2 failed for job=${jobId} — continuing with local copy; Submagic variants will retry the upload:`, (e as Error).message)
  }
  // Analyze the footage once now, while the compressed file is warm on disk, so
  // the content profile is ready before any variant starts. Best-effort — never
  // block source prep on it.
  await onProgress?.(99, 'Analyzing footage')
  ensureContentProfile(jobId, sourceUrl).catch(() => { /* best-effort; falls back at read time */ })
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
  await patchVariant(
    supabaseAdmin(),
    jobId,
    variantId,
    { status, download_url: downloadUrl, preview_url: downloadUrl, error, progress: null },
    { completeWhenAllDone: true },
  )
}

async function setVariantProgress(
  jobId: string,
  variantId: string,
  step: number,
  total: number,
  label: string
): Promise<void> {
  try {
    await patchVariant(supabaseAdmin(), jobId, variantId, { progress: { step, total, label } })
  } catch { /* best-effort */ }
}

// Finished videos always upload to a FIXED path per variant (finished/<job>/<variant>.mp4),
// so a re-render overwrites the same URL. Browsers and the R2/Cloudflare CDN then keep
// serving the old cached copy. A per-render version tag forces a fresh URL each time so
// the page (and CDN) never shows a stale clip after a retry.
function versioned(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
}

async function finishVariant(
  jobId: string,
  variantId: string,
  localPath: string
) {
  const fileName = path.basename(localPath)
  const r2Url = await uploadToStorage(localPath, fileName, jobId, 'finished').catch((e) => {
    console.warn(`[motion-renderer] finished-video R2 upload failed, falling back to local URL:`, (e as Error).message)
    return null
  })

  let url: string
  if (r2Url) {
    url = versioned(r2Url)
  } else {
    // R2 failed — copy the file into public/renders/ so the /renders/ URL is
    // actually reachable. If this copy also fails, mark the variant failed rather
    // than storing a dead path that will ENOENT at publish time.
    const pubDir = rendersDir(jobId)
    const pubPath = path.join(pubDir, fileName)
    try {
      fs.mkdirSync(pubDir, { recursive: true })
      if (localPath !== pubPath) fs.copyFileSync(localPath, pubPath)
      url = versioned(`/renders/${jobId}/${fileName}`)
    } catch (copyErr) {
      await markVariant(jobId, variantId, 'failed', null, `Storage upload failed and local fallback failed: ${(copyErr as Error).message}`)
      return
    }
  }

  await markVariant(jobId, variantId, 'ready', url, null)
}

// Rebuilds the library-music context for a Submagic variant from the DB —
// the status route's finisher calls arrive without the render's in-memory
// context, and a race winner must never produce a music-less video. Returns
// null for variants that shouldn't get library music (no spec / music off).
async function libraryMusicContextFromDb(
  jobId: string,
  variantId: string,
): Promise<{ hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null> {
  const spec = VARIANT_SPECS[variantId]
  if (!spec?.useMusic) return null
  try {
    const db = supabaseAdmin()
    const { data: job } = await db.from('video_jobs').select('script_id, content_profile, variants').eq('id', jobId).single()
    if (!job) return null
    const variant = (job.variants as { id: string; music_mode?: string }[] | null)?.find(v => v.id === variantId)
    if (variant?.music_mode === 'off') return null
    let hook = ''
    let moodTag: string | null = null
    let scriptFormat: string | undefined
    if (job.script_id) {
      const { data: s } = await db.from('scripts').select('hook, mood_tag, filming_plan').eq('id', job.script_id).single()
      hook = (s?.hook as string | null) ?? ''
      moodTag = (s?.mood_tag as string | null) ?? null
      scriptFormat = (s?.filming_plan as { script_format?: string } | null)?.script_format
    }
    return { hook, moodTag, scriptFormat, profile: (job.content_profile as ContentProfile | null) ?? null, transcript: null }
  } catch {
    return null
  }
}

// One finisher at a time per variant: both the background poll loop
// (start-variant route) and the status route can notice a Submagic project
// completing — whichever gets here first does the retrieval + DB write and
// the other is a no-op. Without this, the status route used to write
// Submagic's EXPIRING hosted URL over the permanent R2 URL, which is why
// finished previews sometimes went black hours later.
const activeSubmagicFinalizes = (g.__olySubmagicFinalizes ??= new Set<string>())

export async function finalizeSubmagicVariant(
  jobId: string,
  variantId: string,
  submagicDownloadUrl: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null,
): Promise<void> {
  const key = `${jobId}:${variantId}`
  if (activeSubmagicFinalizes.has(key)) return
  activeSubmagicFinalizes.add(key)
  try {
    const musicCtx = music ?? await libraryMusicContextFromDb(jobId, variantId)
    let finalUrl: string
    try {
      finalUrl = await retrieveAndStoreSubmagicResult(jobId, variantId, submagicDownloadUrl, musicCtx)
      console.log(`[motion-renderer] Submagic result retrieved into Olympus storage for ${key}`)
    } catch (e) {
      // Fall back to Submagic's own URL rather than failing the variant —
      // still playable right now, just not pulled into our own storage.
      console.warn(`[motion-renderer] could not retrieve Submagic result for ${key}, keeping their hosted URL:`, (e as Error).message)
      finalUrl = submagicDownloadUrl
    }
    await patchVariant(
      supabaseAdmin(),
      jobId,
      variantId,
      { status: 'ready', download_url: finalUrl, preview_url: finalUrl, error: null, progress: null },
      { completeWhenAllDone: true },
    )
  } finally {
    activeSubmagicFinalizes.delete(key)
  }
}

// The ffmpeg-heavy finishing steps (voice polish, loudness measurement, music
// mix, scene detection, SFX) run ONE variant at a time. Without this, several
// Submagic variants finishing together each spin up multiple full-decode
// ffmpeg passes in parallel — alongside a headless-Chrome Remotion render —
// and the machine thrashes hard enough that renders die on delayRender
// timeouts (fonts taking 4+ minutes to "load").
function enqueueAudioPostSteps<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__olyAudioQueue ?? Promise.resolve()
  const p = prev.then(fn, fn)
  g.__olyAudioQueue = p.catch(() => undefined)
  return p
}

// Pulls a finished Submagic render down to a local file instead of just
// linking to Submagic's hosted URL, so the video survives even if Submagic
// later expires or removes the file from their end.
export async function retrieveAndStoreSubmagicResult(
  jobId: string,
  variantId: string,
  downloadUrl: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null,
): Promise<string> {
  const outDir = rendersDir(jobId)
  fs.mkdirSync(outDir, { recursive: true })
  const localPath = path.join(outDir, `${variantId}_submagic.mp4`)
  await downloadFile(downloadUrl, localPath)

  await enqueueAudioPostSteps(async () => {
    // Voice polish on the dialogue BEFORE music goes under it: Auphonic
    // denoise/level (ElevenLabs isolation as fallback) evens the voice out so
    // the voice-aware music mix below can trust its level. Submagic's own
    // cleaner is skipped — this file just came out of Submagic with cleanAudio
    // already applied, and re-running it would spend another render for nothing.
    try {
      const cleaner = await cleanAudioInPlace(localPath, { skipSubmagic: true })
      if (cleaner !== 'none') console.log(`[motion-renderer] post-Submagic voice polish via ${cleaner} for ${jobId}:${variantId}`)
    } catch (e) {
      console.warn('[motion-renderer] post-Submagic voice polish failed, keeping original audio:', (e as Error).message)
    }

    // Add our own library music on top of the finished Submagic video, so v1-v3
    // share the exact v4/v5 music system (mood match, best-part offset, ducking,
    // -13 LUFS). Best-effort — a music failure must never lose the rendered video.
    if (music) {
      try {
        await mixBackgroundMusic(localPath, music.hook, music.moodTag, music.scriptFormat, 'smart', music.profile ?? null, music.transcript ?? null, variantId)
        console.log(`[motion-renderer] mixed library music onto Submagic result ${jobId}:${variantId}`)
      } catch (e) {
        console.warn('[motion-renderer] post-Submagic music mix failed, keeping video without it:', (e as Error).message)
      }
    }

    // Transition whooshes on Submagic's own cuts. Submagic has no SFX API, so the
    // cuts are recovered from the finished file via scene detection and a whoosh
    // is peak-aligned onto each one — same sound grammar as the Remotion variants.
    try {
      await mixTransitionSfx(localPath, music?.profile ?? null)
    } catch (e) {
      console.warn('[motion-renderer] transition SFX pass failed, keeping video without it:', (e as Error).message)
    }
  })

  // Push finished Submagic result to R2 finished/ folder so it's always
  // available for publishing even if local disk is wiped.
  const fileName = path.basename(localPath)
  const r2Url = await uploadToStorage(localPath, fileName, jobId, 'finished').catch((e) => {
    console.warn(`[motion-renderer] finished-video R2 upload failed, falling back to local URL:`, (e as Error).message)
    return null
  })
  return versioned(r2Url ?? `/renders/${jobId}/${fileName}`)
}

function cleanTempFiles(outDir: string, variantId: string): void {
  for (const suffix of ['.mp4', '_captions.ass', '_mx.mp4', '_broll.mp4', '_mg.mp4']) {
    const p = path.join(outDir, `${variantId}${suffix}`)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch { /* best-effort */ }
  }
}

// ── Transition SFX on detected cuts (Submagic path) ──────────────────────────
// The Submagic variants are edited inside Submagic, so we never see their cut
// list. Recover it from the finished video with ffmpeg scene detection, then
// mix a whip-whoosh whose loudest instant lands exactly on each cut — the same
// peak-alignment trick the Remotion variants use (lib/sfx-stage.ts).

async function detectSceneCuts(videoPath: string): Promise<number[]> {
  const stderr = await new Promise<string>((resolve, reject) => {
    let buf = ''
    const proc = exec(
      `ffmpeg -i "${videoPath}" -vf "select='gt(scene,0.30)',showinfo" -f null -`,
      { timeout: 180_000, maxBuffer: 256 * 1024 * 1024 },
      (err) => (err ? reject(new Error(buf.slice(-400) || err.message)) : resolve(buf)),
    )
    proc.stderr?.on('data', (d) => { buf += String(d) })
  })
  const times: number[] = []
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const t = parseFloat(m[1])
    if (Number.isFinite(t)) times.push(t)
  }
  return times
}

async function mixTransitionSfx(videoPath: string, profile: ContentProfile | null = null): Promise<void> {
  const duration = await getVideoDuration(videoPath)

  // Keep cuts away from the edges and at least 1.5s apart; cap the count so a
  // jump-cut-heavy edit doesn't turn into a whoosh barrage.
  const MIN_GAP = 1.5
  const MAX_CUTS = 10
  const raw = await detectSceneCuts(videoPath)
  const cuts: number[] = []
  for (const t of raw) {
    if (t < 1 || t > duration - 1) continue
    if (cuts.length && t - cuts[cuts.length - 1] < MIN_GAP) continue
    cuts.push(t)
    if (cuts.length >= MAX_CUTS) break
  }
  if (!cuts.length) {
    console.log('[motion-renderer] no scene cuts detected — skipping transition SFX')
    return
  }

  // Same sound grammar as the Remotion variants (lib/render-kit.ts): pick a
  // transition identity for THIS render — weighted by the footage's energy —
  // and draw the whoosh pool from that style's sound family. A fresh style
  // pick plus a shuffled pool means two renders of the same script never
  // sound alike, and round-robin keeps neighboring cuts on different files.
  const style = pickTransitionSmart(profile)
  const categories = [...new Set<SfxCategory>([...transitionSoundFamily(style), 'whoosh-airy'])]
  const pool: Array<{ path: string; peakSec: number }> = []
  for (const cat of categories) {
    for (const take of [0, 1]) {
      const p = await getSfx(cat, take)
      if (!p || pool.some(e => e.path === p)) continue
      try { pool.push({ path: p, peakSec: (await probeSfxTiming(p)).peakSec }) } catch { /* skip */ }
    }
  }
  if (!pool.length) return
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  // Back-time each cue so its file's PEAK lands on the cut, then delay-mix all
  // instances over the existing audio. Each cut gets its own input (the files
  // are ~1s mp3s, so repeated inputs are cheap and keep the filter graph
  // simple). normalize=0 keeps the voice/music level. A light per-cue volume
  // wobble stops even a repeated file from reading as a copy-paste.
  const inputs = cuts.map((_, i) => `-i "${pool[i % pool.length].path}"`).join(' ')
  const chains = cuts.map((t, i) => {
    const ms = Math.max(0, Math.round((t - pool[i % pool.length].peakSec) * 1000))
    const vol = (0.3 + Math.random() * 0.08).toFixed(2)
    return `[${i + 1}:a]adelay=${ms}|${ms},volume=${vol}[s${i}]`
  }).join(';')
  const mixIn = cuts.map((_, i) => `[s${i}]`).join('')
  const tmp = videoPath + '_sfx.mp4'

  await run(
    `ffmpeg -y -i "${videoPath}" ${inputs} ` +
    `-filter_complex "${chains};[0:a]${mixIn}amix=inputs=${cuts.length + 1}:duration=first:normalize=0[out]" ` +
    `-map 0:v -map "[out]" -c:v copy -c:a aac -b:a 192k -movflags +faststart "${tmp}"`,
    300_000
  )
  if (fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
    fs.renameSync(tmp, videoPath)
    console.log(`[motion-renderer] transition SFX on ${cuts.length} cut${cuts.length === 1 ? '' : 's'}, style=${style} (${cuts.map(t => t.toFixed(1)).join(', ')}s)`)
  } else {
    try { fs.unlinkSync(tmp) } catch { /* best-effort */ }
  }
}

// ── Background music from the curated library ────────────────────────────────

// Integrated loudness (LUFS) of a file's first audio stream via ebur128.
// Returns null when unmeasurable (no audio stream, ffmpeg error) — callers
// fall back to fixed levels rather than failing the mix.
async function measureIntegratedLoudness(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    exec(
      `ffmpeg -hide_banner -nostats -i "${filePath}" -map a:0 -af ebur128 -f null -`,
      { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
      (err, _out, stderr) => {
        if (err) return resolve(null)
        // The summary block at the end holds the final integrated value; per-
        // frame lines also print "I:" so take the LAST match.
        const matches = String(stderr ?? '').match(/I:\s*(-?[\d.]+)\s*LUFS/g)
        if (!matches?.length) return resolve(null)
        const last = matches[matches.length - 1].match(/(-?[\d.]+)/)
        resolve(last ? parseFloat(last[1]) : null)
      }
    )
  })
}

// Picks a mood-matched track from the creator's own library, starts it at the
// detected best part (chorus/drop), and mixes it under the voice: EQ-carve the
// vocal band, light sidechain duck so the music stays present, then master the
// whole thing to -13 LUFS / -1.5 dBTP (short-form loudness). mode 'off' = no
// music. Library files are the creator's own and are never deleted.
export async function mixBackgroundMusic(
  videoPath: string,
  hook: string,
  moodTag: string | null,
  scriptFormat?: string,
  mode: MusicMode = DEFAULT_MUSIC_MODE,
  // Gemini's read of the footage (+ transcript) so the track is matched to what
  // the clip actually is, not just the typed mood tag. Optional — falls back to
  // script-only matching when absent.
  profile: ContentProfile | null = null,
  transcript: string | null = null,
  // Lets the matcher give each variant a distinct track from the ranked shortlist.
  variantId?: string,
): Promise<void> {
  if (mode === 'off') return
  const duration = await getVideoDuration(videoPath)

  const lib = await getLibraryMusic({ hook, moodTag, scriptFormat, profile, transcript, variantId })
  if (!lib) {
    console.warn('[motion-renderer] no library track available — skipping music for this render')
    return
  }
  const musicPath = lib.filePath
  // Start the music at its detected best part (chorus/drop). 0 = from the top.
  const startOffset = Math.max(0, lib.track.startOffset ?? 0)
  const ssArg = startOffset > 0 ? `-ss ${startOffset} ` : ''
  console.log(`[motion-renderer] using library track "${lib.track.title}" (${lib.track.categories.join('/')})${startOffset ? ` @ ${startOffset}s` : ''}`)

  // VOICE-AWARE leveling: measure how loud the dialogue in THIS video actually
  // is and place the music bed a fixed distance (18 LU) below it, instead of
  // trusting a constant that assumed studio-level voice. The duck trigger
  // scales with the voice too — a fixed threshold never fired on quiet takes,
  // which is exactly when music "covers the voice". Falls back to the audited
  // constants when measurement fails.
  const voiceI = await measureIntegratedLoudness(videoPath)
  const musicI = await measureIntegratedLoudness(musicPath)
  let bedVolume = 'volume=0.13'
  if (voiceI !== null && musicI !== null) {
    const gainDb = Math.max(-40, Math.min(0, voiceI - 18 - musicI))
    bedVolume = `volume=${gainDb.toFixed(1)}dB`
    console.log(`[motion-renderer] voice ${voiceI.toFixed(1)} LUFS, music ${musicI.toFixed(1)} LUFS -> bed gain ${gainDb.toFixed(1)} dB`)
  }
  const duckThreshold = voiceI !== null
    ? Math.min(0.08, Math.max(0.005, 10 ** ((voiceI - 8) / 20)))
    : 0.035

  // Fade in over 1.5s at start, fade out in the last 1.5s
  const fadeOutStart = Math.max(0, duration - 1.5).toFixed(2)
  const tmp = videoPath + '_mx.mp4'

  try {
    // loop → fade in/out → EQ-carve the vocal presence band (-5dB ~2.5kHz so
    // music never masks speech) → voice-relative bed level → DEEP, SMOOTH
    // sidechain duck (ratio 6, slow 700ms release) so music sits well under the
    // voice and stays down through a phrase instead of "pumping" back up in
    // every micro-gap → master to -14 LUFS / -1.5 dBTP.
    await run(
      `ffmpeg -y -i "${videoPath}" -stream_loop -1 ${ssArg}-i "${musicPath}" ` +
      `-filter_complex ` +
      `"[1:a]asetpts=N/SR/TB,afade=t=in:ss=0:d=1.5,afade=t=out:st=${fadeOutStart}:d=1.5,` +
      `equalizer=f=2500:width_type=q:w=1.4:g=-5,${bedVolume}[bgfade];` +
      `[bgfade][0:a]sidechaincompress=threshold=${duckThreshold.toFixed(4)}:ratio=6:attack=15:release=700[ducked];` +
      `[0:a][ducked]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[out]" ` +
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
  profile: ContentProfile | null = null,
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

  const graphics = await planMotionGraphics(words, hook, cta, moodTag, scriptFormat, profile)
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

    // v6 is the cheap test path (no Submagic), so it runs the Gemini analysis
    // itself — this makes it a full test of the content-aware graphics AND music
    // matching without spending a Submagic job.
    const profile = await ensureContentProfile(jobId, sourceUrl)

    await setVariantProgress(jobId, variantId, 2, STEPS, 'Adding brand motion graphics')
    await addMotionGraphics(outputPath, hook, cta, moodTag ?? null, scriptFormat, outDir, variantId, motionGraphicsStyle, profile)

    if (musicMode !== 'off') {
      await setVariantProgress(jobId, variantId, 3, STEPS, 'Adding background music')
      await mixBackgroundMusic(outputPath, hook, moodTag ?? null, scriptFormat, musicMode, profile, null, variantId)
    }

    console.log('[motion-renderer] motion graphics test output ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

// ── Remotion-only full edit (v4/v5/v6) ────────────────────────────────────────
// No Submagic anywhere: voice isolation (ElevenLabs), silence/retake cutting
// (edit-plan), captions, zooms, transitions, B-roll, event-driven SFX all
// render as ONE Remotion composition (ShortEdit). Music then mixes on top
// through the same library system every other variant uses.

// A Remotion render spawns a bundler + headless Chrome + compositor. Running
// several at once starves the machine — fonts hit their delayRender timeout
// and the compositor drops connections (ECONNRESET). So when multiple variants
// are started together, planning/B-roll/music still run in parallel but the
// render step itself goes through this queue, one at a time.
function enqueueRemotionRender<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__olyRemotionQueue ?? Promise.resolve()
  const p = prev.then(fn, fn)
  g.__olyRemotionQueue = p.catch(() => undefined)
  return p
}
async function renderRemotionEdit(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  outDir: string,
  opts: RenderVariantOptions,
): Promise<void> {
  const { hook, moodTag, scriptFormat, musicMode = DEFAULT_MUSIC_MODE } = opts
  const musicStep = MUSIC_ENABLED && musicMode !== 'off' ? 1 : 0
  const STEPS = 5 + musicStep
  const staged: string[] = []
  try {
    cleanTempFiles(outDir, variantId)
    const outputPath = path.join(outDir, `${variantId}.mp4`)

    await setVariantProgress(jobId, variantId, 1, STEPS, 'Preparing footage')
    const compressedPath = await getLocalCompressedSource(jobId, sourceUrl, outDir)
    const workPath = path.join(outDir, `${variantId}_isolated.mp4`)
    fs.copyFileSync(compressedPath, workPath)
    staged.push(workPath)
    const profile = await ensureContentProfile(jobId, sourceUrl)

    await setVariantProgress(jobId, variantId, 2, STEPS, 'Cleaning audio')
    await cleanAudioInPlace(workPath)

    // The render kit: the variant's FIXED identity (caption style, B-roll
    // flavor) plus smart-randomized style (transition weighted by footage
    // energy, shuffled B-roll/caption/zoom seeds) — so every rerun of the same
    // variant is a fresh take that still looks like that variant.
    const kit = buildRenderKit(variantId, profile)
    console.log(`[motion-renderer] kit for ${variantId}: captions=${kit.captionStyle} broll=${kit.brollMedia} transition=${kit.transitionStyle} seed=${kit.variation}`)

    // Transcribe AFTER cleaning — better audio, better word timings. Energy-
    // detected silences ride along as the second cut signal (word timings can
    // stretch across real pauses and hide them from gap-based cutting).
    await setVariantProgress(jobId, variantId, 3, STEPS, 'Planning cuts and captions')
    const words = await transcribeLocalFile(workPath)
    const silences = await detectSilences(workPath)
    const duration = await getVideoDuration(workPath)
    const dimensions = await probeVideoDimensions(workPath)

    // Pace, page length, and casing all come from the variant's template —
    // every variant shares this same engine underneath.
    const viral = kit.captionStyle === 'viral'
    const plan = await buildEditPlan(words, duration, profile, kit.variation, {
      pace: kit.pace,
      maxPageWords: kit.maxPageWords,
      caseStyle: kit.captionCase,
      silences,
    })
    if (viral) await planViralCaptions(plan.pages, profile, kit.variation)
    // Eubank (v4): semantic tone accents (green/red/gold), punch pages, and
    // face-aware position/alignment runs — see lib/V4-EUBANK-PLAN.md.
    if (kit.captionStyle === 'eubank') {
      await planEubankCaptions(plan.pages, profile, kit.variation)
    }
    // Julie reuses the same LLM accent picker, mapped onto plain word flags:
    // the reference accents a keyword on nearly every page, far denser than
    // the profile-emphasis heuristic alone provides.
    if (kit.captionStyle === 'julie') {
      await planViralCaptions(plan.pages, profile, kit.variation)
      for (const page of plan.pages) {
        if (page.accentRange) {
          for (let i = page.accentRange[0]; i <= page.accentRange[1]; i++) page.words[i].accent = true
        }
        // Strip the viral-only styling fields so the page renders as julie.
        // Behind-hook pages were parked at 'mid' for the matte look — julie
        // never stages a matte, so re-home them off the face first.
        if (page.behind) page.position = profile?.faceArea === 'lower' ? 'high' : 'low'
        delete page.accentRange
        delete page.accentFont
        delete page.accentColor
        delete page.behind
      }
    }

    // B-roll: plan slots against the EDITED timeline, then source real media
    // (Pexels when a key is set, keyless CC0 images otherwise). Best-effort —
    // zero resolved slots just means an uninterrupted talking head.
    // Template graphics plan FIRST — they're the template's signature, so stock
    // B-roll steers around them, never the other way around.
    let graphics: Array<KoeGraphic | EubankGraphic> = []
    if (kit.graphics === 'koe') {
      try {
        graphics = await planKoeGraphics(plan.editedWords, plan.editedDuration, profile)
      } catch (e) {
        console.warn('[motion-renderer] Koe graphics pass failed, rendering without them:', (e as Error).message)
      }
    }
    if (kit.graphics === 'eubank') {
      try {
        graphics = await planEubankGraphics(plan.editedWords, plan.editedDuration, profile)
      } catch (e) {
        console.warn('[motion-renderer] Eubank graphics pass failed, rendering without them:', (e as Error).message)
      }
    }

    await setVariantProgress(jobId, variantId, 4, STEPS, 'Finding B-roll')
    const cacheDir = path.join(REMOTION_DIR, 'public', 'edit-cache')
    const brollPrefix = `edit-cache/${variantId}-${jobId.slice(0, 8)}-broll`
    let broll: Awaited<ReturnType<typeof resolveBrollMedia>> = []
    if (kit.brollMedia !== 'none') {
      try {
        // The hook is a top-band overlay — B-roll can run under it, so it
        // never claims timeline from the cutaway planner.
        const graphicWindows = graphics
          .filter(g => g.kind !== 'hook')
          .map(g => ({ start: g.start, duration: g.duration }))
        const slots = await planBrollSlots(plan.editedWords, plan.editedDuration, profile, kit.variation, kit.brollMedia, kit.designedCards, graphicWindows)
        broll = await resolveBrollMedia(slots, path.join(REMOTION_DIR, 'public', brollPrefix), brollPrefix, kit.variation, kit.brollMedia)
        if (viral) {
          // Pages over covers go big/centered; pages under the designed poster
          // are dropped (the card carries its own headline).
          plan.pages = applyViralCoverTreatment(plan.pages, broll)
        } else {
          // Eubank layout system (the "One Shot" reference): B-roll slots
          // rotate through three treatments — full-screen cover (with its own
          // transition from the combo rotation), the SPLIT (footage slides to
          // the top 55%, media fills the bottom, captions ride the seam), and
          // the translucent PANEL over the speaker. Captions elsewhere hold
          // the chest band; only split windows move them (to the seam) and
          // covers lift them to the top third.
          if (kit.captionStyle === 'eubank') {
            const LAYOUTS: Array<'cover' | 'split' | 'panel'> = ['split', 'cover', 'panel', 'cover', 'split', 'panel']
            const COMBO: TransitionStyle[] = ['zoom', 'flash', 'whip', 'slide', 'blur']
            let combo = kit.variation
            // A single opaque-ish panel slides in on the side the face ISN'T.
            // A centered face has no safe side — but the CAROUSEL treatment
            // (2-3 translucent panels across the top, the reference's "bunch
            // of B-roll" moment) reads fine over anyone, so panel beats try to
            // become carousels first and only then fall back to covers.
            const panelSide: 'left' | 'right' | null =
              profile?.faceFraming === 'tight' ? null
              : profile?.faceSide === 'left' ? 'right'
              : profile?.faceSide === 'right' ? 'left'
              : null
            for (let bi = 0; bi < broll.length; bi++) {
              const b = broll[bi]
              if (b.layout !== 'cover') continue
              let pick = LAYOUTS[(bi + kit.variation) % LAYOUTS.length]
              if (pick === 'panel') {
                const extras = await resolveExtraImages(
                  b.query ?? 'city skyline golden hour',
                  path.join(REMOTION_DIR, 'public', brollPrefix),
                  brollPrefix,
                  `carousel-${bi}`,
                  2,
                  kit.variation,
                ).catch(() => [] as string[])
                if (extras.length >= 1) {
                  b.extraFiles = extras
                  b.from = 'top'
                  if (b.duration < 2.8) b.duration = 3.0
                } else if (panelSide) {
                  b.from = panelSide
                } else {
                  pick = 'cover'
                }
              }
              b.layout = pick
              if (pick === 'cover') b.transition = COMBO[combo++ % COMBO.length]
              // Splits hold longer than a flash cover — give them room.
              if (pick === 'split' && b.duration < 3) b.duration = Math.min(3.4, b.duration + 0.8)
            }
            // The split is the signature layout move — with 2+ cutaways, at
            // least one must be a split even when the rotation misses it.
            if (broll.length >= 1 && !broll.some(b => b.layout === 'split')) {
              const last = [...broll].reverse().find(b => b.layout === 'cover') ?? broll[broll.length - 1]
              last.layout = 'split'
              delete last.transition
              if (last.duration < 3) last.duration = Math.min(3.4, last.duration + 0.8)
            }
            // Overlap FRACTION, not overlap-at-all: a page that merely grazes
            // a split/cover window would otherwise carry the seam/top position
            // into the raw-footage beats around it — where 'mid' is the face.
            const overlapFrac = (p: { start: number; end: number }, b: { start: number; duration: number }) => {
              const overlap = Math.min(p.end, b.start + b.duration) - Math.max(p.start, b.start)
              return overlap / Math.max(p.end - p.start, 0.01)
            }
            for (const p of plan.pages) {
              if (broll.some(b => b.layout === 'split' && overlapFrac(p, b) >= 0.6)) {
                p.position = 'mid'   // the seam
              } else if (broll.some(b => b.layout === 'cover' && overlapFrac(p, b) >= 0.6)) {
                p.position = 'high'
              }
            }
          }
          avoidCaptionCollisions(plan.pages, broll)
        }
        broll.forEach(b => {
          if (b.file) staged.push(path.join(REMOTION_DIR, 'public', b.file))
          for (const f of b.extraFiles ?? []) staged.push(path.join(REMOTION_DIR, 'public', f))
        })
      } catch (e) {
        console.warn('[motion-renderer] B-roll pass failed, rendering without it:', (e as Error).message)
      }
    }

    // Caption pages under a TEXT-CARRYING graphic are dropped — the graphic
    // carries the words for that beat, like the references. Koe's title keeps
    // captions running (it has its own subtitle); every Eubank kind carries
    // text, so they all clear the band.
    const TEXT_GRAPHICS = new Set(['list', 'venn', 'notes', 'equation', 'crossout', 'cards', 'keyword'])
    if (graphics.length) {
      plan.pages = plan.pages.filter(p =>
        !graphics.some(g => TEXT_GRAPHICS.has(g.kind) && p.start < g.start + g.duration && p.end > g.start)
      )
    }

    // Inset-card beats (template-gated): keep captions on the shrunken footage,
    // but NOT at 'mid' — the card scales the frame toward center, which maps a
    // centered face to exactly the mid band (44-60%), so centering the caption
    // put it straight across the (shrunken) face. The face-safe home band lands
    // on the card's chest area instead, still reading as "on the footage".
    const insetTimes: Array<{ start: number; end: number }> = []
    if (kit.insets) {
      const insetHome: CaptionPage['position'] = profile?.faceArea === 'lower' ? 'high' : 'low'
      planInsetSegments(plan.segments, broll, plan.editedDuration, kit.variation)
      let offset = 0
      for (const seg of plan.segments) {
        const segStart = offset
        offset += seg.duration
        if (seg.frame !== 'inset') continue
        insetTimes.push({ start: segStart, end: segStart + seg.duration })
        for (const p of plan.pages) {
          if (p.start < segStart + seg.duration && p.end > segStart && !p.big) p.position = insetHome
        }
      }
    }

    // Stage assets into remotion/public so staticFile() can reach them.
    fs.mkdirSync(cacheDir, { recursive: true })
    const stagedVideoName = `edit-cache/${variantId}-${jobId.slice(0, 8)}.mp4`
    const stagedVideoPath = path.join(REMOTION_DIR, 'public', stagedVideoName)
    fs.copyFileSync(workPath, stagedVideoPath)
    staged.push(stagedVideoPath)

    // Hook matte (template-gated): lets the opening caption sit behind the
    // speaker. Best-effort — null just means the caption stays in front.
    let matte: SubjectMatte | null = null
    if (kit.textBehindHook && plan.pages.some(p => p.behind) && plan.segments.length) {
      matte = await buildSubjectMatte({
        sourcePath: workPath,
        srcStart: plan.segments[0].srcStart,
        durationSec: Math.min(2.8, plan.segments[0].duration),
        stageDir: cacheDir,
        publicPrefix: 'edit-cache',
        name: `${variantId}-${jobId.slice(0, 8)}-matte`,
      })
      if (matte) staged.push(path.join(REMOTION_DIR, 'public', matte.file))
    }

    // A 'behind' page only works while the matte actually plays — without one
    // (staging is best-effort, and some templates never gate it in) or past
    // its end, ShortEdit keeps the page ON TOP, where its forced 'mid' sits
    // straight across the face. Re-home those pages to the face-safe band.
    for (const p of plan.pages) {
      if (p.behind && (!matte || p.start >= matte.durationSec)) {
        delete p.behind
        p.position = profile?.faceArea === 'lower' ? 'high' : 'low'
      }
    }

    // Event-driven audio: plan the cues (motion whooshes, texture clicks, the
    // riser+hit build into the designed card), then stage the files and
    // peak-align every cue (lib/sfx-stage.ts). Best-effort — a cue whose sound
    // can't generate simply drops out.
    const cues = [
      ...planSfxCues(broll, plan.pages, kit.transitionStyle, kit.variation, insetTimes, viral ? 'viral' : 'standard'),
      ...(kit.graphics === 'koe' ? planKoeSfxCues(graphics as KoeGraphic[]) : []),
      ...(kit.graphics === 'eubank' ? planEubankSfxCues(graphics as EubankGraphic[]) : []),
    ].sort((a, b) => a.start - b.start)
    const sfx = await stageSfxCues(cues, path.join(REMOTION_DIR, 'public'))
    console.log(`[motion-renderer] ${sfx.length} SFX cue(s): ${cues.map(c => `${c.category}@${(c.peakAt ?? c.start).toFixed(1)}s`).join(', ') || 'none'}`)

    // Koe red-line tag: carries the CTA when it's short enough to read as a
    // tag (the reference's 'COMMENT "KOE"'), in the video's second half.
    const cta = opts.cta?.trim()
    const tag = kit.graphics === 'koe' && cta && cta.length <= 30 && plan.editedDuration > 14
      ? {
          line1: cta.toUpperCase(),
          start: Number((plan.editedDuration * 0.55).toFixed(2)),
          durationSec: Math.min(5, plan.editedDuration * 0.25),
        }
      : undefined

    const propsPath = path.join(outDir, `${variantId}_edit.json`)
    fs.writeFileSync(propsPath, JSON.stringify({
      videoFile: stagedVideoName,
      width: dimensions.width,
      height: dimensions.height,
      fps: 30,
      segments: plan.segments,
      pages: plan.pages,
      broll,
      transitionStyle: kit.transitionStyle,
      captionStyle: kit.captionStyle,
      matte: matte ?? undefined,
      graphics: graphics.length ? graphics : undefined,
      tag,
      grade: kit.grade,
      hookSpotlight: kit.hookSpotlight,
      handheld: kit.handheld,
      splits: broll.filter(b => b.layout === 'split').map(b => ({ start: b.start, end: b.start + b.duration })),
      faceArea: profile?.faceArea,
      sfx,
    }))
    staged.push(propsPath)

    await setVariantProgress(jobId, variantId, 5, STEPS, 'Waiting for render slot')
    await enqueueRemotionRender(async () => {
      await setVariantProgress(jobId, variantId, 5, STEPS, 'Rendering edit in Remotion')
      await run(
        // 360s delayRender timeout: on a busy machine (user apps + dev server +
        // the serialized audio post-steps), headless-Chrome startup + font
        // loads can crawl far past 120s and fail renders that would otherwise
        // succeed.
        `cd "${REMOTION_DIR}" && npx remotion render src/Root.tsx ShortEdit "${outputPath}" ` +
        `--props="${propsPath}" --codec=h264 --crf=19 --timeout=360000`,
        900_000,
      )
    })
    if (!fs.existsSync(outputPath)) throw new Error('Remotion render produced no output file')

    if (MUSIC_ENABLED && musicMode !== 'off') {
      await setVariantProgress(jobId, variantId, 6, STEPS, 'Adding background music')
      // Through the audio queue: this render finished, but the NEXT variant's
      // render may have just started — its Chrome must not fight three
      // loudness-measure/mix ffmpeg passes for the same cores.
      await enqueueAudioPostSteps(() =>
        mixBackgroundMusic(outputPath, hook, moodTag ?? null, scriptFormat, musicMode, profile, null, variantId)
      )
    }

    console.log('[motion-renderer] Remotion-only edit ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  } finally {
    for (const f of staged) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best-effort */ } }
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
  remotionEdit?: boolean            // Remotion-only FULL edit: cuts, captions, zooms, SFX — no Submagic
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

    // V2: one Gemini read of the footage (shared/cached across variants) drives
    // both this Submagic pass and the motion-graphics plan below. The variant's
    // fixed spec + resolver decide caption lane, B-roll %, zooms, and pace, with
    // the same content guardrails as v1-v3. Falls back to the flags passed by the
    // route for any variant without a V2 spec.
    const spec = VARIANT_SPECS[variantId]
    let profile: ContentProfile | null = null
    let templateName = submagicTemplateName
    let magicBrolls = submagicMagicBrolls ?? false
    let magicBrollsPercentage = submagicMagicBrolls ? 16 : undefined
    let magicZooms = submagicMagicZooms ?? false
    let removeSilencePace: 'natural' | 'fast' | 'extra-fast' = 'natural'
    let hookTitle: boolean | { text: string } | undefined
    if (spec) {
      profile = await ensureContentProfile(jobId, sourceUrl)
      templateName = await resolveCaptionTemplate(spec.captionLane, profile.captionMood)
      const resolved = resolveSubmagicSettings(spec, profile, { templateName })
      magicBrolls = resolved.magicBrolls
      magicBrollsPercentage = resolved.magicBrolls ? resolved.magicBrollsPercentage : undefined
      magicZooms = resolved.magicZooms
      removeSilencePace = resolved.removeSilencePace
      hookTitle = resolved.hookTitle
    }

    const projectId = await submitSubmagicJob(submagicSourceUrl, {
      title: `${variantId}-${jobId.slice(0, 8)}`,
      templateName,
      magicBrolls,
      magicBrollsPercentage,
      magicZooms,
      hookTitle,
      // cleanAudio requires a Submagic plan tier this account doesn't have yet
      // ("Clean audio requires a higher plan") -- confirmed by a live test
      // failing on this exact validation error. Re-enable once upgraded:
      // cleanAudio: true,
      cleanAudio: false,
      removeBadTakes: true,
      removeSilencePace,
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
      await addMotionGraphics(outputPath, hook, cta, moodTag ?? null, scriptFormat, outDir, variantId, motionGraphicsStyle, profile)
    }

    if (MUSIC_ENABLED && musicMode !== 'off') {
      await setVariantProgress(jobId, variantId, step++, STEPS, 'Adding background music')
      await enqueueAudioPostSteps(() =>
        mixBackgroundMusic(outputPath, hook, moodTag ?? null, scriptFormat, musicMode, profile, null, variantId)
      )
    }

    console.log('[motion-renderer] output ready')
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

export async function runSingleVariant(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  opts: RenderVariantOptions,
): Promise<void> {
  const key = jobId + ':' + variantId
  if (active.has(key)) return
  active.add(key)

  const outDir = rendersDir(jobId)
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
    if (opts.remotionEdit) {
      await renderRemotionEdit(jobId, variantId, sourceUrl, outDir, opts)
      return
    }
    if (opts.motionGraphicsTestOnly) {
      await renderMotionGraphicsTestOnly(jobId, variantId, sourceUrl, outDir, opts.hook, opts.cta, opts.moodTag, opts.scriptFormat, opts.motionGraphicsStyle, opts.musicMode)
      return
    }
    await renderSmartCinematic(jobId, variantId, sourceUrl, outDir, opts)
  }

  try {
    await launch()
  } catch (e) {
    console.error('[motion-renderer] runSingleVariant fatal:', e)
  } finally {
    clearTimeout(timeoutId)
    active.delete(key)
  }
}

// Fire-and-forget wrapper for long-lived servers (local dev, VPS). On Vercel,
// dispatchPipelineTask('render-variant') runs the awaited version inside a
// Sandbox instead — background work there cannot outlive the response.
export function startSingleVariant(
  jobId: string,
  variantId: string,
  sourceUrl: string,
  opts: RenderVariantOptions,
) {
  void runSingleVariant(jobId, variantId, sourceUrl, opts)
}

// ── Dispatchable pipeline tasks ───────────────────────────────────────────────
// Self-contained units of background work. On a long-lived server the routes
// run them fire-and-forget in-process; on Vercel the worker (worker/run-task.ts)
// runs them to completion inside a Sandbox VM. Everything they need comes from
// the DB + env, so they work identically in both homes.

// Downloads + compresses the job's footage and uploads it to R2, writing prep
// progress onto the pending variants; marks the whole job failed if the
// footage can't be fetched.
export async function prepareJobSourceTask(jobId: string, sourceUrl: string): Promise<void> {
  const db = supabaseAdmin()

  let lastProgressWrite = 0
  const writePrepProgress = async (percent: number, label: string) => {
    const now = Date.now()
    if (percent < 100 && now - lastProgressWrite < 700) return
    lastProgressWrite = now
    const { data: currentJob } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    const currentVariants = (currentJob?.variants ?? []) as VideoVariant[]
    const nextVariants = currentVariants.map((v) => (
      v.status === 'pending'
        ? { ...v, progress: { step: Math.max(1, Math.min(100, Math.round(percent))), total: 100, label } }
        : v
    ))
    await db.from('video_jobs').update({ variants: nextVariants }).eq('id', jobId)
  }

  try {
    const prepared = await prepareJobSource(jobId, sourceUrl, writePrepProgress)
    console.log(`[motion-renderer] source prepared job=${jobId} local=${prepared.localPath}`)
    const { data: currentJob } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    const readyVariants = ((currentJob?.variants ?? []) as VideoVariant[]).map((v) => (
      v.status === 'pending' ? { ...v, progress: null } : v
    ))
    await db.from('video_jobs').update({ variants: readyVariants }).eq('id', jobId)
  } catch (e) {
    console.error(`[motion-renderer] source prep failed job=${jobId}:`, (e as Error).message)
    const { data: currentJob } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    const failedVariants = ((currentJob?.variants ?? []) as VideoVariant[]).map((v) => ({
      ...v,
      status: 'failed' as const,
      progress: null,
      error: `Could not prepare the footage: ${(e as Error).message}`,
    }))
    await db.from('video_jobs').update({ variants: failedVariants, status: 'failed' }).eq('id', jobId)
  }
}

// Renders one edit-tool variant (v4-v6) start to finish: builds the render
// options from the job + script the same way the start-variant route does,
// then awaits the full pipeline.
export async function renderEditVariantTask(jobId: string, variantId: string): Promise<void> {
  const db = supabaseAdmin()

  const { data: job } = await db.from('video_jobs').select('*').eq('id', jobId).single()
  if (!job) throw new Error(`job ${jobId} not found`)

  const stored = ((job.variants ?? []) as VideoVariant[]).find((v) => v.id === variantId)
  const def = VARIANT_DEFINITIONS.find((v) => v.id === variantId)
  const variant = (stored && def ? { ...stored, ...def } : stored) as (VideoVariant & Record<string, unknown>) | undefined
  if (!variant) throw new Error(`variant ${variantId} not found on job ${jobId}`)

  await patchVariant(
    db,
    jobId,
    variantId,
    { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null },
    { jobStatus: 'processing' },
  )

  const { data: scriptRow } = await db
    .from('scripts')
    .select('hook, cta, mood_tag, filming_plan')
    .eq('id', job.script_id)
    .single()
  const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

  // our-v4/our-v5 share the same two AI-picked premium (non-Hormozi) templates
  // so they read as a real side-by-side comparison rather than two random picks.
  // our-v6 never touches Submagic (Remotion-only edit), so it needs no template.
  let submagicTemplateName: string | undefined
  if (!variant.motionGraphicsTestOnly && !variant.remotionEdit) {
    const [tplA, tplB] = await pickPremiumTemplates()
    submagicTemplateName = variant.motionGraphicsStyle === 'bold' ? tplB : tplA
  }

  await runSingleVariant(jobId, variantId, job.source_drive_url as string, {
    hook: scriptRow?.hook ?? '',
    cta: scriptRow?.cta ?? '',
    nativeCaptions: variant.nativeCaptions as boolean | undefined,
    moodTag: scriptRow?.mood_tag ?? null,
    scriptFormat,
    motionGraphicsTestOnly: variant.motionGraphicsTestOnly as boolean | undefined,
    remotionEdit: variant.remotionEdit as boolean | undefined,
    captionTestOnly: variant.captionTestOnly as boolean | undefined,
    motionGraphics: variant.motionGraphics as boolean | undefined,
    motionGraphicsStyle: variant.motionGraphicsStyle as 'minimal' | 'bold' | undefined,
    submagicTemplateName,
    submagicMagicBrolls: variant.submagicMagicBrolls as boolean | undefined,
    submagicMagicZooms: variant.submagicMagicZooms as boolean | undefined,
    musicMode: variant.music_mode as MusicMode | undefined,
  })
}
