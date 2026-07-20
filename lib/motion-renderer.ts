import { ensureFfmpegOnPath } from './ffmpeg-env'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createClient } from '@supabase/supabase-js'
import { uploadToStorage, deleteStorageKey } from './storage'
import type { MusicMode } from './video-pipeline'
import { submitSubmagicJob, pollSubmagicJob, DEFAULT_MUSIC_MODE, resolveCaptionTemplate, pickPremiumTemplates, VARIANT_DEFINITIONS, createSubmagicUserMedia } from './video-pipeline'
import type { CustomBrollEntry } from './video-pipeline'
import type { VideoVariant } from './video-pipeline'
import { transcribeLocalFile, generateASSCaptions, writeASSFile, FONTS_DIR } from './caption-renderer'
import { getLibraryMusic } from './music-library'
import { planMotionGraphics, type MotionGraphic } from './graphics-plan'
import { analyzeVideoFile, FALLBACK_PROFILE, type ContentProfile } from './video-analysis'
import { VARIANT_SPECS, resolveSubmagicSettings } from './variant-specs'
import { patchVariant } from './job-lock'
import { rendersDir } from './paths'
import { buildEditPlan, planViralCaptions, planEubankCaptions, planKoeCollageCaptions, planInsetSegments, type CaptionPage, type KoeMotif } from './edit-plan'
import { cleanAudioInPlace, detectSilences } from './audio-clean'
import { isolateVoiceInPlace } from './voice-isolation'
import { trimResidualSilences } from './post-trim'
import { applyVisualTransitions } from './visual-transitions'
import { applyColorGrade, resolveEditGrade, type GradeMode } from './color-grade'
import { buildSubmagicCutSource } from './precut'
import { explainFailure } from './error-explain'
import { buildRenderKit, planSfxCues, pickTransitionSmart, transitionSoundFamily } from './render-kit'
import { stageSfxCues } from './sfx-stage'
import { getSfx, probeSfxTiming, type TransitionStyle, type SfxCategory } from './sound-effects'
import { planBrollSlots, resolveBrollMedia, resolveExtraImages, avoidCaptionCollisions, applyViralCoverTreatment, planCustomBrollSlots, selectBestClips, normalizeBrollSetting, submagicBrollKnobs, type BrollItem, type CustomClip, type BrollMode } from './broll'
import { geminiGenerate } from './gemini'
import { planCollageScenes, generateCollageItems } from './collage-scenes'
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
        const detail = stderrBuf.slice(-2500).trim()
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

  // Unique per-call temp name: two concurrent preps (e.g. a variant started
  // while prepare-source is still running) used to share one .tmp file — the
  // first rename won and the second crashed with ENOENT. With unique names both
  // renames succeed; the second atomically overwrites with identical content.
  const tmpPath = path.join(outDir, `source-compressed.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}.mp4`)

  try {
    await run(
      `ffmpeg -y -i "${inputPath}" ` +
      `-r 30 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 128k -ar 48000 -movflags +faststart "${tmpPath}"`,
      600_000,
    )
    fs.renameSync(tmpPath, outputPath)
  } finally {
    // No-op after a successful rename; clears the orphan if ffmpeg failed.
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* best-effort */ }
  }
  return outputPath
}

// The Remotion path's work copy of the source. compressSourceFile keeps the
// filmed resolution (the Submagic deliverables should stay whatever shape the
// creator shot), but the ShortEdit composition sizes itself to THIS file — so
// a 4K portrait source (2160x3840 iPhone HEVC) made headless Chrome decode,
// render, and encode a full 4K composition on the 4-core Actions runner. That
// starved the page so badly the first delayRender (a font) blew its 900s
// budget: every 4K client job died with "Loading font EditCapBase…" while
// every 1080p job passed (2026-07-20, incl. a B-roll-mode-none render — the
// footage, not the B-roll, was the load). The delivered short is 1080p-class
// anyway, so capping the SHORT edge at 1080 (2160x3840 -> 1080x1920,
// 3840x2160 -> 1920x1080) is visually lossless for the output and cuts the
// render work ~4x. Aspect ratio and framing untouched; at or under the cap
// it's a plain copy, exactly the old behavior.
async function stageRenderWorkCopy(compressedPath: string, workPath: string): Promise<void> {
  const { width, height } = await probeVideoDimensions(compressedPath)
  if (Math.min(width, height) <= 1080) {
    fs.copyFileSync(compressedPath, workPath)
    return
  }
  // -2 keeps the scaled edge even for yuv420p; audio is already AAC — copy it.
  const filter = height >= width ? 'scale=1080:-2' : 'scale=-2:1080'
  console.log(`[motion-renderer] work copy: downscaling ${width}x${height} source (${filter}) — comp output is 1080p-class`)
  await run(
    `ffmpeg -y -i "${compressedPath}" -vf ${filter} -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -c:a copy -movflags +faststart "${workPath}"`,
    600_000,
  )
  if (!fs.existsSync(workPath)) throw new Error('Downscaling the render work copy produced no output')
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
  // Prefer the pre-cut clip when it exists: our planner already trimmed it, so
  // Submagic only styles. Checked BEFORE the in-process cache so the cut wins
  // even in a process that earlier cached the uncut compressed URL.
  // Retried: this HEAD decides WHICH video Submagic receives, and downstream
  // custom B-roll placements are only valid for the matching timeline
  // (placementBasis) — a single transient flake here would silently swap the
  // source and drop the creator's clips.
  if (process.env.R2_PUBLIC_URL) {
    const cutUrl = `${process.env.R2_PUBLIC_URL}/${jobId}/source-cut.mp4`
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const head = await fetch(cutUrl, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
        if (head.ok) return cutUrl
        break // definitive answer (404 etc.): no cut clip — use the compressed source
      } catch {
        // Network flake or timeout — retry briefly before concluding there is
        // no cut clip.
        if (attempt < 2) await new Promise(r => setTimeout(r, 1_500))
      }
    }
  }

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

      // Size-safe analysis input: Gemini's inline (base64) request path is only
      // documented safe under ~20MB, and a long source can hit 58MB (→ ~77MB
      // as base64). Above ~14MB, analyze a low-res sample instead — Gemini
      // reads video at 1fps + the audio track, so a 480p/10fps copy with mono
      // audio carries the same signal at ~2MB. Full-file behavior is unchanged
      // for the common (small) case.
      // Two-tier compression: the GOOD compressed copy is for editing; analysis
      // always reads a very-low proxy (480p / 10fps / mono audio, ~1-2MB).
      // Gemini samples video at 1fps + the audio track, so the proxy carries
      // the same signal at a fraction of the encode+upload time — and stays
      // safely under the ~20MB inline-request limit no matter the source.
      let analysisPath = localPath
      let samplePath: string | null = null
      try {
        samplePath = path.join(outDir, 'analysis-sample.mp4')
        await run(
          `ffmpeg -y -i "${localPath}" -vf scale=480:-2 -r 10 -c:v libx264 -preset veryfast -crf 30 ` +
          `-c:a aac -b:a 64k -ac 1 "${samplePath}"`,
          180_000,
        )
        analysisPath = samplePath
      } catch (e) {
        console.warn('[content-profile] proxy creation failed, analyzing full file:', (e as Error).message)
        analysisPath = localPath
        samplePath = null
      }

      const profile = await analyzeVideoFile(analysisPath, { transcript: transcript ?? undefined })
      if (samplePath) { try { fs.unlinkSync(samplePath) } catch { /* best-effort */ } }
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
): Promise<{ localPath: string; cutPath: string | null }> {
  const outDir = rendersDir(jobId)
  const localPath = await getLocalCompressedSource(jobId, sourceUrl, outDir, onProgress)
  // Set when the pre-cut Submagic source is built below. Custom B-roll
  // placements MUST be planned against whichever file Submagic actually
  // receives, so the caller needs to know which one that is.
  let submagicCutPath: string | null = null
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
  // Pre-cut the footage for the Submagic variants (v1-v3): our planner makes a
  // tight, clean cut (silence + retakes + stutters) and Submagic then only adds
  // captions + zoom styling on top. Uploaded once as source-cut.mp4 and shared
  // by every Submagic variant. Best-effort — if it fails, getSubmagicSourceUrl
  // falls back to the uncut compressed source and Submagic cuts on its own.
  await onProgress?.(98, 'Trimming footage')
  try {
    const cutPath = path.join(outDir, 'source-cut.mp4')
    const built = await buildSubmagicCutSource(localPath, cutPath)
    if (built) {
      await uploadToStorage(built, 'source-cut.mp4', jobId)
      submagicCutPath = built
      console.log(`[motion-renderer] pre-cut source ready for Submagic variants (job=${jobId})`)
    }
  } catch (e) {
    console.warn(`[motion-renderer] pre-cut step failed for job=${jobId} — Submagic will cut on its own:`, (e as Error).message)
  }

  // Analyze the footage once now, while the compressed file is warm on disk, so
  // the content profile is ready before any variant starts. Best-effort — never
  // block source prep on it.
  await onProgress?.(99, 'Analyzing footage')
  ensureContentProfile(jobId, sourceUrl).catch(() => { /* best-effort; falls back at read time */ })
  await onProgress?.(100, 'Footage ready')
  return { localPath, cutPath: submagicCutPath }
}

// A Remotion delayRender failure quotes the component's props back at you, and
// the fonts are embedded as base64 data URIs — so an untruncated message wrote
// ~10KB of font bytes into the variant's `error` field, once per failure. Strip
// data URIs first (they carry no diagnostic value), then hard-cap the rest.
const MAX_ERROR_CHARS = 600

function tidyError(error: string | null): string | null {
  if (!error) return error
  const stripped = error
    .replace(/data:[^;,\s"']+;base64,[A-Za-z0-9+/=]+/g, '[data-uri]')
    // Raw base64 (fonts quoted in Remotion prop dumps) that isn't a data: URI —
    // a 100+ char base64 run is binary, never a useful message.
    .replace(/[A-Za-z0-9+/]{100,}={0,2}/g, '[binary]')
  return stripped.length > MAX_ERROR_CHARS ? `${stripped.slice(0, MAX_ERROR_CHARS)}… (truncated)` : stripped
}

async function markVariant(
  jobId: string,
  variantId: string,
  status: 'ready' | 'failed',
  downloadUrl: string | null,
  error: string | null
) {
  // On failure, run the raw error through the explainer so the card shows WHY
  // (out of credits, quota hit, bad key, storage blip) rather than a stack/code.
  const finalError = status === 'failed' ? explainFailure(error) : error
  await patchVariant(
    supabaseAdmin(),
    jobId,
    variantId,
    { status, download_url: downloadUrl, preview_url: downloadUrl, error: tidyError(finalError), progress: null },
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

// True when the render runs on an EPHEMERAL host whose disk dies after the run
// (Vercel Sandbox VM or a GitHub Actions runner). On those, a local /renders/
// URL 404s once the machine is gone, so a finished video MUST reach R2 — a
// failed upload has to fail the variant, not return a dead local URL. (Distinct
// from process.env.SANDBOX alone, which also means "Amazon Linux → patch glibc";
// GitHub runners are Ubuntu and need no glibc patch, just the R2 requirement.)
function isEphemeralHost(): boolean {
  return process.env.SANDBOX === '1' || process.env.GITHUB_ACTIONS === 'true'
}

// True when the render runs on a SMALL shared box (Vercel Sandbox VM or a
// GitHub Actions runner) rather than a dev machine. Those hosts need fewer
// parallel Chrome tabs and a longer delayRender budget.
//
// This used to key off process.env.SANDBOX alone, so GitHub runners silently
// took the dev-machine profile (4 tabs, 10-minute timeout). That held until
// custom B-roll shipped: with a dozen creator clips to decode, 4 tabs each
// also parsing the embedded-font bundle starved the 4-core runner and the
// FIRST font load never cleared inside 10 minutes — every v4-v6 render died
// with `A delayRender() "Loading font ..." was called but not cleared after
// 598000ms`. Same profile as the Sandbox fixes it.
function isConstrainedRenderHost(): boolean {
  return process.env.SANDBOX === '1' || process.env.GITHUB_ACTIONS === 'true'
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
  } else if (isEphemeralHost()) {
    // On an ephemeral host (Vercel VM or GitHub runner) the disk is destroyed
    // after this run, so a local /renders/ URL would 404 forever — a variant
    // that looks "ready" but plays black. Fail loudly instead so it shows as
    // failed and can be retried.
    await markVariant(jobId, variantId, 'failed', null, 'Could not upload the finished video to storage. Please retry this variant.')
    return
  } else {
    // Long-lived server: R2 failed — copy the file into public/renders/ so the
    // /renders/ URL is actually reachable. If this copy also fails, mark the
    // variant failed rather than storing a dead path that ENOENTs at publish.
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

// True when this variant rendered through Submagic's fully-autonomous
// aiEditTemplate mode, whose request body omits cleanAudio entirely. Defaults
// to false (assume Submagic cleaned it) — a failed lookup must not trigger a
// needless ElevenLabs spend on audio that is already clean.
async function submagicSkippedCleanAudio(jobId: string, variantId: string): Promise<boolean> {
  try {
    const { data: job } = await supabaseAdmin()
      .from('video_jobs')
      .select('variants')
      .eq('id', jobId)
      .single()
    const variantRow = ((job?.variants ?? []) as VideoVariant[]).find(v => v.id === variantId)
    return Boolean(variantRow?.submagicPreset?.aiEditTemplate)
  } catch (e) {
    console.warn(`[motion-renderer] could not read submagicPreset for ${jobId}:${variantId}, assuming cleanAudio ran:`, (e as Error).message)
    return false
  }
}

// The job's color look is stored per-variant in the variants jsonb (same slot
// as music_mode), so it needs no schema migration. 'smart' when unset.
async function readVariantGradeMode(jobId: string, variantId: string): Promise<GradeMode> {
  try {
    const { data: job } = await supabaseAdmin().from('video_jobs').select('variants').eq('id', jobId).single()
    const v = ((job?.variants ?? []) as VideoVariant[]).find(x => x.id === variantId)
    return ((v?.grade_mode as GradeMode | undefined)) ?? 'smart'
  } catch {
    return 'smart'
  }
}

export async function finalizeSubmagicVariant(
  jobId: string,
  variantId: string,
  submagicDownloadUrl: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null,
): Promise<void> {
  const key = `${jobId}:${variantId}`
  if (activeSubmagicFinalizes.has(key)) return
  activeSubmagicFinalizes.add(key)

  // Callers that notice a finished Submagic project OUTSIDE the launch flow
  // (the status route's poll, the heal pass) have no music context in hand —
  // without this, whichever finisher won the race decided whether the video
  // got its library music. Build the context from the DB so every path mixes
  // the same way.
  if (!music && VARIANT_SPECS[variantId]?.useMusic) {
    try {
      const db = supabaseAdmin()
      const { data: job } = await db
        .from('video_jobs')
        .select('script_id, content_profile, transcript, variants')
        .eq('id', jobId)
        .single()
      const variantRow = ((job?.variants ?? []) as VideoVariant[]).find(v => v.id === variantId)
      const musicOff = (variantRow?.music_mode as MusicMode | undefined) === 'off'
      if (job && !musicOff) {
        const { data: s } = job.script_id
          ? await db.from('scripts').select('hook, mood_tag, filming_plan').eq('id', job.script_id).single()
          : { data: null }
        music = {
          hook: (s?.hook as string | undefined) ?? '',
          moodTag: (s?.mood_tag as string | null | undefined) ?? null,
          scriptFormat: (s?.filming_plan as { script_format?: string } | null)?.script_format,
          profile: (job.content_profile as ContentProfile | null) ?? null,
          transcript: (job.transcript as string | null) ?? null,
        }
      }
    } catch (e) {
      console.warn(`[motion-renderer] could not build music context for ${key}, finishing without music:`, (e as Error).message)
    }
  }
  try {
    const musicCtx = music ?? await libraryMusicContextFromDb(jobId, variantId)
    // aiEditTemplate renders never receive cleanAudio (submitSubmagicJob sends
    // only the base fields in that mode), so their audio needs the ElevenLabs
    // safety net. Every other Submagic render is cleaned in-render and is left
    // exactly as Submagic returned it.
    const skippedCleanAudio = await submagicSkippedCleanAudio(jobId, variantId)
    const gradeMode = await readVariantGradeMode(jobId, variantId)
    // Retrieval runs the whole finish chain (download → grade → effects → music
    // → SFX → R2 upload) and re-downloads fresh each attempt, so it's safe to
    // retry. Most failures here are TRANSIENT (network / TLS "bad record mac" /
    // R2 blip) — retrying instead of immediately falling back is what keeps a
    // variant off the engine's EXPIRING url, which would play now but go black
    // hours later. Only after retries exhaust do we accept the hosted url (still
    // usable now; the status-route heal re-pulls it on later polls).
    let finalUrl: string | null = null
    for (let attempt = 1; attempt <= 3 && finalUrl === null; attempt++) {
      try {
        finalUrl = await retrieveAndStoreSubmagicResult(jobId, variantId, submagicDownloadUrl, musicCtx, skippedCleanAudio, gradeMode)
        console.log(`[motion-renderer] Submagic result retrieved into Olympus storage for ${key}`)
      } catch (e) {
        console.warn(`[motion-renderer] retrieve attempt ${attempt}/3 failed for ${key}:`, (e as Error).message)
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 4000))
      }
    }
    if (finalUrl === null) {
      console.warn(`[motion-renderer] all retrieve attempts failed for ${key}, falling back to the engine's hosted URL (heal will re-pull)`)
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
  skippedCleanAudio: boolean = false,
  gradeMode: GradeMode = 'smart',
): Promise<string> {
  const outDir = rendersDir(jobId)
  fs.mkdirSync(outDir, { recursive: true })
  const localPath = path.join(outDir, `${variantId}_submagic.mp4`)
  await downloadFile(downloadUrl, localPath)

  await enqueueAudioPostSteps(async () => {
    // The Submagic variants keep Submagic's dialogue verbatim — no Auphonic,
    // no second cleaning pass. Their render already ran with cleanAudio
    // (SUBMAGIC_ALWAYS_ON), and mixBackgroundMusic below measures this file's
    // real voice loudness rather than assuming a normalized level, so nothing
    // downstream needs the audio pre-levelled.
    //
    // The one exception is the fully-autonomous aiEditTemplate path: that
    // request body carries only title/language/videoUrl/aiEditTemplate (see
    // submitSubmagicJob), so cleanAudio is never sent and the footage comes
    // back unprocessed. ElevenLabs isolation is the safety net there only.
    if (skippedCleanAudio) {
      try {
        const isolated = await isolateVoiceInPlace(localPath)
        console.log(
          isolated
            ? `[motion-renderer] aiEditTemplate render had no cleanAudio — isolated voice via ElevenLabs for ${jobId}:${variantId}`
            : `[motion-renderer] aiEditTemplate render had no cleanAudio and ElevenLabs is unavailable — keeping original audio for ${jobId}:${variantId}`
        )
      } catch (e) {
        console.warn('[motion-renderer] ElevenLabs isolation failed, keeping original audio:', (e as Error).message)
      }
    }

    // Backstop cut: Submagic's extra-fast silence removal still leaves the
    // occasional long gap. Trim any residual dead air from the finished file
    // BEFORE music/SFX so both land on the final timeline. Best-effort.
    try {
      await trimResidualSilences(localPath)
    } catch (e) {
      console.warn('[motion-renderer] residual-silence trim failed, keeping as-is:', (e as Error).message)
    }

    // Color grade — phone footage out of Submagic reads flat/cold. The look is
    // the job's chosen mode ('smart' default). Best-effort; a grade failure
    // never loses the video.
    try {
      await applyColorGrade(localPath, gradeMode)
    } catch (e) {
      console.warn('[motion-renderer] color grade failed, keeping as-is:', (e as Error).message)
    }

    // Visual accents (white flash / glow-up / black dip) on a smart subset of
    // the edit's cuts — the layer Submagic's API can't provide. Runs before
    // the SFX pass so the whooshes land on the same cuts the eyes see flash.
    // Best-effort — a veil failure never loses the video.
    try {
      await applyVisualTransitions(localPath, music?.profile ?? null)
    } catch (e) {
      console.warn('[motion-renderer] visual transitions failed, keeping as-is:', (e as Error).message)
    }

    // Step 4/4 of the v1-v3 journey (see start-variant + status routes): grading
    // and effects are done, now music + sound. setVariantProgress is best-effort
    // internally, so a progress-write failure never affects the render.
    await setVariantProgress(jobId, variantId, 4, 4, 'Adding music & finishing')

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
  // On an ephemeral host (Vercel VM / GitHub runner) a local /renders/ URL 404s
  // once the machine is gone — surface the failure instead of returning a dead
  // URL. Long-lived servers keep the file on disk.
  if (!r2Url && isEphemeralHost()) {
    throw new Error('Could not upload the finished video to storage. Please retry this variant.')
  }
  return versioned(r2Url ?? `/renders/${jobId}/${fileName}`)
}

// Intermediates only. `${variantId}.mp4` — the FINISHED render — is deliberately
// not in this list: deleting it up front meant a re-render that later failed
// (Remotion delayRender timeout, a hung LLM call) destroyed the previous good
// preview and left the variant with nothing. Remotion overwrites the output on
// success anyway, so keeping the old file costs nothing and survives a failure.
function cleanTempFiles(outDir: string, variantId: string): void {
  for (const suffix of ['_captions.ass', '_mx.mp4', '_broll.mp4', '_mg.mp4']) {
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

  // ── Music level knobs (tune here) ──────────────────────────────────────────
  // MUSIC_BED_BELOW_LU: how far under the voice the music bed sits. Bigger =
  //   quieter music. 18 read as too low; 14 keeps the voice clearly on top while
  //   letting the bed actually be heard.
  // DUCK_RATIO: how hard music drops WHILE the voice talks. In a talking-head
  //   video the voice is nearly constant, so a deep duck (6) made the bed vanish
  //   for almost the whole video. 3.5 keeps music present under speech.
  const MUSIC_BED_BELOW_LU = 10
  const DUCK_RATIO = 2.5

  // VOICE-AWARE leveling: measure how loud the dialogue in THIS video actually
  // is and place the music bed MUSIC_BED_BELOW_LU below it, instead of trusting
  // a constant that assumed studio-level voice. Falls back to an audited
  // constant when measurement fails.
  const voiceI = await measureIntegratedLoudness(videoPath)
  const musicI = await measureIntegratedLoudness(musicPath)
  let bedVolume = 'volume=0.20'
  if (voiceI !== null && musicI !== null) {
    const gainDb = Math.max(-40, Math.min(0, voiceI - MUSIC_BED_BELOW_LU - musicI))
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
      `[bgfade][0:a]sidechaincompress=threshold=${duckThreshold.toFixed(4)}:ratio=${DUCK_RATIO}:attack=15:release=700[ducked];` +
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

// Sandbox-only: make Remotion's gnu compositor run on Amazon Linux 2023's glibc
// 2.34. Mirrors @remotion/vercel's patchCompositor — download Ubuntu 22.04's
// glibc 2.35 and patchelf the compositor's interpreter + rpath onto it. Runs
// once per VM (marker file); ffmpeg/ffprobe are left on system glibc (they work
// on 2.34). Verified end-to-end on a real AL2023 container.
const GLIBC_PATCH_MARKER = '/tmp/.oly-glibc235-patched'
async function patchSandboxCompositorGlibc(gnuDir: string): Promise<void> {
  if (fs.existsSync(GLIBC_PATCH_MARKER)) return
  const comp = path.join(gnuDir, 'remotion')
  if (!fs.existsSync(comp)) {
    console.warn(`[motion-renderer] compositor not found at ${comp}; skipping glibc patch`)
    return
  }
  const scriptPath = path.join(os.tmpdir(), 'oly-patch-compositor.sh')
  const script = [
    'set -eu',
    // patchelf/zstd/binutils(ar)/tar for the patch — idempotent, best-effort.
    'sudo dnf install -y -q patchelf zstd binutils tar >/dev/null 2>&1 || true',
    'GLIBC=/tmp/glibc235',
    'mkdir -p "$GLIBC" && cd /tmp',
    'curl -fsSL -o libc6.deb "https://launchpadlibrarian.net/612471225/libc6_2.35-0ubuntu3.1_amd64.deb" || curl -fsSL -o libc6.deb "https://remotion.media/libc6_2.35-0ubuntu3.1_amd64.deb"',
    'ar x libc6.deb',
    'zstd -d -f data.tar.zst -o data.tar',
    'tar xf data.tar -C "$GLIBC" --strip-components=1',
    `patchelf --set-interpreter "$GLIBC/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" --force-rpath --set-rpath "$GLIBC/lib/x86_64-linux-gnu:\\$ORIGIN" "${comp}"`,
    `touch "${GLIBC_PATCH_MARKER}"`,
    'echo "[motion-renderer] compositor patched onto bundled glibc 2.35"',
  ].join('\n')
  fs.writeFileSync(scriptPath, script)
  await run(`bash "${scriptPath}"`, 300_000)
}
// How much of a creator clip is kept per WINDOW. A cutaway is 1.8-3.8s, so 5s
// covers the longest one with headroom. Keeping windows short is what stops a
// folder of long clips from starving the render host: one real job staged 243s
// of 1080p footage to show 9s of cutaways, and 12-clip jobs failed 3/3 while
// 0-clip jobs passed 3/3.
// 8s, not 5: the planner can hand one clip two 3.8s cutaways and the second
// one plays the tail (srcOffset). At 5s the tail started at 1.2s, so both
// cutaways showed almost the same footage — 8s keeps them distinct.
const CLIP_WINDOW_SECONDS = 8

// Clips at or under this are used EXACTLY as filmed — no windowing, no trim.
// A short clip is already the moment; cutting it can only lose the reason it
// was filmed, and it costs the renderer almost nothing to carry.
const KEEP_WHOLE_UNDER_SECONDS = 14

// A long clip is not one moment — a 100s walk-through has several usable beats,
// and the good one is rarely at the head. Rather than blindly keeping the first
// slice, carve up to this many windows spread across the clip; each is described
// separately and competes on content, so the planner can pick the beat that
// actually matches what the creator is saying.
const MAX_WINDOWS_PER_CLIP = 3

// Windows (start seconds) to carve out of a clip of `duration` seconds. Short
// clips stay whole. Longer ones get evenly spaced windows, insetting from both
// ends because the first and last moments of a phone clip are usually the hand
// reaching for the record button.
function clipWindows(duration: number): Array<{ offset: number; seconds: number }> {
  if (!Number.isFinite(duration) || duration <= 0) return [{ offset: 0, seconds: CLIP_WINDOW_SECONDS }]
  // Short clip: use it whole, untouched.
  if (duration <= KEEP_WHOLE_UNDER_SECONDS) return [{ offset: 0, seconds: duration }]
  const count = Math.max(1, Math.min(MAX_WINDOWS_PER_CLIP, Math.round(duration / 30)))
  // One window: take the middle. The head of a phone clip is usually the
  // creator still settling the camera.
  if (count === 1) {
    return [{ offset: Number(((duration - CLIP_WINDOW_SECONDS) / 2).toFixed(2)), seconds: CLIP_WINDOW_SECONDS }]
  }
  const usable = duration - CLIP_WINDOW_SECONDS
  const inset = Math.min(1.5, usable * 0.08)
  const span = usable - inset * 2
  return Array.from({ length: count }, (_, i) => ({
    offset: Number((inset + (span * i) / (count - 1)).toFixed(2)),
    seconds: CLIP_WINDOW_SECONDS,
  }))
}

// One candidate window: described from a cheap low-res sample, cut to full
// resolution only if it survives selection.
interface ClipCandidate {
  entryIndex: number
  rawPath: string
  offset: number     // seconds into the source
  duration: number   // seconds of this window
  description: string
}

// Downloads each of the creator's OWN B-roll clips (Drive links stored on the
// job) and describes every candidate WINDOW inside it — one for a short clip,
// up to MAX_WINDOWS_PER_CLIP spread across a long one. Nothing is cut to full
// resolution here: the caller ranks the candidates first and only stages the
// winners. A clip that fails is skipped, never fatal.
async function collectCustomBrollCandidates(
  jobId: string,
  entries: { url: string; description?: string | null }[],
  cacheDir: string,
): Promise<ClipCandidate[]> {
  fs.mkdirSync(cacheDir, { recursive: true })
  const candidates: ClipCandidate[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    try {
      // KNOWN LIMITATION (inline mode only): this filename is job-scoped, not
      // variant-scoped, and renderRemotionEdit deletes these files in its finally
      // (see the `staged` cleanup). In prod each variant renders in its own
      // isolated filesystem (Vercel sandbox / GitHub Actions), so v4/v5/v6 never
      // touch the same files — safe. But when dispatchPipelineTask runs inline
      // (local dev / a self-hosted long-lived server), all three variants share
      // one fs: they race on these paths and the first to finish deletes clips the
      // others are still rendering, so a variant can silently ship with fewer or
      // zero custom cutaways. Reproduced 2026-07-15 via scripts/edge-test-parallel.
      // Not fixed on purpose (prod is isolated); variant-scope this name if inline
      // parallel rendering ever becomes a supported path.
      const rawPath = path.join(cacheDir, `custom-${jobId.slice(0, 8)}-${i}.raw.mp4`)
      if (!fs.existsSync(rawPath)) {
        // Prefer the normalized R2 copy from a previous prep — faster and immune
        // to Drive's confirm-page quirks on re-renders.
        await downloadFile((entry as CustomBrollEntry).r2Url ?? entry.url, rawPath)
      }
      const sourceDuration = await getVideoDuration(rawPath)
      const windows = clipWindows(sourceDuration)

      for (let w = 0; w < windows.length; w++) {
        const { offset } = windows[w]
        const seconds = Math.min(windows[w].seconds, Math.max(1, sourceDuration - offset))
        // Describe from a tiny low-res sample OF THIS WINDOW — never the full
        // file, so the request stays small no matter how big the upload was,
        // and each window is judged on its own content.
        const samplePath = `${rawPath}.w${w}.sample.mp4`
        let description = ''
        await run(
          `ffmpeg -y -ss ${offset.toFixed(2)} -i "${rawPath}" -t ${seconds.toFixed(2)} -vf scale=480:-2 -r 10 -c:v libx264 -preset veryfast -crf 30 -an "${samplePath}"`,
          120_000,
        )
        try {
          const media = { mimeType: 'video/mp4', data: fs.readFileSync(samplePath).toString('base64') }
          description = (await geminiGenerate({
            prompt: 'Describe what this clip shows in ONE short line (max 15 words): the subject and the action. No opinions, no style words.',
            media: [media],
            model: 'google/gemini-2.5-flash-lite',
            maxOutputTokens: 200,
            temperature: 0.2,
          })).trim()
        } catch (e) {
          console.warn(`[motion-renderer] describe failed for clip ${i} window ${w}: ${(e as Error).message}`)
        } finally {
          try { fs.unlinkSync(samplePath) } catch { /* best-effort */ }
        }
        candidates.push({
          entryIndex: i,
          rawPath,
          offset,
          duration: seconds,
          description: description || entry.description?.trim() || `creator clip ${i + 1}`,
        })
        console.log(
          `[motion-renderer] candidate ${i}.${w}: ${offset.toFixed(1)}-${(offset + seconds).toFixed(1)}s of ${sourceDuration.toFixed(1)}s — "${description.slice(0, 70)}"`,
        )
      }
    } catch (e) {
      console.warn(`[motion-renderer] custom B-roll clip ${i} failed, skipping: ${(e as Error).message}`)
    }
  }
  return candidates
}

// Cuts the chosen windows to full resolution. Only winners get here, so the
// render only ever decodes the seconds that can actually appear on screen.
async function stageChosenWindows(
  chosen: ClipCandidate[],
  jobId: string,
  cacheDir: string,
  publicPrefix: string,
  // ALL candidates, not just winners — their raw downloads must be cleaned up
  // too, or a losing clip's full-length file stays in remotion/public where
  // the render server can serve it and the bundler can copy it.
  allCandidates: ClipCandidate[] = chosen,
): Promise<CustomClip[]> {
  const clips: CustomClip[] = []
  for (let n = 0; n < chosen.length; n++) {
    const c = chosen[n]
    try {
      const fileName = `custom-${jobId.slice(0, 8)}-${c.entryIndex}-w${n}.mp4`
      const outPath = path.join(cacheDir, fileName)
      if (!fs.existsSync(outPath)) {
        // -ss before -i seeks fast; normalize to h264/yuv420p 30fps with audio
        // stripped so OffthreadVideo is safe regardless of what the phone
        // produced (HEVC, odd rotation).
        await run(
          `ffmpeg -y -ss ${c.offset.toFixed(2)} -i "${c.rawPath}" -t ${c.duration.toFixed(2)} -r 30 -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p -an -movflags +faststart "${outPath}"`,
          300_000,
        )
      }
      const duration = await getVideoDuration(outPath)
      clips.push({ file: `${publicPrefix}/${fileName}`, description: c.description, duration, entryIndex: c.entryIndex })
    } catch (e) {
      console.warn(`[motion-renderer] staging window for clip ${c.entryIndex} failed, skipping: ${(e as Error).message}`)
    }
  }
  // The raw downloads are only needed to cut windows out of — drop them so the
  // render server never serves (or the bundler copies) the full-length files.
  // EVERY candidate's raw, not just the winners'.
  for (const raw of new Set(allCandidates.map(c => c.rawPath))) {
    try { if (fs.existsSync(raw)) fs.unlinkSync(raw) } catch { /* best-effort */ }
  }
  console.log(`[motion-renderer] staged ${clips.length} window(s), ${clips.reduce((s, c) => s + c.duration, 0).toFixed(1)}s total`)
  return clips
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
    await stageRenderWorkCopy(compressedPath, workPath)
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
    // These four all read workPath and don't depend on each other — run them
    // together instead of serially (overlaps the slow Scribe call with the
    // ffmpeg/ffprobe passes).
    const [words, silences, duration, dimensions] = await Promise.all([
      transcribeLocalFile(workPath),
      detectSilences(workPath),
      getVideoDuration(workPath),
      probeVideoDimensions(workPath),
    ])
    // A talking-head clip that comes back with almost no words means the
    // transcription failed (empty 200 from Scribe, wrong audio track) — NOT a
    // silent video. Shipping it anyway produces a "ready" edit with no cuts, no
    // captions, and no B-roll. Fail loudly instead so the user retries.
    if (words.length < 5 && duration > 8) {
      throw new Error('Transcription came back empty — could not read the speech in this clip. Please retry this variant.')
    }

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
    // Julie and Glow reuse the same LLM accent picker, mapped onto plain word
    // flags: the reference accents a keyword on nearly every page, far denser
    // than the profile-emphasis heuristic alone provides.
    if (kit.captionStyle === 'julie' || kit.captionStyle === 'glow') {
      await planViralCaptions(plan.pages, profile, kit.variation)
      for (const page of plan.pages) {
        if (page.accentRange) {
          for (let i = page.accentRange[0]; i <= page.accentRange[1]; i++) page.words[i].accent = true
        }
        // Strip the viral-only styling fields so the page renders as julie/glow.
        // Behind-hook pages were parked at 'mid' for the matte look — neither
        // style stages a matte, so re-home them off the face first.
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
    // v7: the viral captions carry their own hook, so drop the koe opening
    // title graphic (the glowing "Automate your video editing workflow" block)
    // to avoid double-stacking text over the first beat.
    if (kit.hideTitleGraphic) {
      graphics = graphics.filter(g => g.kind !== 'title')
    }

    // The studio's B-roll knob: smart (footage-adaptive), a manual coverage
    // percent, or none. 'none' silences every cutaway source — stock, custom
    // clips, and collage scenes — not just stock.
    const brollSetting = normalizeBrollSetting(opts.brollMode, opts.brollPercent)
    const brollCoverage = brollSetting.mode === 'manual' ? brollSetting.percent : null
    const brollOff = brollSetting.mode === 'none'
    if (brollSetting.mode !== 'smart') {
      console.log(`[motion-renderer] B-roll mode for ${variantId}: ${brollSetting.mode}${brollCoverage !== null ? ` (${brollCoverage}%)` : ''}`)
    }

    await setVariantProgress(jobId, variantId, 4, STEPS, brollOff ? 'Planning visuals' : kit.collageScenes ? 'Generating collage scenes and B-roll' : 'Finding B-roll')
    const cacheDir = path.join(REMOTION_DIR, 'public', 'edit-cache')
    const brollPrefix = `edit-cache/${variantId}-${jobId.slice(0, 8)}-broll`
    // The hook is a top-band overlay — B-roll can run under it, so it
    // never claims timeline from the cutaway planner.
    const graphicWindows = graphics
      .filter(g => g.kind !== 'hook')
      .map(g => ({ start: g.start, duration: g.duration }))

    // Collage scenes (v7 test): plan FIRST — like graphics, they outrank stock
    // footage, so the cutaway planner steers around their windows. Generation
    // (kie.ai images + chromakey) then runs in PARALLEL with the stock media
    // resolution below; merging happens once both are done. Fully best-effort:
    // no key / failed generations just mean stock-only B-roll.
    let collagePromise: Promise<BrollItem[]> = Promise.resolve([])
    let collageWindows: Array<{ start: number; duration: number }> = []
    if (kit.collageScenes && !brollOff) {
      try {
        const scenes = await planCollageScenes(plan.editedWords, plan.editedDuration, profile, kit.variation, graphicWindows, kit.denseMotion)
        collageWindows = scenes.map(s => ({ start: s.start, duration: s.duration }))
        collagePromise = generateCollageItems(scenes, path.join(REMOTION_DIR, 'public', brollPrefix), brollPrefix)
          .catch(e => {
            console.warn('[motion-renderer] collage generation failed, continuing without scenes:', (e as Error).message)
            return []
          })
      } catch (e) {
        console.warn('[motion-renderer] collage planning failed, continuing without scenes:', (e as Error).message)
      }
    }

    const usingCustomBroll = !!opts.customBroll?.length
    let broll: Awaited<ReturnType<typeof resolveBrollMedia>> = []
    if (kit.brollMedia !== 'none' && !brollOff) {
      try {
        // One set for the whole render: stock cover slots, carousel panes and
        // every query-ladder fallback all draw from it, so no clip appears
        // twice. Declared outside the branch because the eubank carousel below
        // (resolveExtraImages) shares it. Custom-clip renders never source
        // stock, so the set simply stays empty for them.
        const usedMedia = new Set<string>()
        if (usingCustomBroll) {
          // The creator supplied their own clips — stock sourcing is skipped
          // entirely. Every candidate window is described first, ranked against
          // THIS script, and only the winners are cut to full resolution, so the
          // renderer never decodes footage that can't reach the screen.
          const candidates = await collectCustomBrollCandidates(jobId, opts.customBroll!, cacheDir)
          const chosen = await selectBestClips(candidates, plan.editedWords)
          const clips = await stageChosenWindows(chosen, jobId, cacheDir, 'edit-cache', candidates)
          for (const c of clips) staged.push(path.join(REMOTION_DIR, 'public', c.file))
          broll = await planCustomBrollSlots(plan.editedWords, plan.editedDuration, profile, clips, [...graphicWindows, ...collageWindows], kit.denseMotion, brollCoverage)
        } else {
          const slots = await planBrollSlots(plan.editedWords, plan.editedDuration, profile, kit.variation, kit.brollMedia, kit.designedCards, [...graphicWindows, ...collageWindows], kit.denseMotion, brollCoverage)
          broll = await resolveBrollMedia(slots, path.join(REMOTION_DIR, 'public', brollPrefix), brollPrefix, kit.variation, kit.brollMedia, usedMedia)
        }
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
                // Custom-clip mode never fetches stock extras — the carousel
                // falls back to a side panel (same clip) or a plain cover.
                const extras = usingCustomBroll ? [] : await resolveExtraImages(
                  b.query ?? 'city skyline golden hour',
                  path.join(REMOTION_DIR, 'public', brollPrefix),
                  brollPrefix,
                  `carousel-${bi}`,
                  2,
                  kit.variation,
                  usedMedia,
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

    // Merge the generated collage scenes in with the stock cutaways. They
    // carry their own type, so caption pages living mostly inside one are
    // dropped — the same rule as the viral designed card. Merged OUTSIDE the
    // stock try/catch so a Pexels failure never loses the generated scenes.
    const collageItems = await collagePromise
    if (collageItems.length) {
      broll.push(...collageItems)
      broll.sort((a, b) => a.start - b.start)
      const collageFrac = (p: { start: number; end: number }, b: { start: number; duration: number }) => {
        const overlap = Math.min(p.end, b.start + b.duration) - Math.max(p.start, b.start)
        return overlap / Math.max(p.end - p.start, 0.01)
      }
      plan.pages = plan.pages.filter(p => !collageItems.some(b => collageFrac(p, b) >= 0.6))
      for (const item of collageItems) {
        for (const cut of item.collage?.cutouts ?? []) staged.push(path.join(REMOTION_DIR, 'public', cut.file))
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

    // Koe (v6) editorial-collage pass: grouping, serif payoffs, dim echoes,
    // in-place number swaps, and section numerals — see lib/edit-plan.ts.
    // Runs AFTER the graphics drop so collages never reference removed pages.
    let koeMotifs: KoeMotif[] = []
    if (kit.captionStyle === 'koe') {
      koeMotifs = await planKoeCollageCaptions(plan.pages, profile, kit.variation)
      // A collage moves as ONE unit — group-uniform B-roll overrides (splits
      // pull the collage to the seam, covers lift it high, mid-band cards
      // push it low), replacing the per-page avoidCaptionCollisions result.
      const overlapFrac = (p: { start: number; end: number }, b: { start: number; duration: number }) => {
        const overlap = Math.min(p.end, b.start + b.duration) - Math.max(p.start, b.start)
        return overlap / Math.max(p.end - p.start, 0.01)
      }
      const groups = new Map<number, CaptionPage[]>()
      plan.pages.forEach((p, i) => {
        const id = p.koeGroup ?? -(i + 1)
        const arr = groups.get(id)
        if (arr) arr.push(p)
        else groups.set(id, [p])
      })
      for (const groupPages of groups.values()) {
        const hitsSplit = groupPages.some(p => broll.some(b => b.layout === 'split' && overlapFrac(p, b) >= 0.5))
        const hitsCover = groupPages.some(p => broll.some(b => b.layout === 'cover' && overlapFrac(p, b) >= 0.5))
        const hitsCard = groupPages.some(p => broll.some(b => (b.layout === 'card' || b.layout === 'panel') && overlapFrac(p, b) >= 0.4))
        for (const p of groupPages) {
          if (hitsSplit) p.position = 'mid'
          else if (hitsCover) p.position = 'high'
          else if (hitsCard && p.position === 'mid') p.position = 'low'
        }
      }
      // A numeral living mostly under a text-carrying graphic would fight it.
      // Collage scenes carry their own type too, so numerals clear them as well.
      koeMotifs = koeMotifs.filter(m =>
        !graphics.some(g =>
          TEXT_GRAPHICS.has(g.kind) &&
          Math.min(m.end, g.start + g.duration) - Math.max(m.start, g.start) > 0.3 * (m.end - m.start)
        ) &&
        !broll.some(b =>
          b.collage &&
          Math.min(m.end, b.start + b.duration) - Math.max(m.start, b.start) > 0.3 * (m.end - m.start)
        )
      )
      console.log(`[motion-renderer] koe collage: ${groups.size} group(s), ${plan.pages.filter(p => p.accentRange).length} serif payoff(s), ${koeMotifs.length} numeral motif(s)`)
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
      grade: resolveEditGrade(opts.gradeMode, kit.grade),
      hookSpotlight: kit.hookSpotlight,
      handheld: kit.handheld,
      splits: broll.filter(b => b.layout === 'split').map(b => ({ start: b.start, end: b.start + b.duration })),
      faceArea: profile?.faceArea,
      koeMotifs: koeMotifs.length ? koeMotifs : undefined,
      sfx,
    }))
    staged.push(propsPath)

    await setVariantProgress(jobId, variantId, 5, STEPS, 'Waiting for render slot')
    await enqueueRemotionRender(async () => {
      await setVariantProgress(jobId, variantId, 5, STEPS, 'Rendering your edit')
      // Sandbox VM is Amazon Linux 2023 (glibc 2.34); Remotion's gnu compositor
      // needs glibc 2.35. Remotion's own fix (patchCompositor in @remotion/vercel):
      // bundle Ubuntu 22.04's glibc 2.35 and patchelf the compositor onto it;
      // ffmpeg/ffprobe stay on system glibc 2.34. Verified end-to-end on real
      // AL2023. Runs from the cloned worker (not the bootstrap) so it can't be
      // blocked by a lagging Vercel function deploy; once-per-VM via a marker.
      const gnuDir = path.join(REMOTION_DIR, 'node_modules/@remotion/compositor-linux-x64-gnu')
      if (process.env.SANDBOX) {
        await patchSandboxCompositorGlibc(gnuDir)
      }
      // In the sandbox: lower concurrency so the single render server isn't
      // hammered by many tabs at once (its asset/frame serving is what stalls
      // on long renders), a bigger delayRender timeout for headroom, and the
      // compositor cache cap. Fonts are embedded (data URIs, see fonts-data.ts)
      // so they never hit the server at all.
      //
      // Locally, a HEAVY composition (v7 dense motion: a dozen OffthreadVideo
      // B-roll covers + collage scenes + 18 fonts) oversubscribes headless
      // Chrome on a busy machine (user apps + dev server) — every tab races to
      // load the same fonts/assets through the dev server, font loading crawls
      // past the old 240s wall, and the OffthreadVideo compositor drops
      // connections ("Request closed") under the memory pressure. Fewer tabs
      // (concurrency 4) each get enough headroom to load fonts and decode video.
      // Constrained hosts (Sandbox VM + GitHub runner) share the tab/cache caps;
      // only the Sandbox additionally needs the glibc-patched compositor, since
      // GitHub runners are Ubuntu and their stock compositor is fine.
      const constrained = isConstrainedRenderHost()
      // --log=verbose on constrained hosts: these renders die blind (zero
      // output between render start and a delayRender timeout ~15 min later),
      // so a slow render and a wedged page look identical. Verbose shows
      // per-frame progress in the Actions log. Cost is log volume only.
      const sandboxFlags = constrained
        ? ` --offthreadvideo-cache-size-in-bytes=536870912 --concurrency=2 --log=verbose` +
          (process.env.SANDBOX ? ` --binaries-directory="${gnuDir}"` : '')
        : ' --concurrency=4'
      // The delayRender budget must exceed the WORST-CASE TOTAL RENDER TIME,
      // not just page-load time. Root cause of the "Loading font EditCapBase"
      // deaths (verbose diag, run 29731128897): besides the two rendering
      // tabs, a non-rendering page sits CPU-starved on the 4-core runner and
      // its module-scope font handles never clear — harmless until the render
      // outlives the budget, then that page's timer kills a HEALTHY render
      // (seen dying at 57%, frames advancing, 4 min to go). Every job whose
      // render finished inside the budget passed; every longer one died at
      // exactly the budget — which is why short demo jobs "worked" and the
      // client's longer jobs "didn't". 2700s covers a ~35-min render with
      // headroom; the workflow's timeout-minutes is the real runaway guard.
      const renderTimeout = constrained ? 2_700_000 : 600000
      await run(
        // Generous delayRender timeout: headless-Chrome startup + asset loads
        // can crawl on a busy/constrained machine and fail renders that would
        // otherwise succeed. sandboxFlags carries the glibc-patched compositor
        // (--binaries-directory), concurrency cap, and cache cap; fonts are
        // embedded (data URIs) so they never fetch from the render server.
        `cd "${REMOTION_DIR}" && npx remotion render src/Root.tsx ShortEdit "${outputPath}" ` +
        `--props="${propsPath}" --codec=h264 --crf=19 --timeout=${renderTimeout}${sandboxFlags}`,
        1_500_000,
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
  gradeMode?: GradeMode            // per-job color look (smart / golden / clean / moody / off)
  // Per-job B-roll amount for the Remotion variants (v4-v6): 'smart' adapts
  // to the footage, 'manual' honors brollPercent, 'none' disables B-roll
  // entirely (stock, custom clips, and collage scenes alike).
  brollMode?: BrollMode
  brollPercent?: number | null     // manual coverage percent (0-50)
  // Creator-supplied B-roll (Drive links stored on the job). When present,
  // stock B-roll is skipped entirely and these clips are matched to
  // transcript moments instead.
  customBroll?: { url: string; description?: string | null }[]
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

    await setVariantProgress(jobId, variantId, step++, STEPS, 'AI editing engine at work')
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

    // The job's B-roll setting overrides the spec/flag amount for this
    // Submagic pass too — same contract as the pure-Remotion edit and v1-v3.
    const brollKnobs = submagicBrollKnobs(
      normalizeBrollSetting(opts.brollMode, opts.brollPercent),
      { magicBrolls, magicBrollsPercentage },
    )
    magicBrolls = brollKnobs.magicBrolls
    magicBrollsPercentage = brollKnobs.magicBrollsPercentage

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
    // MUST mark the variant failed here — not just log. renderRemotionEdit and
    // the caption/motion-graphics test paths can throw before they set up their
    // own error handling (e.g. empty transcription), and renderEditVariantTask
    // has no catch of its own. Without this the variant sits 'processing' with
    // no progress ("Connecting to pipeline…") until the 45-min sweep, and the UI
    // offers no Retry while processing — a frozen, unrecoverable card.
    console.error('[motion-renderer] runSingleVariant fatal:', e)
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message || 'The render failed to start. Please retry this variant.').catch(() => {})
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
// Once-per-job custom B-roll prep. Enriches each video_jobs.custom_broll
// entry with: a normalized copy hosted in R2 (deleted with the job), the
// Submagic user-media id, a one-line description, and transcript-matched
// placements. v1-v3 turn those into timed Submagic items; v4-v6 reuse the
// R2 copies + descriptions for their own per-variant planning.
async function prepareCustomBrollForJob(
  jobId: string,
  sourceLocalPath: string,
  basis: 'cut' | 'full',
): Promise<void> {
  const db = supabaseAdmin()
  const { data: job } = await db.from('video_jobs').select('custom_broll').eq('id', jobId).single()
  const entries = (job?.custom_broll ?? null) as CustomBrollEntry[] | null
  if (!entries?.length) return

  console.log(`[custom-broll] preparing ${entries.length} clip(s) for job ${jobId.slice(0, 8)}`)
  const cacheDir = path.join(REMOTION_DIR, 'public', 'edit-cache')
  const candidates = await collectCustomBrollCandidates(jobId, entries, cacheDir)
  if (!candidates.length) return

  // Submagic registers user-media per ENTRY (one media id per creator clip), so
  // unlike the Remotion path this one keeps a single window per entry. Take the
  // MIDDLE window of a long clip: the head is usually the creator still settling
  // the phone, and the middle is the closest cheap guess at the real moment.
  const chosen = entries
    .map((_, i) => {
      const forEntry = candidates.filter(c => c.entryIndex === i)
      return forEntry.length ? forEntry[Math.floor(forEntry.length / 2)] : null
    })
    .filter((c): c is ClipCandidate => !!c)
  const clips = await stageChosenWindows(chosen, jobId, cacheDir, 'edit-cache', candidates)
  if (!clips.length) return

  // Host each normalized clip in R2 ({jobId}/custom-broll-i.mp4 — cleaned up
  // by deleteJobStorage) and register it with Submagic. Entries are matched
  // through clip.entryIndex — staging skips failed clips, so positions in
  // `clips` do not line up with `entries`.
  for (const clip of clips) {
    const i = clip.entryIndex ?? -1
    const entry = entries[i]
    if (!entry) continue
    entry.duration = clip.duration
    if (!entry.r2Url) {
      try {
        entry.r2Url = await uploadToStorage(path.join(REMOTION_DIR, 'public', clip.file), `custom-broll-${i}.mp4`, jobId)
      } catch (e) {
        console.warn(`[custom-broll] R2 upload failed for clip ${i}:`, (e as Error).message)
      }
    }
    if (entry.r2Url && !entry.submagicMediaId) {
      entry.submagicMediaId = await createSubmagicUserMedia(entry.r2Url)
    }
  }

  // Transcript-matched placements from the SOURCE timeline (items are placed
  // on the source video Submagic receives, before its silence cuts).
  try {
    const words = await transcribeLocalFile(sourceLocalPath)
    const duration = await getVideoDuration(sourceLocalPath)
    // Same curation as the Remotion path: a big folder narrows to the clips
    // whose content best fits this video before placements are planned.
    const timedWords = words.map(w => ({ ...w, segmentIndex: 0 }))
    // One window per entry already, so this only narrows when the folder holds
    // more clips than a single video can carry.
    const ranked = await selectBestClips(clips, timedWords)
    const placed = await planCustomBrollSlots(timedWords, duration, null, ranked, [], false)
    for (const entry of entries) { entry.placements = []; entry.placementBasis = basis }
    for (const item of placed) {
      const clip = ranked.find(c => c.file === item.file)
      const entry = clip ? entries[clip.entryIndex ?? -1] : undefined
      if (entry) {
        entry.placements!.push({ start: item.start, end: Number((item.start + item.duration).toFixed(2)) })
      }
    }
    console.log(`[custom-broll] planned ${placed.length} placement(s) across ${ranked.length} clip(s)`)
  } catch (e) {
    console.warn('[custom-broll] placement planning failed (v1-v3 will render without items):', (e as Error).message)
  }

  await db.from('video_jobs').update({ custom_broll: entries }).eq('id', jobId)
}

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

    // Custom B-roll prep (once per job, best-effort): normalize + describe the
    // creator's clips, host them in R2, register them with Submagic, and plan
    // transcript-matched placements that every Submagic variant will reuse.
    try {
      // Plan against the PRE-CUT file when there is one. getSubmagicSourceUrl
      // hands Submagic source-cut.mp4 in preference to the compressed source,
      // and the cut is materially shorter (one real job: 140.9s -> 113.4s), so
      // placements timed on the uncut source land in the wrong place — or past
      // the end of the video entirely, which Submagic rejects outright.
      await prepareCustomBrollForJob(
        jobId,
        prepared.cutPath ?? prepared.localPath,
        prepared.cutPath ? 'cut' : 'full',
      )
    } catch (e) {
      console.warn(`[motion-renderer] custom B-roll prep failed (renders proceed without it):`, (e as Error).message)
    }

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
    gradeMode: (variant.grade_mode as GradeMode | undefined),
    brollMode: variant.broll_mode as BrollMode | undefined,
    brollPercent: variant.broll_percent as number | null | undefined,
    customBroll: (job.custom_broll as { url: string; description?: string | null }[] | null) ?? undefined,
  })
}
