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
//   2. ElevenLabs audio isolation as the only fallback (lib/voice-isolation.ts).
//   3. Original audio if both are unavailable — a noisy render beats no render.
//
// Submagic is the ONLY cleaner. Auphonic was removed deliberately: it was a
// second, redundant vendor for a job Submagic already does in-plan, and its
// free tier prepended a spoken ad that had to be surgically trimmed back off.
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

export type AudioCleaner = 'submagic' | 'elevenlabs' | 'none'

// Only the Remotion variants (v4-v7) call this — they start from raw footage
// that nothing has cleaned yet. The Submagic variants (v1-v3) are cleaned
// inside their own render and are never passed through here; see
// retrieveAndStoreSubmagicResult.
export async function cleanAudioInPlace(videoPath: string): Promise<AudioCleaner> {
  if (process.env.SUBMAGIC_API_KEY) {
    try {
      await submagicCleanInPlace(videoPath)
      console.log('[audio-clean] Submagic: cleaned dialogue remuxed over original picture')
      return 'submagic'
    } catch (e) {
      console.warn('[audio-clean] Submagic clean-audio failed, falling back to ElevenLabs isolation:', (e as Error).message)
    }
  } else {
    console.warn('[audio-clean] SUBMAGIC_API_KEY not set — falling back to ElevenLabs isolation')
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
