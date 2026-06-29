import { chatCompletion, MODELS } from '../openrouter'
import { MUSIC_CATALOG } from './catalog'
import { MUSIC_CATEGORIES, NEUTRAL_CATEGORY } from './types'
import type { MusicCategory, MusicSelectionContext, MusicTrack } from './types'

// ── Mood-category track selection ─────────────────────────────────────────────
// Matches the video's mood to a music category (the creator's folders), then
// picks a track from it. If nothing fits confidently it falls back to a safe
// neutral category, so Smart always returns a fitting track when the library has
// any. Never throws.

function tracksIn(category: MusicCategory): MusicTrack[] {
  return MUSIC_CATALOG.filter(t => t.categories.includes(category))
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Fast path: if the mood tag already names a category we have, use it directly.
function directMatch(moodTag: string | null, available: MusicCategory[]): MusicCategory | null {
  const m = (moodTag ?? '').toLowerCase()
  if (!m) return null
  return available.find(c => m.includes(c)) ?? null
}

async function chooseCategory(
  ctx: MusicSelectionContext,
  available: MusicCategory[],
): Promise<MusicCategory | null> {
  const direct = directMatch(ctx.moodTag, available)
  if (direct) return direct

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: [
          'Pick the single best background-music mood for this short-form talking-head video.',
          `Hook: "${ctx.hook.slice(0, 200)}"`,
          `Mood: ${ctx.moodTag ?? 'unspecified'}${ctx.scriptFormat ? `, format: ${ctx.scriptFormat}` : ''}`,
          '',
          `Choose exactly one from: ${available.join(', ')}.`,
          'Reply with ONLY that one word.',
        ].join('\n'),
      }],
    })
    const picked = raw.trim().toLowerCase().replace(/[^a-z]/g, '') as MusicCategory
    if (available.includes(picked)) return picked
  } catch (e) {
    console.warn('[music-library] category pick failed, using neutral fallback:', (e as Error).message)
  }
  return null
}

export async function selectTrack(ctx: MusicSelectionContext): Promise<MusicTrack | null> {
  if (!MUSIC_CATALOG.length) return null

  const available = MUSIC_CATEGORIES.filter(c => tracksIn(c).length)
  if (!available.length) return null

  const category = await chooseCategory(ctx, available)

  // Chosen category → neutral fallback → whole library, so we always land on a track.
  let pool = category ? tracksIn(category) : []
  let usedCategory: MusicCategory | 'any' = category ?? NEUTRAL_CATEGORY
  if (!pool.length) {
    pool = tracksIn(NEUTRAL_CATEGORY)
    usedCategory = NEUTRAL_CATEGORY
  }
  if (!pool.length) {
    pool = MUSIC_CATALOG
    usedCategory = 'any'
  }

  const track = pickRandom(pool)
  console.log(`[music-library] selected "${track.title}" (category: ${usedCategory})`)
  return track
}
