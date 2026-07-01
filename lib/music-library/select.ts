import { chatCompletion, MODELS } from '../openrouter'
import { MUSIC_CATALOG } from './catalog'
import { MUSIC_CATEGORIES, NEUTRAL_CATEGORY } from './types'
import type { MusicCategory, MusicSelectionContext, MusicTrack } from './types'

// ── Mood-category track selection ─────────────────────────────────────────────
// Matches the video's mood to a music category (the creator's folders), then
// picks the best-fitting track from it using each track's sound profile
// (describe-tracks.ts). Falls back to a safe neutral category, and to a random
// pick if profiles are missing, so Smart always returns a fitting track when the
// library has any. Never throws.

const MAX_CANDIDATES = 30  // cap profiles sent to the picker (token budget)

function tracksIn(category: MusicCategory): MusicTrack[] {
  return MUSIC_CATALOG.filter(t => t.categories.includes(category))
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Rough energy the video wants, used only to pre-trim a large candidate pool
// before the model makes the real call. Prefers Gemini's read of the actual
// footage energy when present; falls back to keywords in the mood tag.
function targetEnergy(ctx: MusicSelectionContext): number {
  if (ctx.profile) {
    // Content-profile energy is low/medium/high; map onto the 1-10 track scale.
    // Nudge down for sensitive footage so we never over-energize an emotional clip.
    const base = ctx.profile.energy === 'high' ? 7 : ctx.profile.energy === 'medium' ? 5 : 3
    return ctx.profile.sensitivity === 'medical_emotional' ? Math.min(base, 3) : base
  }
  const m = (ctx.moodTag ?? '').toLowerCase()
  if (/energet|bold|hype|gangster/.test(m)) return 7
  if (/happy|motivat|funny/.test(m)) return 5
  if (/calm|educat|empath|story|sad|emotional|inspir|curious/.test(m)) return 3
  return 4
}

// A compact "what this clip actually is" block from Gemini's read of the footage,
// injected into the matcher prompts so the pick reflects the real video, not just
// the typed mood tag. Empty string when no profile/transcript is available.
function videoContextBlock(ctx: MusicSelectionContext): string {
  const p = ctx.profile
  if (!p && !ctx.transcript) return ''
  const lines: string[] = ['', 'What the footage actually is (from watching the video — weight this heavily):']
  if (p) {
    lines.push(`- Energy ${p.energy}, pace ${p.speechPace}, tone ${p.sensitivity}, format ${p.format}`)
    if (p.emphasisPhrases.length) lines.push(`- Key lines: ${p.emphasisPhrases.slice(0, 4).join(' | ')}`)
  }
  if (ctx.transcript) lines.push(`- Transcript (what is said): "${ctx.transcript.slice(0, 600)}"`)
  return lines.join('\n')
}

// One compact line per track for the picker: id + what it sounds like + fit hints.
function candidateLine(t: MusicTrack): string {
  const p = t.profile!
  return `${t.id} | ${t.title} — ${p.genre}, energy ${p.energy}, ${p.moodWords.slice(0, 4).join('/')}`
    + ` · good for: ${p.goodFor.slice(0, 2).join(', ')} · avoid: ${p.avoidWhen.slice(0, 2).join(', ')}`
}

// Rank the best-fitting tracks from a pool by their sound profiles, best-first
// (up to 5). Returning a ranked shortlist — rather than only the single best —
// lets selectTrack hand each variant a DIFFERENT good-fit track so the versions
// vary musically. Temperature 0 so every variant on the same clip gets the SAME
// ranking, and the per-variant offset then guarantees distinct picks. Returns []
// on failure so the caller can fall back to a random pick.
async function rankByProfile(
  ctx: MusicSelectionContext,
  pool: MusicTrack[],
): Promise<MusicTrack[]> {
  let candidates = pool
  if (candidates.length > MAX_CANDIDATES) {
    const target = targetEnergy(ctx)
    candidates = [...pool]
      .sort((a, b) => Math.abs(a.profile!.energy - target) - Math.abs(b.profile!.energy - target))
      .slice(0, MAX_CANDIDATES)
  }

  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      max_tokens: 120,
      temperature: 0,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'Rank the best background-music tracks for this short-form talking-head video, best first.',
          `Hook: "${ctx.hook.slice(0, 200)}"`,
          `Mood: ${ctx.moodTag ?? 'unspecified'}${ctx.scriptFormat ? `, format: ${ctx.scriptFormat}` : ''}`,
          videoContextBlock(ctx),
          'Match the video\'s mood and energy. Reject any track whose "avoid" note fits this video.',
          '',
          'Candidates (id | title — sound · good for · avoid):',
          ...candidates.map(candidateLine),
          '',
          'Return JSON only: {"ranked": ["<id>", ...]} with up to 5 ids, best first.',
        ].join('\n'),
      }],
    })
    // Some models append prose after the JSON despite json mode — parse the raw
    // first, and if that fails, slice out just the {...} object and retry.
    let parsed: { ranked?: string[] }
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    }
    const byId = new Map(candidates.map(t => [t.id, t]))
    const ranked = (parsed.ranked ?? [])
      .map(id => byId.get(typeof id === 'string' ? id.trim() : ''))
      .filter((t): t is MusicTrack => !!t)
    if (ranked.length) return ranked
    console.warn('[music-library] ranker returned no known ids, falling back')
  } catch (e) {
    console.warn('[music-library] profile ranking failed, using random:', (e as Error).message)
  }
  return []
}

// Stable per-variant offset into the ranked shortlist so each variant lands on a
// different track (our-v1 -> 0, our-v2 -> 1, ...). Hashes anything non-numeric.
function variantOffset(variantId?: string): number {
  if (!variantId) return 0
  const m = variantId.match(/(\d+)/)
  if (m) return Math.max(0, parseInt(m[1], 10) - 1)
  let h = 0
  for (let i = 0; i < variantId.length; i++) h = (h * 31 + variantId.charCodeAt(i)) >>> 0
  return h
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
          videoContextBlock(ctx),
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

  // Rank the pool by fit, then hand THIS variant a distinct rank so versions vary
  // musically. Random only if ranking can't run.
  const withProfiles = pool.filter(t => t.profile)
  let track: MusicTrack | null = null
  let how = 'random'
  if (withProfiles.length) {
    // Variety needs a shortlist of several fitting tracks. If the chosen category
    // is thin (e.g. only 2 "inspiring" tracks), top the ranking pool up with the
    // rest of the library — the ranker still surfaces the best-fitting ones first,
    // so variants get distinct-but-fitting tracks instead of repeating.
    const MIN_POOL = 6
    let rankPool = withProfiles
    if (rankPool.length < MIN_POOL) {
      const ids = new Set(rankPool.map(t => t.id))
      rankPool = [...rankPool, ...MUSIC_CATALOG.filter(t => t.profile && !ids.has(t.id))]
    }
    const ranked = await rankByProfile(ctx, rankPool)
    if (ranked.length) {
      const idx = variantOffset(ctx.variantId) % ranked.length
      track = ranked[idx]
      how = `profile-match #${idx + 1}/${ranked.length}`
    }
  }
  if (!track) track = pickRandom(pool)

  console.log(`[music-library] selected "${track.title}" (category: ${usedCategory}, ${how})`)
  return track
}
