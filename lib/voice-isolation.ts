// ── Voice isolation via ElevenLabs Audio Isolation ────────────────────────────
// The Remotion-only path's replacement for Submagic's cleanAudio: extract the
// audio track, run it through ElevenLabs' audio-isolation endpoint (strips
// background noise, keeps dialogue), and remux it back over the video. Fully
// best-effort — any failure returns the original file untouched, because a
// noisy render beats no render.

import fs from 'fs'
import { exec } from 'child_process'
import FormData from 'form-data'

function run(cmd: string, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr).slice(-500) || err.message)) : resolve()
    )
  })
}

// Isolates dialogue in-place: `videoPath` ends up with the cleaned audio track.
export async function isolateVoiceInPlace(videoPath: string): Promise<boolean> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) {
    console.warn('[voice-isolation] ELEVENLABS_API_KEY not set — skipping')
    return false
  }

  const rawAudio = `${videoPath}.raw.mp3`
  const cleanAudio = `${videoPath}.clean.mp3`
  const remuxed = `${videoPath}.iso.mp4`
  try {
    await run(`ffmpeg -y -i "${videoPath}" -vn -c:a libmp3lame -q:a 2 "${rawAudio}"`)

    const stat = fs.statSync(rawAudio)
    if (stat.size > 45 * 1024 * 1024) {
      console.warn('[voice-isolation] audio too large for isolation API — skipping')
      return false
    }

    const form = new FormData()
    form.append('audio', fs.createReadStream(rawAudio), { filename: 'audio.mp3', contentType: 'audio/mpeg' })

    const res = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST',
      headers: { 'xi-api-key': key, ...form.getHeaders() },
      body: form as unknown as BodyInit,
      signal: AbortSignal.timeout(240_000),
    })
    if (!res.ok) {
      console.warn(`[voice-isolation] API failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
      return false
    }
    fs.writeFileSync(cleanAudio, Buffer.from(await res.arrayBuffer()))

    await run(
      `ffmpeg -y -i "${videoPath}" -i "${cleanAudio}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -movflags +faststart "${remuxed}"`
    )
    if (!fs.existsSync(remuxed)) return false
    fs.renameSync(remuxed, videoPath)
    console.log('[voice-isolation] dialogue isolated and remuxed')
    return true
  } catch (e) {
    console.warn('[voice-isolation] failed, keeping original audio:', (e as Error).message)
    return false
  } finally {
    for (const f of [rawAudio, cleanAudio, remuxed]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best-effort */ }
    }
  }
}
