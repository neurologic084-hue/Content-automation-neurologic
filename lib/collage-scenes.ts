// ── AI collage scenes (v7 test → v6) ──────────────────────────────────────────
// The Vox-explainer grammar adapted to the Koe short: for the 1-3 beats of the
// video that stock footage can never match (named entities, abstract claims,
// big numbers), build a LAYERED SCENE instead — a dark editorial canvas with
// AI-generated cutouts springing in, halftone/red-stroke print treatment, and
// the spoken payoff as the scene's own type.
//
// Split of responsibilities (mirrors lib/broll.ts):
//   planCollageScenes    — LLM proposes beats + image prompts; code validates
//   generateCollageItems — kie.ai generation → chromakey cutout → BrollItem[]
//
// Scenes render as layout:'cover' B-roll items carrying a `collage` payload
// (CollageScene in ShortEdit.tsx), so cover transitions, SFX risers, and
// caption steering all apply for free. Everything is best-effort: a scene
// whose cutouts fail to generate is dropped, and the stock B-roll gap-fill
// never knew it existed.

import fs from 'fs'
import path from 'path'
import { chatCompletion, MODELS } from './openrouter'
import { parseJsonLoose } from './json-loose'
import { generateImage, keyGreenscreen, hasImageGenKey, CHROMA_GREEN } from './image-gen'
import type { ContentProfile } from './video-analysis'
import type { EditedWord } from './edit-plan'
import { HOOK_PROTECT_SECONDS, CTA_PROTECT_SECONDS } from './broll'
import type { BrollItem, CollagePayload } from './broll'

export interface CollageScenePlan {
  start: number      // edited-timeline seconds
  duration: number
  kicker?: string
  headline: string
  stat?: string
  subjects: Array<{ prompt: string; size: 'hero' | 'support' }>
}

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)

// Per-variation planning personalities (same idea as lib/broll.ts): reruns
// should surface different beats and visual angles, not the same plan.
const VARIATION_NUDGE = [
  '- Favor the single biggest claim and the most concrete named entities.',
  '- Favor number/statistic moments, and slightly metaphorical subjects over literal ones.',
  '- Favor moments in the second half of the video.',
]

// ── Planning ──────────────────────────────────────────────────────────────────

export async function planCollageScenes(
  editedWords: EditedWord[],
  duration: number,
  profile: ContentProfile | null,
  variation = 0,
  // Windows already claimed by template graphics — collage scenes are B-roll,
  // so they steer around graphics exactly like stock covers do.
  busy: Array<{ start: number; duration: number }> = [],
  // Max-motion mode (v7 test): aim for a scene every ~11s instead of the
  // conservative 2-3 per video, and pack them closer together.
  dense = false,
): Promise<CollageScenePlan[]> {
  if (!hasImageGenKey()) {
    console.log('[collage] KIE_AI_API_KEY not set — skipping collage scenes (stock B-roll only)')
    return []
  }
  if (duration < 15 || editedWords.length < 20) return []

  // Dense mode targets a flat FIVE scenes (per feedback: show the motion
  // graphics). Short videos physically fit fewer — the spacing/edge rules
  // below still win over the target, so a 25s clip lands 3-4, never a cramped 5.
  const maxScenes = dense ? 5 : duration > 40 ? 3 : 2
  const minGap = dense ? 3.5 : 6
  const timed = editedWords.map(w => `${w.start.toFixed(1)} ${w.text}`).join(' ').slice(0, 6000)
  const contextLines = profile ? [
    `Video context: ${profile.format} content${profile.suggestedHookTitle ? ` — "${profile.suggestedHookTitle}"` : ''}.`,
    profile.emphasisPhrases.length ? `Key moments the speaker stresses: ${profile.emphasisPhrases.join('; ')}.` : '',
    profile.keyNumbers.length ? `Numbers the speaker actually says: ${profile.keyNumbers.join('; ')}.` : '',
  ].filter(Boolean) : []

  let candidates: Array<Partial<CollageScenePlan> & { subjects?: Array<{ prompt?: string; size?: string }> }> = []
  try {
    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.3,
      // Five scenes × two subjects each is a lot of JSON — too small a cap
      // truncates the response and only the first scene or two survive parsing.
      max_tokens: dense ? 2200 : 900,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are planning ILLUSTRATED COLLAGE SCENES for a dark, cinematic short-form',
          'talking-head edit (think Vox-explainer cutout collages: 1-2 photographic cutouts',
          'springing in over a dark editorial canvas, with the spoken claim as big type).',
          `Video duration: ${duration.toFixed(1)}s.`,
          dense
            ? `Plan EXACTLY ${maxScenes} scene(s) — one for every major beat of the video. Spread`
              + ' them across the whole runtime. If a beat has no obvious visual, illustrate its'
              + ' subject matter (the person, place, object, or profession being discussed).'
            : `Plan AT MOST ${maxScenes} scene(s) — only the beats that genuinely deserve one.`
              + ' Fewer is better than forced.',
          ...contextLines,
          'Transcript with word start times:',
          timed,
          '',
          dense
            ? `Choose ${maxScenes} moments spread evenly across the runtime — wherever the speaker`
              + ' makes a claim, names an entity/person/place/tool, lands a number, or describes'
              + ' a process. Every scene illustrates the subject matter being discussed at that'
              + ` moment. You MUST return ${maxScenes} scenes. For each scene return:`
            : 'Pick the 1-3 moments where the speaker makes their BIGGEST claim, names a'
              + ' specific entity/person/place, or lands a number — moments stock footage can'
              + ' never match. For each scene return:',
          '- start: the second the phrase begins (from the word times).',
          '- duration: 2.8 to 4.2 seconds.',
          '- kicker: the 2-4 small lead-in words as spoken (e.g. "It\'s the"). Optional.',
          '- headline: the 2-5 word payoff AS SPOKEN (quote the transcript, never invent).',
          '- stat: a number the speaker SAYS at that moment (e.g. "$36 trillion"). Optional —',
          '  omit unless a real number is spoken there.',
          `- subjects: ${dense ? 'TWO image-generation subjects per scene (hero + support) whenever the beat supports it, one otherwise' : '1-2 image-generation subjects that illustrate the claim'}. Each has:`,
          '  - prompt: a CONCRETE, PHYSICAL, photographable subject description (a person,',
          '    object, building, animal — e.g. "marble bank building facade", "vintage alarm',
          '    clock", "businessman in a suit pointing forward"). NEVER abstract ideas,',
          '    NEVER text/logos, NEVER charts. One single subject per prompt.',
          '  - size: "hero" for the main subject, "support" for a smaller second one.',
          '  Exactly one hero per scene; a support subject only when it adds meaning.',
          `Rules: never start before 4s, never end within the last 2s, scenes at least ${minGap}s`,
          'apart.',
          VARIATION_NUDGE[variation % VARIATION_NUDGE.length],
          'JSON only: {"scenes":[{"start","duration","kicker","headline","stat","subjects":[{"prompt","size"}]}]}',
        ].join('\n'),
      }],
    })
    const parsed = parseJsonLoose<{ scenes?: typeof candidates }>(raw)
    candidates = Array.isArray(parsed.scenes) ? parsed.scenes : []
    console.log(`[collage] LLM returned ${candidates.length} candidate scene(s) (target ${maxScenes})`)
  } catch (e) {
    console.warn('[collage] planning failed, skipping collage scenes:', (e as Error).message)
    return []
  }

  // Hard validation: the model proposes, the code enforces.
  const scenes: CollageScenePlan[] = []
  let lastEnd = -Infinity
  for (const c of candidates
    .filter(c => typeof c.start === 'number' && typeof c.headline === 'string' && c.headline.trim() && Array.isArray(c.subjects))
    .sort((a, b) => (a.start as number) - (b.start as number))) {
    // Collages render full-screen, so they are face-covering cutaways and get
    // the same hook/CTA protection as every other cutaway. This clamp used to
    // be a hardcoded 4/-2, quietly weaker than the shared guard — the one
    // remaining path that could cover her face in the opening seconds.
    const start = Number(Math.max(HOOK_PROTECT_SECONDS, c.start as number).toFixed(2))
    const dur = Number(Math.min(4.2, Math.max(2.8, typeof c.duration === 'number' ? c.duration : 3.4)).toFixed(2))
    if (start + dur > duration - CTA_PROTECT_SECONDS) continue
    if (start - lastEnd < minGap) continue
    if (busy.some(b => start < b.start + b.duration + 0.8 && start + dur > b.start - 0.8)) continue

    const subjects = (c.subjects ?? [])
      .filter(s => typeof s.prompt === 'string' && s.prompt.trim())
      .map(s => ({ prompt: clip(s.prompt, 120), size: (s.size === 'support' ? 'support' : 'hero') as 'hero' | 'support' }))
      .slice(0, 2)
    if (!subjects.length) continue
    // Exactly one hero: the first declared hero wins (or the first subject if
    // none declared); everything else demotes to support.
    const heroIdx = Math.max(0, subjects.findIndex(s => s.size === 'hero'))
    subjects.forEach((s, idx) => { s.size = idx === heroIdx ? 'hero' : 'support' })

    const headline = clip(c.headline, 48)
    if (headline.split(/\s+/).length > 6) continue
    scenes.push({
      start, duration: dur, headline,
      kicker: clip(c.kicker, 32) || undefined,
      stat: clip(c.stat, 20) || undefined,
      subjects,
    })
    lastEnd = start + dur
    if (scenes.length >= maxScenes) break
  }

  console.log(`[collage] planned ${scenes.length} scene(s): ${scenes.map(s => `"${s.headline}"@${s.start.toFixed(1)}s`).join(', ') || 'none'}`)
  return scenes
}

// ── Generation ────────────────────────────────────────────────────────────────

// The style contract every cutout is generated under. Chroma green + single
// centered subject makes the ffmpeg key reliable; the print/halftone treatment
// happens in-render (CollageScene), so the source stays a clean photo.
function cutoutPrompt(subject: string): string {
  return [
    `Editorial photograph of ${subject}.`,
    'A single subject only, centered, the entire subject fully visible with generous margin around it.',
    `Photographed against a flat, solid, uniform chroma-key green background (exactly ${CHROMA_GREEN}).`,
    'Even studio lighting, no shadows cast on the background, no reflections of the green on the subject.',
    'No text, no watermark, no logo, no border. High detail, realistic.',
  ].join(' ')
}

// Generate + key every scene's cutouts and return render-ready BrollItems
// (layout 'cover', file '' — the scene draws its own canvas). Scenes whose
// HERO cutout fails are dropped; a failed support cutout just leaves a
// one-cutout scene. Runs all generations in parallel (a handful of images).
export async function generateCollageItems(
  scenes: CollageScenePlan[],
  stageDir: string,
  publicPrefix: string,
): Promise<BrollItem[]> {
  if (!scenes.length) return []
  fs.mkdirSync(stageDir, { recursive: true })

  const items = await Promise.all(scenes.map(async (scene, si): Promise<BrollItem | null> => {
    const cutouts = (await Promise.all(scene.subjects.map(async (subj, ci) => {
      const rawPath = path.join(stageDir, `collage-${si}-${ci}-raw.png`)
      const keyedName = `collage-${si}-${ci}.png`
      const keyedPath = path.join(stageDir, keyedName)
      const ok = await generateImage(cutoutPrompt(subj.prompt), rawPath, {
        aspectRatio: '3:4',
        resolution: '1K',
      })
      if (!ok) return null
      if (!await keyGreenscreen(rawPath, keyedPath)) return null
      try { fs.unlinkSync(rawPath) } catch { /* best-effort */ }
      return { file: `${publicPrefix}/${keyedName}`, size: subj.size }
    }))).filter((c): c is NonNullable<typeof c> => c !== null)

    if (!cutouts.some(c => c.size === 'hero')) {
      console.warn(`[collage] hero cutout failed for "${scene.headline}" — scene dropped`)
      return null
    }
    const collage: CollagePayload = {
      kicker: scene.kicker,
      headline: scene.headline,
      stat: scene.stat,
      cutouts,
    }
    return {
      start: scene.start,
      duration: scene.duration,
      file: '',
      kind: 'image',
      layout: 'cover',
      collage,
    }
  }))

  const resolved = items.filter((i): i is BrollItem => i !== null)
  console.log(`[collage] generated ${resolved.length}/${scenes.length} scene(s)`)
  return resolved
}
