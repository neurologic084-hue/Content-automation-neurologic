import fs from 'fs'
import os from 'os'
import path from 'path'
import { chatCompletion, MODELS } from './openrouter'

const ELEVENLABS_SOUND_GENERATION_URL = 'https://api.elevenlabs.io/v1/sound-generation'

async function buildMusicPrompt(
  hook: string,
  moodTag: string | null,
  scriptFormat?: string,
): Promise<string> {
  const fallback = [
    'Calm modern short-form background music bed for a talking-head video.',
    'Subtle warm lo-fi pop, soft pads, gentle muted percussion, light hopeful movement.',
    'No vocals, no lyrics, no rock, no electric guitar, no EDM, no heavy drums, no aggressive synths.',
    'Trend-adjacent social media background music, but understated and non-distracting.',
  ].join(' ')

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.25,
      max_tokens: 140,
      messages: [{
        role: 'user',
        content: [
          'Write one ElevenLabs sound-generation prompt for background music under a short-form talking-head video.',
          `Hook: ${hook.slice(0, 240)}`,
          `Mood: ${moodTag ?? 'calm'}`,
          `Format: ${scriptFormat ?? 'shortform talking-head'}`,
          '',
          'Hard rules:',
          '- Calm, subtle, modern, trend-adjacent shortform background music.',
          '- Must fit the spoken video and stay emotionally supportive.',
          '- Very low-energy bed; it should never feel like rock, electric guitar, EDM, trap, cinematic trailer, or hype music.',
          '- No vocals, no lyrics, no sung melody, no harsh lead synth, no heavy drums.',
          '- Prefer warm lo-fi pop, ambient pop, soft pads, light muted percussion, gentle plucks, airy texture.',
          '- One concise prompt only. No markdown.',
        ].join('\n'),
      }],
    })

    const prompt = raw.replace(/^["']|["']$/g, '').trim()
    if (!prompt) return fallback

    return [
      prompt,
      'No vocals, no lyrics, no rock, no electric guitar, no EDM, no heavy drums.',
      'Keep it calm, subtle, soft, low energy, and suitable under speech.',
    ].join(' ')
  } catch {
    return fallback
  }
}

export async function generateElevenLabsMusic(
  hook: string,
  moodTag: string | null,
  scriptFormat: string | undefined,
  targetDurationSeconds: number,
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    console.warn('[elevenlabs-music] ELEVENLABS_API_KEY not set; skipping music')
    return null
  }

  // Generate a short loopable bed and let FFmpeg loop it over the whole video.
  // This keeps generation cost lower than creating a full-length track per variant.
  const durationSeconds = Math.max(8, Math.min(22, Math.round(targetDurationSeconds)))
  const text = await buildMusicPrompt(hook, moodTag, scriptFormat)

  console.log(`[elevenlabs-music] generating ${durationSeconds}s music bed: ${text.slice(0, 240)}`)
  try {
    const res = await fetch(ELEVENLABS_SOUND_GENERATION_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        duration_seconds: durationSeconds,
        prompt_influence: 0.35,
      }),
      signal: AbortSignal.timeout(180_000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.warn(`[elevenlabs-music] generation failed (${res.status}): ${err.slice(0, 300)}`)
      return null
    }

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength < 1024) {
      console.warn('[elevenlabs-music] generated audio was unexpectedly small; skipping music')
      return null
    }

    const out = path.join(os.tmpdir(), `elevenlabs_music_${Date.now()}.mp3`)
    fs.writeFileSync(out, buf)
    console.log(`[elevenlabs-music] generated music file ${(buf.byteLength / 1024).toFixed(1)} KB`)
    return out
  } catch (e) {
    console.warn('[elevenlabs-music] generation error:', (e as Error).message)
    return null
  }
}
