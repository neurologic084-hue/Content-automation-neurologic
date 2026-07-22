import { chatCompletion, MODELS } from './openrouter'
import type { SfxCategory } from './sound-effects'

export interface WordTimestamp {
  text: string
  start: number
  end: number
}

export interface BRollInsertionPoint {
  insertAt: number
  duration: number
}

export interface MediaFile {
  url: string
  name: string
  type: 'video' | 'image'
}

export interface ScenePlan {
  insertAt: number
  duration: number
  sentenceContext: string
  mediaType: 'video' | 'image' | 'skip'
  sfxCategory: SfxCategory | 'none'
}

// Finds the sentence the speaker was finishing right before a given timestamp —
// gives the AI real content to judge "does this moment call for a visual, and
// what kind" instead of guessing blind from silence gaps alone.
function sentenceBefore(words: WordTimestamp[], beforeTime: number): string {
  const upTo = words.filter(w => w.start < beforeTime)
  if (!upTo.length) return ''

  let sentenceStart = 0
  for (let i = upTo.length - 2; i >= 0; i--) {
    if (/[.!?]$/.test(upTo[i].text)) {
      sentenceStart = i + 1
      break
    }
  }
  return upTo.slice(sentenceStart).map(w => w.text).join(' ').trim()
}

// One batched AI call covers every candidate point — far cheaper and more
// consistent than one call per point, and lets the model see the whole
// video's arc when deciding pacing (e.g. not skip+video+skip+video).
export async function planScenes(
  words: WordTimestamp[],
  insertionPoints: BRollInsertionPoint[],
  hook: string,
  cta: string,
  hasImages: boolean,
): Promise<ScenePlan[]> {
  if (!insertionPoints.length) return []

  const candidates = insertionPoints.map((p, i) => ({
    ...p,
    sentenceContext: sentenceBefore(words, p.insertAt) || '(no clear sentence found near this moment)',
    index: i,
  }))

  const fallback: ScenePlan[] = candidates.map(c => ({
    insertAt: c.insertAt,
    duration: c.duration,
    sentenceContext: c.sentenceContext,
    mediaType: 'video',
    sfxCategory: 'whoosh',
  }))

  try {
    const list = candidates.map(c =>
      `${c.index + 1}. at ${c.insertAt.toFixed(1)}s, speaker just said: "${c.sentenceContext.slice(0, 200)}"`
    ).join('\n')

    const raw = await chatCompletion({
      model: MODELS.planner,
      temperature: 0.3,
      max_tokens: 500,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'You are planning visual and audio treatment for B-roll insertion points in a short-form talking-head video.',
          `Hook: ${hook}`,
          `CTA: ${cta}`,
          '',
          'Candidate moments (each is a natural pause in speech):',
          list,
          '',
          `Available media types: video${hasImages ? ', image' : ''} (image only if listed available)`,
          'Available sound effect categories: whoosh (neutral transition), impact (serious/dramatic moment), ding (positive/success moment), riser (building tension/anticipation), none (silent cut)',
          '',
          'For EACH moment, decide:',
          '- mediaType: "video" for action/demonstration content, "image"' + (hasImages ? ' for a single concept/object/result being referenced' : ' (not available, use "video")') + ', or "skip" if this moment does not need a visual at all',
          '- sfxCategory: pick the category whose feel matches what was just said, or "none" if a visual cut alone is enough',
          '',
          'Rules:',
          '- Do not use the same sfxCategory for every single moment — vary it based on actual content.',
          '- "skip" is a valid and often correct choice — not every pause needs B-roll.',
          '- Return JSON only, one entry per candidate, in order:',
          '{"scenes": [{"mediaType": "video|image|skip", "sfxCategory": "whoosh|impact|ding|riser|none"}, ...]}',
        ].join('\n'),
      }],
    })

    const parsed = JSON.parse(raw) as { scenes?: { mediaType?: string; sfxCategory?: string }[] }
    const scenes = parsed.scenes ?? []
    if (scenes.length !== candidates.length) throw new Error(`expected ${candidates.length} scenes, got ${scenes.length}`)

    const VALID_MEDIA = new Set(['video', 'image', 'skip'])
    const VALID_SFX = new Set(['whoosh', 'impact', 'ding', 'riser', 'none'])

    const plans = candidates.map((c, i) => {
      const s = scenes[i]
      const mediaType = s?.mediaType && VALID_MEDIA.has(s.mediaType) ? s.mediaType as ScenePlan['mediaType'] : 'video'
      const sfxCategory = s?.sfxCategory && VALID_SFX.has(s.sfxCategory) ? s.sfxCategory as ScenePlan['sfxCategory'] : 'whoosh'
      return {
        insertAt: c.insertAt,
        duration: c.duration,
        sentenceContext: c.sentenceContext,
        mediaType: (mediaType === 'image' && !hasImages) ? 'video' as const : mediaType,
        sfxCategory,
      }
    })

    console.log('[scene-planner] plan:', plans.map(p => `${p.insertAt.toFixed(1)}s:${p.mediaType}/${p.sfxCategory}`).join(', '))
    return plans
  } catch (e) {
    console.warn('[scene-planner] planning failed, using video+whoosh fallback for all points:', (e as Error).message)
    return fallback
  }
}
