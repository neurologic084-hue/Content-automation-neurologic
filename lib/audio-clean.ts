// ── Audio cleaning chain + silence detection ──────────────────────────────────
// The Remotion variants' (v4-v7) entry point for making raw footage's dialogue
// premium before any cutting happens. The Submagic variants (v1-v3) do NOT come
// through here — Submagic cleans their audio inside its own render and Olympus
// leaves that dialogue verbatim.
//
//   1. Submagic Clean Audio (plan-included, primary) — a caption-less,
//      edit-less Submagic project with cleanAudio only; the cleaned audio is
//      extracted and remuxed over the ORIGINAL video stream so no cuts or
//      re-encodes ever touch the picture.
//   2. Auphonic (auphonic.com) — the BACKUP when Submagic fails or is over its
//      usage limit, so a full Submagic quota never blocks the render. Denoise +
//      reverb removal + adaptive leveler. Needs AUPHONIC_API_TOKEN; skipped
//      silently when unset. (Briefly removed 2026-07 while the account was out
//      of credits — restored once it was topped up.)
//   3. ElevenLabs audio isolation as the final fallback (lib/voice-isolation.ts).
//   4. Original audio if all are unavailable — a noisy render beats no render.
//
// Also exports detectSilences(): energy-based silence intervals from the
// CLEANED track, used as the second cut signal (transcript word timings often
// stretch across real pauses and hide them from gap-based cutting).

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { isolateVoiceInPlace } from './voice-isolation'
import { pollSubmagicJob } from './video-pipeline'
import { uploadToStorage, sweepStoragePrefix } from './storage'

const POLL_INTERVAL_MS = 5_000
const POLL_DEADLINE_MS = 6 * 60_000

function run(cmd: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr).slice(-500) || err.message)) : resolve(String(stdout) + String(stderr))
    )
  })
}

// Short-term RMS energy envelope of an audio file (100 Hz / 10 ms bins), zero-
// meaned. Used to align two versions of the same speech by CONTENT, surviving
// the waveform changes denoise/leveling introduce (energy shape is preserved).
async function energyEnvelope(srcPath: string): Promise<Float64Array> {
  const SR = 8000, WIN = 80 // 8 kHz decode, 80 samples/bin = 100 Hz envelope
  const pcm = `${srcPath}.env.pcm`
  try {
    await run(`ffmpeg -y -v error -i "${srcPath}" -ac 1 -ar ${SR} -f f32le "${pcm}"`)
    const buf = fs.readFileSync(pcm)
    const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4))
    const bins = Math.floor(samples.length / WIN)
    const env = new Float64Array(bins)
    let mean = 0
    for (let b = 0; b < bins; b++) {
      let s = 0
      for (let i = b * WIN; i < (b + 1) * WIN; i++) s += samples[i] * samples[i]
      env[b] = Math.sqrt(s / WIN)
      mean += env[b]
    }
    mean /= bins || 1
    for (let i = 0; i < bins; i++) env[i] -= mean
    return env
  } finally {
    try { if (fs.existsSync(pcm)) fs.unlinkSync(pcm) } catch { /* best-effort */ }
  }
}

// How many seconds Auphonic's returned audio must be shifted LEFT so its speech
// lines back up with the audio we sent it — i.e. the exact length of the free-
// tier promo it prepended. MEASURED by cross-correlating the two energy
// envelopes, not guessed from a duration subtraction: the old cleanDur-videoDur
// estimate folded in the container-vs-stream and encoder-padding mismatches and
// could be ~2s off, which shoved the whole voice track ahead of the picture
// (v5 desync, 2026-07-20). Returns null if nothing correlates well enough to
// trust (e.g. paid plan with no promo, or a failed decode) so the caller can
// fall back to the old estimate.
async function detectPromoOffset(sentPath: string, returnedPath: string): Promise<number | null> {
  const ENV_HZ = 100, MAX_LAG_SEC = 20
  const [sent, returned] = await Promise.all([energyEnvelope(sentPath), energyEnvelope(returnedPath)])
  const maxLag = Math.round(MAX_LAG_SEC * ENV_HZ)
  const compare = Math.min(sent.length, returned.length) - maxLag
  if (compare <= ENV_HZ) return null // too short to correlate meaningfully
  let bestNcc = -Infinity, bestLag = 0
  for (let lag = 0; lag <= maxLag; lag++) {
    let dot = 0, ea = 0, eb = 0
    for (let i = 0; i < compare; i++) {
      const a = sent[i], b = returned[i + lag]
      dot += a * b; ea += a * a; eb += b * b
    }
    const ncc = dot / (Math.sqrt(ea * eb) + 1e-9)
    if (ncc > bestNcc) { bestNcc = ncc; bestLag = lag }
  }
  // Weak peak = the two tracks don't actually line up; don't trust the number.
  if (bestNcc < 0.5) return null
  return bestLag / ENV_HZ
}

// ── Auphonic backup cleaner ───────────────────────────────────────────────────
const AUPHONIC_BASE = 'https://auphonic.com/api'

// Auphonic algorithm settings (field names verified against the account's
// /api/info/algorithms.json). Cleaning ONLY — no cutter/silence/filler, since the
// edit engine owns all cuts against word timings (an audio-only cut would desync
// the picture). speech_isolation is the key control: it removes room reverb +
// background (not just hiss), which is what actually kills echo.
const AUPHONIC_ALGORITHMS: Record<string, string> = {
  denoise: 'true',
  denoisemethod: 'speech_isolation',
  denoiseamount: '100',
  debreathamount: '12',
  filtering: 'true',
  filtermethod: 'hipfilter',
  leveler: 'true',
  normloudness: 'true',
  loudnesstarget: '-16',
}

function auphonicAuth(): string | null {
  if (process.env.AUPHONIC_API_TOKEN) return `bearer ${process.env.AUPHONIC_API_TOKEN}`
  if (process.env.AUPHONIC_USERNAME && process.env.AUPHONIC_PASSWORD) {
    return `Basic ${Buffer.from(`${process.env.AUPHONIC_USERNAME}:${process.env.AUPHONIC_PASSWORD}`).toString('base64')}`
  }
  return null
}

// Runs the extracted dialogue through Auphonic and remuxes the cleaned track
// back over the video. Throws on failure so the caller can fall down the chain.
async function auphonicCleanInPlace(videoPath: string, auth: string): Promise<void> {
  const rawAudio = `${videoPath}.raw.mp3`
  const cleanAudio = `${videoPath}.auphonic`
  const remuxed = `${videoPath}.clean.mp4`
  try {
    await run(`ffmpeg -y -i "${videoPath}" -vn -c:a libmp3lame -q:a 2 "${rawAudio}"`)

    const form = new globalThis.FormData()
    form.append('title', `olympus-${Date.now()}`)
    form.append('action', 'start')
    for (const [k, v] of Object.entries(AUPHONIC_ALGORITHMS)) form.append(k, v)
    form.append('input_file', new Blob([fs.readFileSync(rawAudio)], { type: 'audio/mpeg' }), 'audio.mp3')

    const submit = await fetch(`${AUPHONIC_BASE}/simple/productions.json`, {
      method: 'POST',
      headers: { Authorization: auth },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    if (!submit.ok) throw new Error(`Auphonic submit failed (${submit.status}): ${(await submit.text()).slice(0, 200)}`)
    const { data } = await submit.json() as { data: { uuid: string } }
    if (!data?.uuid) throw new Error('Auphonic returned no production uuid')

    // Poll until done (status 3) or error (status 2).
    const deadline = Date.now() + POLL_DEADLINE_MS
    let downloadUrl: string | null = null
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const res = await fetch(`${AUPHONIC_BASE}/production/${data.uuid}.json`, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) continue
      const body = await res.json() as { data: { status: number; status_string?: string; error_message?: string; algorithms?: Record<string, unknown>; output_files?: Array<{ download_url?: string }> } }
      if (body.data.status === 3) {
        downloadUrl = body.data.output_files?.[0]?.download_url ?? null
        const a = body.data.algorithms ?? {}
        console.log(`[audio-clean] Auphonic applied: denoise=${a.denoise} method=${a.denoisemethod} amount=${a.denoiseamount} leveler=${a.leveler}`)
        break
      }
      if (body.data.status === 2) throw new Error(`Auphonic processing error: ${body.data.error_message ?? body.data.status_string}`)
    }
    if (!downloadUrl) throw new Error('Auphonic timed out or returned no output file')

    const dl = await fetch(downloadUrl, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120_000) })
    if (!dl.ok) throw new Error(`Auphonic download failed: HTTP ${dl.status}`)
    fs.writeFileSync(cleanAudio, Buffer.from(await dl.arrayBuffer()))

    // Free-tier Auphonic PREPENDS a spoken promo ("Free audio post-production by
    // auphonic.com"), which shifts every later word and desyncs the voice from
    // the picture unless trimmed by its EXACT length. Measure that length by
    // correlating the returned audio against the audio we sent (rawAudio) — the
    // lag that lines their speech back up IS the promo. The old duration-diff
    // estimate is kept only as a fallback when the correlation is too weak to
    // trust. A paid plan produces no promo, so the offset comes back ≈0.
    const dur = async (f: string) =>
      parseFloat(await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`))
    const measured = await detectPromoOffset(rawAudio, cleanAudio).catch(() => null)
    let promo: number
    if (measured != null) {
      promo = measured
      console.log(`[audio-clean] Auphonic promo measured at ${promo.toFixed(2)}s (content-aligned)`)
    } else {
      const [audioDur, cleanDur] = [await dur(rawAudio), await dur(cleanAudio)]
      promo = cleanDur - audioDur
      console.warn(`[audio-clean] promo correlation weak — falling back to duration estimate ${promo.toFixed(2)}s`)
    }
    const ssArg = promo > 0.25 ? `-ss ${promo.toFixed(3)} ` : ''
    if (ssArg) console.log(`[audio-clean] trimming ${promo.toFixed(2)}s Auphonic free-tier promo from the head (a paid plan removes it)`)

    await run(
      `ffmpeg -y -i "${videoPath}" ${ssArg}-i "${cleanAudio}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "${remuxed}"`
    )
    if (!fs.existsSync(remuxed)) throw new Error('Auphonic remux produced no output')
    fs.renameSync(remuxed, videoPath)
  } finally {
    for (const f of [rawAudio, cleanAudio, remuxed]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best-effort */ }
    }
  }
}

// Submagic Clean Audio as a pure audio processor: submit a project with every
// editing feature off, wait for the render, then pull ONLY its audio track
// back onto the original video (c:v copy — zero picture quality loss, and no
// cuts were requested so durations match). Throws on failure so the caller
// can fall down the chain.
async function submagicCleanInPlace(videoPath: string): Promise<void> {
  const fileName = path.basename(videoPath)
  const publicUrl = await uploadToStorage(videoPath, fileName, `clean-${Date.now()}`, 'audio-clean')

  // These uploads are one-shot (Submagic downloads the file within minutes)
  // but were previously kept forever. Sweep yesterday's leftovers each run;
  // the fresh upload above is well inside the age cutoff.
  void sweepStoragePrefix('audio-clean/', 24)

  const res = await fetch('https://api.submagic.co/v1/projects', {
    method: 'POST',
    headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `audio-clean-${fileName.slice(0, 40)}`,
      language: 'en',
      videoUrl: publicUrl,
      cleanAudio: true,
      disableCaptions: true,
      magicBrolls: false,
      magicZooms: false,
      removeBadTakes: false,
      // removeSilencePace deliberately omitted — no cutting of any kind here.
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Submagic clean-audio submit failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const { id } = await res.json() as { id: string }
  if (!id) throw new Error('Submagic returned no project id')

  const deadline = Date.now() + POLL_DEADLINE_MS
  let downloadUrl: string | null = null
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
    const result = await pollSubmagicJob(id).catch(() => null)
    if (!result || result.status === 'processing') continue
    if (result.status === 'failed') throw new Error(result.error ?? 'Submagic clean-audio processing failed')
    downloadUrl = result.downloadUrl
    break
  }
  if (!downloadUrl) throw new Error('Submagic clean-audio timed out or returned no output')

  const cleanedVideo = `${videoPath}.smclean.mp4`
  const remuxed = `${videoPath}.clean.mp4`
  try {
    const dl = await fetch(downloadUrl, { signal: AbortSignal.timeout(180_000) })
    if (!dl.ok) throw new Error(`Submagic clean-audio download failed: HTTP ${dl.status}`)
    fs.writeFileSync(cleanedVideo, Buffer.from(await dl.arrayBuffer()))

    await run(
      `ffmpeg -y -i "${videoPath}" -i "${cleanedVideo}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "${remuxed}"`
    )
    if (!fs.existsSync(remuxed)) throw new Error('Submagic clean-audio remux produced no output')
    fs.renameSync(remuxed, videoPath)
  } finally {
    for (const f of [cleanedVideo, remuxed]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best-effort */ }
    }
  }
}

export type AudioCleaner = 'submagic' | 'auphonic' | 'elevenlabs' | 'none'

// Only the Remotion variants (v4-v7) call this — they start from raw footage
// that nothing has cleaned yet. The Submagic variants (v1-v3) are cleaned
// inside their own render and are never passed through here; see
// retrieveAndStoreSubmagicResult.
export async function cleanAudioInPlace(videoPath: string): Promise<AudioCleaner> {
  // Escape hatch for TEST renders: Submagic Clean Audio spends a real Submagic
  // project per variant, which is pure waste when the point of the render is to
  // prove the pipeline works. SKIP_SUBMAGIC_CLEAN=1 goes straight to ElevenLabs
  // isolation. Never set in normal operation — client renders want the primary
  // cleaner.
  const skipSubmagic = process.env.SKIP_SUBMAGIC_CLEAN === '1'
  if (skipSubmagic) {
    console.warn('[audio-clean] SKIP_SUBMAGIC_CLEAN=1 — test render, skipping the Submagic cleaner')
  }

  // 1. Submagic (primary — plan-included voice enhancement).
  if (process.env.SUBMAGIC_API_KEY && !skipSubmagic) {
    try {
      await submagicCleanInPlace(videoPath)
      console.log('[audio-clean] Submagic: cleaned dialogue remuxed over original picture')
      return 'submagic'
    } catch (e) {
      console.warn('[audio-clean] Submagic clean-audio failed/over-limit, falling back to Auphonic:', (e as Error).message)
    }
  } else if (!skipSubmagic) {
    console.warn('[audio-clean] SUBMAGIC_API_KEY not set — falling back to Auphonic')
  }

  // 2. Auphonic (backup — keeps a full Submagic quota from blocking the render).
  const auth = auphonicAuth()
  if (auth) {
    try {
      await auphonicCleanInPlace(videoPath, auth)
      console.log('[audio-clean] Auphonic: cleaned dialogue remuxed over original picture')
      return 'auphonic'
    } catch (e) {
      console.warn('[audio-clean] Auphonic failed, falling back to ElevenLabs isolation:', (e as Error).message)
    }
  } else {
    console.warn('[audio-clean] AUPHONIC_API_TOKEN not set — falling back to ElevenLabs isolation')
  }

  // 3. ElevenLabs isolation. 4. Original audio if that fails too.
  const isolated = await isolateVoiceInPlace(videoPath)
  return isolated ? 'elevenlabs' : 'none'
}

// Energy-based silence intervals (source-time seconds) from the cleaned track.
// Run AFTER cleaning: denoised audio gives silencedetect a clean floor.
export async function detectSilences(
  videoPath: string,
  opts: { noiseDb?: number; minDurationSec?: number } = {},
): Promise<Array<[number, number]>> {
  const noise = opts.noiseDb ?? -38
  const minDur = opts.minDurationSec ?? 0.35
  try {
    const out = await run(
      `ffmpeg -v info -i "${videoPath}" -af "silencedetect=noise=${noise}dB:d=${minDur}" -f null - 2>&1`
    )
    const silences: Array<[number, number]> = []
    let pending: number | null = null
    for (const line of out.split('\n')) {
      const start = line.match(/silence_start:\s*([\d.]+)/)
      const end = line.match(/silence_end:\s*([\d.]+)/)
      if (start) pending = parseFloat(start[1])
      if (end && pending !== null) {
        silences.push([pending, parseFloat(end[1])])
        pending = null
      }
    }
    console.log(`[audio-clean] ${silences.length} silence interval(s) ≥${minDur}s detected`)
    return silences
  } catch (e) {
    console.warn('[audio-clean] silence detection failed, cutting from word gaps only:', (e as Error).message)
    return []
  }
}
