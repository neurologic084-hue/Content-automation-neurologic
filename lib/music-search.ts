import fs from 'fs'
import os from 'os'
import path from 'path'
import { chatCompletion, MODELS } from './openrouter'

// ── Live royalty-free music search (Jamendo) ──────────────────────────────────
// Searches Jamendo's real catalog per-video instead of using a fixed local
// library. Filters to instrumental-only (never competes with the speaker's
// voice) and CC0/public-domain tracks only (zero attribution requirement —
// safe for commercial client content with no credit needed anywhere).
//
// Nothing is stored: the winning track is downloaded straight to a temp file,
// mixed into the video, then deleted in motion-renderer.ts's finally block —
// same pattern already used for B-roll clip downloads.

const JAMENDO_BASE = 'https://api.jamendo.com/v3.0'

interface JamendoTrack {
  id: string
  name: string
  artist_name: string
  duration: number
  audio: string
  audiodownload: string
  audiodownload_allowed: boolean
  license_ccurl: string
  musicinfo?: { tags?: { genres?: string[]; instruments?: string[]; vartags?: string[] } }
}

function isAttributionFree(licenseCcUrl: string): boolean {
  // CC0 / public domain dedication — the only CC variant with zero attribution
  // requirement. Every other CC license (by, by-sa, by-nc, by-nd, ...) has "by"
  // baked into its name for a reason: it requires crediting the artist.
  return /\/publicdomain\//i.test(licenseCcUrl) || /\/zero\//i.test(licenseCcUrl)
}

// AI derives search tags + tempo from the script's tone — keeps the search
// targeted instead of pulling Jamendo's generic "popular" tracks every time.
async function deriveSearchParams(
  hook: string,
  moodTag: string | null,
  scriptFormat?: string,
): Promise<{ tags: string; speed: string }> {
  const fallback = { tags: 'ambient,calm', speed: 'low' }
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{
        role: 'user',
        content: [
          `A short-form video has this opening hook: "${hook.slice(0, 200)}"`,
          `Mood: ${moodTag ?? 'unspecified'}${scriptFormat ? `, format: ${scriptFormat}` : ''}`,
          '',
          'Pick the best Jamendo music search tags and tempo for instrumental background music for this video.',
          'Reply with ONLY raw JSON, no markdown:',
          '{"tags": "comma,separated,genre,or,mood,tags (2-4 tags, lowercase, single words)", "speed": "one of: verylow, low, medium, high, veryhigh"}',
        ].join('\n'),
      }],
      max_tokens: 80,
      json: true,
    })
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as { tags?: string; speed?: string }
    if (!parsed.tags) return fallback
    return { tags: parsed.tags, speed: parsed.speed ?? fallback.speed }
  } catch {
    return fallback
  }
}

async function searchJamendo(tags: string, speed: string): Promise<JamendoTrack[]> {
  const clientId = process.env.JAMENDO_CLIENT_ID
  if (!clientId) {
    console.warn('[music-search] JAMENDO_CLIENT_ID not set — skipping music search')
    return []
  }

  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: '20',
    fuzzytags: tags,
    speed,
    vocalinstrumental: 'instrumental',
    include: 'musicinfo',
    audioformat: 'mp31',
  })

  try {
    const res = await fetch(`${JAMENDO_BASE}/tracks/?${params}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      console.warn(`[music-search] Jamendo search failed: HTTP ${res.status}`)
      return []
    }
    const data = await res.json() as { results?: JamendoTrack[] }
    const all = data.results ?? []
    const usable = all.filter(t => t.audiodownload_allowed && isAttributionFree(t.license_ccurl))
    console.log(`[music-search] Jamendo returned ${all.length} tracks, ${usable.length} attribution-free + downloadable`)
    return usable
  } catch (e) {
    console.warn('[music-search] Jamendo search error:', (e as Error).message)
    return []
  }
}

// AI picks the single best fit from the candidate list by name/artist/tags.
async function pickBestTrack(
  candidates: JamendoTrack[],
  hook: string,
  moodTag: string | null,
): Promise<JamendoTrack | null> {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  try {
    const list = candidates.map((t, i) => {
      const tags = [...(t.musicinfo?.tags?.genres ?? []), ...(t.musicinfo?.tags?.vartags ?? [])].slice(0, 5).join(', ')
      return `${i + 1}. "${t.name}" by ${t.artist_name} (${t.duration}s) — tags: ${tags || 'none'}`
    }).join('\n')

    const raw = await chatCompletion({
      model: MODELS.fast,
      messages: [{
        role: 'user',
        content: `A short-form video opens with: "${hook.slice(0, 200)}"\nMood: ${moodTag ?? 'unspecified'}\n\nWhich background track best fits this video's energy? Reply with only the number.\n\n${list}`,
      }],
      max_tokens: 10,
    })
    const idx = parseInt(raw.trim()) - 1
    if (idx >= 0 && idx < candidates.length) {
      console.log(`[music-search] AI picked: "${candidates[idx].name}" by ${candidates[idx].artist_name}`)
      return candidates[idx]
    }
  } catch (e) {
    console.warn('[music-search] track selection failed, using first candidate:', (e as Error).message)
  }
  return candidates[0]
}

async function downloadTrack(track: JamendoTrack): Promise<string> {
  const url = track.audiodownload || track.audio
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`Track download failed: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const out = path.join(os.tmpdir(), `music_${Date.now()}.mp3`)
  fs.writeFileSync(out, buf)
  return out
}

// Full pipeline: derive search params → search → AI-pick best fit → download
// to temp file. Returns null (never throws) if anything comes up empty —
// callers should skip music gracefully rather than fail the whole render.
export async function findAndDownloadMusic(
  hook: string,
  moodTag: string | null,
  scriptFormat?: string,
): Promise<string | null> {
  const { tags, speed } = await deriveSearchParams(hook, moodTag, scriptFormat)
  console.log(`[music-search] searching Jamendo: tags="${tags}" speed=${speed}`)

  const candidates = await searchJamendo(tags, speed)
  if (!candidates.length) {
    console.warn('[music-search] no attribution-free instrumental tracks found for this mood — skipping music')
    return null
  }

  const winner = await pickBestTrack(candidates, hook, moodTag)
  if (!winner) return null

  try {
    return await downloadTrack(winner)
  } catch (e) {
    console.warn('[music-search] download failed, skipping music:', (e as Error).message)
    return null
  }
}
