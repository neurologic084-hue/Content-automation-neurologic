// ── Audio cleaning chain + silence detection ──────────────────────────────────
// One entry point for making the dialogue premium before any cutting happens:
//
//   1. Submagic Clean Audio (plan-included, primary) — a caption-less,
//      edit-less Submagic project with cleanAudio only; the cleaned audio is
//      extracted and remuxed over the ORIGINAL video stream so no cuts or
//      re-encodes ever touch the picture.
//   2. Auphonic (auphonic.com) when AUPHONIC_API_TOKEN (or username/password)
//      is set — professional denoise + high-pass + adaptive leveler + loudness
//      normalization to -16 LUFS. Cutting/filler algorithms are deliberately
//      NOT enabled: the edit engine owns all cuts against word timings, and an
//      audio-only cut would desync the video.
//   3. ElevenLabs audio isolation as the next fallback (lib/voice-isolation.ts).
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

const AUPHONIC_BASE = 'https://auphonic.com/api'
const POLL_INTERVAL_MS = 5_000
const POLL_DEADLINE_MS = 6 * 60_000

// Auphonic algorithm settings (exact field names + allowed values verified
// against the account's /api/info/algorithms.json schema). Cleaning ONLY — no
// cutter/silence/filler fields, since the edit engine owns all cuts against
// word timings and an audio-only cut would desync the video.
//
// ECHO/REVERB is the key control: the DEFAULT denoiser only removes steady
// background noise, NOT room reverb. `speech_isolation` isolates the dry voice
// from the room — that's what kills echo — and denoiseamount sets how hard.
const AUPHONIC_ALGORITHMS: Record<string, string> = {
  denoise: 'true',
  denoisemethod: 'speech_isolation', // removes room reverb + background, not just hiss
  denoiseamount: '100',              // full — the demo footage had heavy echo (tunable: 24/30/36/100)
  debreathamount: '12',              // tame prominent breaths/sighs a strict audit flagged
  filtering: 'true',
  filtermethod: 'hipfilter',         // high-pass for low-end rumble/hum. (studiovoice — AI studio-mic resynthesis — measured no gain over this on test footage and risks over-processing, since speech_isolation already resynthesizes; swap it in per-source if a clip needs more.)
  leveler: 'true',                   // adaptive leveler for consistent volume
  normloudness: 'true',
  loudnesstarget: '-16',             // short-form loudness
  // gate (noise gate between words) + crossgate (mic-bleed) default ON already.
}

function run(cmd: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr).slice(-500) || err.message)) : resolve(String(stdout) + String(stderr))
    )
  })
}

function auphonicAuth(): string | null {
  if (process.env.AUPHONIC_API_TOKEN) return `bearer ${process.env.AUPHONIC_API_TOKEN}`
  if (process.env.AUPHONIC_USERNAME && process.env.AUPHONIC_PASSWORD) {
    return `Basic ${Buffer.from(`${process.env.AUPHONIC_USERNAME}:${process.env.AUPHONIC_PASSWORD}`).toString('base64')}`
  }
  return null
}

// Runs the extracted dialogue through Auphonic and remuxes the cleaned track
// back over the video. Throws on failure so the caller can fall back.
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
        // Prove the settings took — the simple API silently drops unknown fields.
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

    // Free-tier Auphonic PREPENDS a spoken promo ("Free audio post-production
    // by auphonic.com") to the output. Anything that changes audio length
    // desyncs it from the video, so trim the head by the exact length
    // difference and clamp the tail with -shortest.
    const dur = async (f: string) =>
      parseFloat(await run(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`))
    const [videoDur, cleanDur] = [await dur(videoPath), await dur(cleanAudio)]
    const promo = cleanDur - videoDur
    const ssArg = promo > 0.25 ? `-ss ${promo.toFixed(3)} ` : ''
    if (ssArg) console.log(`[audio-clean] trimming ${promo.toFixed(1)}s Auphonic free-tier promo from the head (a paid plan removes it)`)

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

export async function cleanAudioInPlace(videoPath: string): Promise<AudioCleaner> {
  if (process.env.SUBMAGIC_API_KEY) {
    try {
      await submagicCleanInPlace(videoPath)
      console.log('[audio-clean] Submagic: cleaned dialogue remuxed over original picture')
      return 'submagic'
    } catch (e) {
      console.warn('[audio-clean] Submagic clean-audio failed, falling down the chain:', (e as Error).message)
    }
  }
  const auth = auphonicAuth()
  if (auth) {
    try {
      await auphonicCleanInPlace(videoPath, auth)
      console.log('[audio-clean] Auphonic: denoised, leveled, normalized to -16 LUFS')
      return 'auphonic'
    } catch (e) {
      console.warn('[audio-clean] Auphonic failed, falling back to ElevenLabs isolation:', (e as Error).message)
    }
  }
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
