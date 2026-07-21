import FormData from 'form-data'
import { chatCompletion, MODELS } from './openrouter'
import type { CaptionLane } from './variant-specs'
import type { ContentProfile } from './video-analysis'
import type { GradeMode } from './color-grade'
import type { BrollMode, BrollSource } from './broll'

// Per-render background-music choice, picked in the video studio and stored on
// each variant. 'smart' = pick a mood-matched track from the curated library
// (with a safe neutral fallback); 'off' = no music. On the edit path (v4/v5)
// 'smart' uses our library; Submagic variants use their own music, so for them
// 'smart' just means "music on" and 'off' means "music off".
export type MusicMode = 'smart' | 'off'

export const DEFAULT_MUSIC_MODE: MusicMode = 'smart'

// One creator-supplied B-roll clip attached to a job. Only the Motion Lab
// variants (v4-v6) use these — v1-v3 always render with Submagic's own stock
// B-roll — and the prepare-source task enriches each one with the Gemini
// analysis those variants read.
export interface CustomBrollEntry {
  url: string
  description?: string | null
  // Candidate windows computed ONCE per job during source prep: where each
  // usable moment sits inside the clip and what Gemini saw there. Cached here
  // because every Motion Lab variant used to redo the whole thing — the full
  // clip was re-downloaded, re-sampled and re-described for v4, v5 and v6
  // independently, roughly 4x the work (and the Gemini calls) for byte-identical
  // results. Variants now read these and only cut the windows they actually use.
  windows?: { offset: number; seconds: number; description: string }[]
}

export interface SubmagicPreset {
  // Fully autonomous mode   Submagic handles everything (music, B-roll, cuts, style)
  aiEditTemplate?: 'kelly' | 'karl' | 'ella'
}

// Steers the AI's per-render settings choice instead of hardcoding numbers.
// useMusic is deterministic (not AI-guessed) so variants have real, predictable
// variety — some calm/voiceonly, some energetic/with music.
export interface SubmagicProfile {
  directive: string
  useMusic: boolean
}

export interface VideoVariantDef {
  id: string
  name: string
  description: string
  tool: 'submagic' | 'edit'
  order: number
  autoStart: boolean   // true = runs immediately on job creation; false = user starts manually
  submagicPreset?: SubmagicPreset
  submagicProfile?: SubmagicProfile
  nativeCaptions?: boolean     // burn ASS karaoke captions via ElevenLabs Scribe + FFmpeg
  captionTestOnly?: boolean    // skip Submagic entirely, caption the raw footage directly
  motionGraphicsTestOnly?: boolean  // skip Submagic entirely; raw footage + Remotion graphics only
  remotionEdit?: boolean       // Remotion-only FULL edit (cuts, captions, zooms, SFX) — no Submagic anywhere
  motionGraphics?: boolean     // plan + render front-loaded brand graphics (Remotion) and composite them in
  motionGraphicsStyle?: 'minimal' | 'bold'  // which Remotion visual treatment to render
  submagicMagicBrolls?: boolean    // Submagic's own stock B-roll (our-v4/v5's edit-tool path)
  submagicMagicZooms?: boolean     // Submagic's own zoom-ins (our-v4/v5's edit-tool path)
  hidden?: boolean     // internal/experimental — never shown to or created for the client
}

export interface VideoVariant extends VideoVariantDef {
  status: 'pending' | 'processing' | 'ready' | 'failed'
  external_id: string | null  // Submagic project ID when tool === 'submagic'
  preview_url: string | null
  download_url: string | null
  duration_seconds: number | null
  error: string | null
  // `at` is a heartbeat written on every progress update — the stale sweep
  // uses it to distinguish a slow render from an abandoned one. Optional:
  // variants written before it existed simply have no heartbeat.
  progress?: { step: number; total: number; label: string; at?: string } | null
  // CC-BY credit line for the background track used, when the chosen library
  // track requires attribution. The publish flow appends it to the post so the
  // license is satisfied. null when no credit is needed.
  music_attribution?: string | null
  // Per-render music choice for this job (same for every variant). Read by the
  // render path to decide source / whether to add music at all.
  music_mode?: MusicMode
  // Color-grade look for this job (same for every variant). 'smart' = each
  // variant's signature look; otherwise a single look forced across all.
  // Stored per-variant in this jsonb so it needs no schema migration.
  grade_mode?: GradeMode
  // B-roll amount for this job (same for every variant, v1-v6). 'smart'
  // adapts to the footage, 'manual' honors broll_percent (0-50, Submagic
  // caps at 49), 'none' turns B-roll off. Same jsonb trick as above.
  broll_mode?: BrollMode
  broll_percent?: number | null
  // Where cutaways come from once the creator supplied her own clips:
  // 'both' (hers first, stock tops up), 'custom' (hers only), 'stock'
  // (ignore her folder this time). Absent on older rows = 'both'.
  // v4-v6 only: v1-v3 always use Submagic's stock B-roll.
  broll_source?: BrollSource
  // Set when the render could NOT use the creator's clips and quietly used
  // stock instead (folder unreadable, downloads failed, nothing placeable).
  // Surfaced on the variant card: a video that silently lacks the B-roll she
  // supplied looks perfectly healthy, which is the worst way to fail.
  broll_notice?: string | null
  // ISO timestamp stamped when the variant enters 'processing', cleared when it
  // reaches ready/failed. Lets the status route detect a variant whose worker
  // VM was killed before it could write its own failure (a silent forever-spin).
  processing_started_at?: string | null
}

export const VARIANT_DEFINITIONS: VideoVariantDef[] = [
  {
    id: 'our-v1',
    name: 'Calm & Clean',
    description: 'Elegant Umi captions, gentle zooms, tight pacing. Your voice leads — ideal for sensitive or educational topics.',
    tool: 'submagic',
    order: 1,
    autoStart: false,
    submagicProfile: {
      directive: 'Calm, gentle energy suited to sensitive, personal, medical, or educational content. Keep B-roll light and unobtrusive, pacing natural (never extra-fast), zooms subtle. The voice should feel like it is carrying the video alone.',
      // Kept in sync with VARIANT_SPECS['our-v1'].useMusic (the authoritative
      // flag when a V2 spec exists): music on, but always a gentle track.
      useMusic: true,
    },
  },
  {
    id: 'our-v2',
    name: 'Aesthetic',
    description: 'Bold Luke captions, punch-in zooms, and B-roll cutaways. Music sits softly under the voice.',
    tool: 'submagic',
    order: 2,
    autoStart: false,
    submagicProfile: {
      directive: 'UGC-style aesthetic edit: small elegant captions, brisk-but-natural pacing, punch-in zooms, light photo-style B-roll grounded in what is said. Clean isolated voice carries the video; music stays subtle underneath.',
      useMusic: true,
    },
  },
  {
    id: 'our-v3',
    name: 'Creator Bold',
    description: 'Bold Hormozi-style captions, punchy pacing, rich B-roll coverage, and music underneath.',
    tool: 'submagic',
    order: 3,
    autoStart: false,
    submagicProfile: {
      directive: 'UGC-style aesthetic edit: small elegant captions, brisk-but-natural pacing, punch-in zooms, light stock B-roll grounded in what is said. Clean isolated voice carries the video; music stays subtle underneath.',
      useMusic: true,
    },
  },
  // v4/v5/v6 are the Remotion-only family: the full edit (voice isolation,
  // silence/retake cuts, captions, zooms, transitions, B-roll, SFX, music)
  // renders locally with zero Submagic involvement. Each variant has a FIXED
  // caption identity + B-roll flavor (see lib/render-kit.ts); transitions and
  // sound kits are smart-randomized per render so reruns give fresh takes.
  {
    id: 'our-v4',
    name: 'Concept Pro',
    description: 'Premium concept-driven edit: color-coded captions, on-screen checklists and frameworks that visualize your points, punch-in cuts, and tactile sound design.',
    tool: 'edit',
    order: 4,
    autoStart: false,
    remotionEdit: true,
  },
  {
    id: 'our-v5',
    name: 'Viral Energy',
    description: 'High-energy edit: golden accent captions, full-screen B-roll pushes, designed stat cards, and framing jumps on every beat.',
    tool: 'edit',
    order: 5,
    autoStart: false,
    remotionEdit: true,
  },
  {
    id: 'our-v6',
    name: 'Cinematic',
    description: 'Dark moody grade, minimal captions, and glowing on-screen graphics that visualize your key points as you speak.',
    tool: 'edit',
    order: 6,
    autoStart: false,
    remotionEdit: true,
  },
  // v7 is a TEST variant: the exact v6 Cinematic identity, plus AI-GENERATED
  // collage scenes (Vox-style layered cutouts, generated via kie.ai and keyed/
  // stylized in-render) replacing some stock B-roll covers. Once the look is
  // proven on real footage, the collage system folds into v6 and this entry
  // goes away — see lib/collage-scenes.ts.
  {
    id: 'our-v7',
    name: 'Cinematic Collage (Test)',
    description: 'The v6 Cinematic edit with AI-generated editorial collage scenes — halftone cutouts springing in over a dark canvas — in place of some stock B-roll.',
    tool: 'edit',
    order: 7,
    autoStart: false,
    remotionEdit: true,
    // Experimental — kept in code for internal testing, but hidden from the
    // client: excluded from new jobs and filtered out of the studio display.
    hidden: true,
  },
]

export function extractDriveFileId(url: string): string | null {
  // Both shapes people actually paste: the share link (/file/d/<id>/view) and
  // the direct-download form (uc?export=download&id=<id>) that this app itself
  // generates. Only matching the first made a link we produce look invalid.
  const share = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (share) return share[1]
  if (!/drive\.google\.com|googleusercontent\.com/.test(url)) return null
  return url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] ?? null
}

export function extractDriveFolderId(url: string): string | null {
  const match = url.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/)
  return match?.[1] ?? null
}

// Lists the video files inside a PUBLIC Google Drive folder with no API key,
// via Drive's embedded folder view (the same page Drive serves for folder
// embeds). Requires the folder to be shared "Anyone with the link". Names are
// used only to filter to video files — downloads go through the usual
// uc?export=download URL per file id.
export async function listDriveFolderVideos(folderId: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
  })
  if (!res.ok) {
    throw new Error(`Drive folder listing failed (HTTP ${res.status}) — make sure the folder is shared "Anyone with the link".`)
  }
  const html = await res.text()
  const entries: { id: string; name: string }[] = []
  const re = /id="entry-([a-zA-Z0-9_-]+)"[\s\S]*?flip-entry-title">([^<]*)</g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) entries.push({ id: m[1], name: m[2].trim() })
  const videos = entries.filter(f => /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name))
  // Phone uploads sometimes surface without a recognizable extension; if no
  // names matched but the folder has entries, take everything — the per-clip
  // ffmpeg normalize step downstream skips anything that isn't video.
  return videos.length ? videos : entries
}

// ── ElevenLabs   Transcription ────────────────────────────────────────────────

export async function transcribeVideo(videoUrl: string): Promise<{
  transcript: string
  words: { text: string; start: number; end: number }[]
}> {
  const form = new FormData()
  form.append('model_id', 'scribe_v1')
  form.append('cloud_storage_url', videoUrl)
  form.append('language_code', 'en')
  form.append('timestamps_granularity', 'word')

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY!,
      ...form.getHeaders(),
    },
    body: form as unknown as BodyInit,
  })

  if (!res.ok) {
    const err = await res.text()
    // Same fallback as transcribeLocalFile: a drained ElevenLabs quota (which
    // it reports as HTTP 401) must not be able to stop a render on its own.
    // Downloads the media and re-sends it to OpenRouter whisper-1, which
    // returns real word timings on the OpenRouter key we already use.
    if (process.env.OPENROUTER_API_KEY) {
      console.warn(`[video-pipeline] ElevenLabs transcription failed (${res.status}) — falling back to OpenRouter Whisper`)
      try {
        const media = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) })
        if (!media.ok) throw new Error(`could not fetch media for fallback: HTTP ${media.status}`)
        const bytes = new Uint8Array(await media.arrayBuffer())
        const words = await transcribeBytesWithOpenRouter(bytes)
        return { transcript: words.map(w => w.text).join(' '), words }
      } catch (e) {
        throw new Error(`ElevenLabs transcription failed: ${err.slice(0, 200)} (OpenRouter fallback also failed: ${(e as Error).message})`)
      }
    }
    throw new Error(`ElevenLabs transcription failed: ${err}`)
  }

  const data = await res.json()
  return {
    transcript: data.text ?? '',
    words: (data.words ?? []).map((w: { text: string; start: number; end: number }) => ({
      text: w.text,
      start: w.start,
      end: w.end,
    })),
  }
}

// OpenRouter whisper-1 on raw bytes — the cloud-URL path's fallback. Needs
// verbose_json + word granularity for per-word timings; 25MB cap.
async function transcribeBytesWithOpenRouter(
  bytes: Uint8Array,
): Promise<{ text: string; start: number; end: number }[]> {
  if (bytes.byteLength > 25 * 1024 * 1024) {
    throw new Error(`audio is ${(bytes.byteLength / 1048576).toFixed(1)}MB, over whisper-1's 25MB limit`)
  }
  const form = new globalThis.FormData()
  form.append('model', 'openai/whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('language', 'en')
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }), 'media.mp4')

  const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`OpenRouter Whisper failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const words = (data.words ?? [])
    .filter((w: { word?: string; text?: string }) => (w.word ?? w.text ?? '').trim())
    .map((w: { word?: string; text?: string; start: number; end: number }) => ({
      text: (w.word ?? w.text)!, start: w.start, end: w.end,
    }))
  if (!words.length) throw new Error('OpenRouter Whisper returned no word timestamps')
  return words
}

// ── Submagic   Submit full-featured job ───────────────────────────────────────

export interface SubmagicJobOptions {
  title: string
  aiEditTemplate?: 'kelly' | 'karl' | 'ella'
  templateName?: string
  userThemeId?: string   // custom theme (mutually exclusive with templateName — wins when both set)
  magicBrolls?: boolean
  magicBrollsPercentage?: number
  magicZooms?: boolean
  hookTitle?: boolean | { text?: string; template?: string; top?: number; size?: number }
  removeSilencePace?: 'natural' | 'fast' | 'extra-fast'
  removeBadTakes?: boolean
  cleanAudio?: boolean
  musicTrackId?: string
}

interface SubmagicTemplateOption {
  id?: string
  name: string
  description?: string
}

interface SmartSubmagicSettings {
  templateName?: string
  magicBrolls: boolean
  magicBrollsPercentage: number
  hookTitle: boolean | { text?: string; template?: string; top?: number; size?: number }
  removeSilencePace: 'natural' | 'fast' | 'extra-fast'
}

// Non-negotiable baseline for every Submagic render — never left to the AI or
// a per-variant profile, always forced true at the call site. Zoom, bad-take
// removal, and audio cleanup are core quality bars, not stylistic choices.
export const SUBMAGIC_ALWAYS_ON = {
  removeBadTakes: true,
  // Conventional default. NOTE: requires a Submagic plan tier that includes Clean
  // Audio ("Clean audio requires a higher plan") — renders fail otherwise.
  cleanAudio: true,
  magicZooms: true,
} as const

let submagicTemplateCache: { expiresAt: number; templates: SubmagicTemplateOption[] } | null = null

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
  const value = typeof n === 'number' && Number.isFinite(n) ? n : fallback
  return Math.min(max, Math.max(min, value))
}

async function fetchSubmagicTemplates(): Promise<SubmagicTemplateOption[]> {
  if (submagicTemplateCache && submagicTemplateCache.expiresAt > Date.now()) {
    return submagicTemplateCache.templates
  }

  try {
    const res = await fetch('https://api.submagic.co/v1/templates', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY!, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[submagic] template discovery failed (${res.status}): ${text.slice(0, 250)}`)
      submagicTemplateCache = { expiresAt: Date.now() + 5 * 60 * 1000, templates: [] }
      return []
    }

    const data = JSON.parse(text)
    const rawTemplates = Array.isArray(data) ? data : (data.templates ?? data.items ?? data.results ?? [])
    const templates = (Array.isArray(rawTemplates) ? rawTemplates : [])
      .map((t: string | { id?: string; name?: string; title?: string; description?: string }) => (
        typeof t === 'string'
          ? { name: t }
          : {
              id: t.id,
              name: t.name ?? t.title ?? '',
              description: t.description,
            }
      ))
      .filter((t: SubmagicTemplateOption) => t.name)
      .slice(0, 50)

    console.log(`[submagic] discovered ${templates.length} templates`)
    submagicTemplateCache = { expiresAt: Date.now() + 60 * 60 * 1000, templates }
    return templates
  } catch (e) {
    console.warn('[submagic] template discovery error:', (e as Error).message)
    return []
  }
}

function normalizeSubmagicSettings(
  raw: Partial<SmartSubmagicSettings>,
  templates: SubmagicTemplateOption[],
): SmartSubmagicSettings {
  const allowedNames = new Set(templates.map(t => t.name))
  const templateName = raw.templateName && allowedNames.has(raw.templateName)
    ? raw.templateName
    : undefined

  const silence = raw.removeSilencePace === 'extra-fast' || raw.removeSilencePace === 'fast' || raw.removeSilencePace === 'natural'
    ? raw.removeSilencePace
    : 'natural'

  return {
    templateName,
    magicBrolls: raw.magicBrolls ?? true,
    magicBrollsPercentage: Math.round(clampNumber(raw.magicBrollsPercentage, 8, 26, 16)),
    hookTitle: raw.hookTitle ?? true,
    removeSilencePace: silence,
  }
}

export async function deriveSmartSubmagicSettings(
  script: { hook: string; cta: string; mood_tag: string | null; script_format?: string },
  opts: { profileDirective?: string; actualTranscript?: string } = {},
): Promise<SmartSubmagicSettings> {
  const templates = await fetchSubmagicTemplates()
  const fallback = normalizeSubmagicSettings({}, templates)

  try {
    const templateList = templates.length
      ? templates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
      : 'No templates available from API right now. Use null templateName.'

    // The actual transcript is what viewers hear — if the creator improvised
    // or deviated from the written script while filming, weight decisions
    // toward what's really in the footage, not just the intended hook/CTA.
    const transcriptBlock = opts.actualTranscript
      ? `\nActual spoken transcript from the recorded footage (this is what viewers will hear — if it differs from the hook/CTA above in tone, topic, or specificity, prioritize THIS over the written script):\n"${opts.actualTranscript.slice(0, 1500)}"\n`
      : ''

    const directiveBlock = opts.profileDirective
      ? `\nEditing direction for this specific variant (follow this style, but pick the actual numbers yourself based on the content above): ${opts.profileDirective}\n`
      : ''

    const raw = await chatCompletion({
      model: MODELS.fast,
      temperature: 0.2,
      max_tokens: 600,
      json: true,
      messages: [{
        role: 'user',
        content: [
          'Choose Submagic API settings for a short-form talking-head edit.',
          `Hook (written script): ${script.hook}`,
          `CTA (written script): ${script.cta}`,
          `Mood: ${script.mood_tag ?? 'unspecified'}`,
          `Format: ${script.script_format ?? 'unspecified'}`,
          transcriptBlock,
          directiveBlock,
          'Available caption/templates:',
          templateList,
          '',
          'Rules:',
          '- Choose templateName only from the exact available names, otherwise null.',
          '- Keep B-roll percentage and pacing consistent with the editing direction above, grounded in the actual content (transcript if given, else hook/CTA).',
          '- Use extra-fast pace only for very punchy sales/list-style content, never for calm/personal/medical content.',
          '- Return JSON only:',
          '{"templateName": string|null, "magicBrolls": boolean, "magicBrollsPercentage": number, "hookTitle": boolean, "removeSilencePace": "natural|fast|extra-fast"}',
        ].join('\n'),
      }],
    })

    const parsed = JSON.parse(raw) as Partial<SmartSubmagicSettings>
    const settings = normalizeSubmagicSettings(parsed, templates)
    console.log('[submagic] smart settings:', JSON.stringify(settings))
    return settings
  } catch (e) {
    console.warn('[submagic] smart settings failed, using fallback:', (e as Error).message)
    return fallback
  }
}

let premiumTemplateCache: { expiresAt: number; names: [string | undefined, string | undefined] } | null = null

// our-v4/our-v5 only use Submagic for the cut/clean/caption pass (no B-roll, no
// zooms -- the Remotion layer carries the visual interest), and want two
// genuinely distinct premium caption looks, never the punchy Hormozi-style
// templates. Cached briefly so both variants starting around the same time
// land on the same pair instead of each independently re-asking the model.
export async function pickPremiumTemplates(): Promise<[string | undefined, string | undefined]> {
  if (premiumTemplateCache && premiumTemplateCache.expiresAt > Date.now()) {
    return premiumTemplateCache.names
  }

  const templates = await fetchSubmagicTemplates()
  const candidates = templates.filter(t => !/hormozi/i.test(t.name))
  if (!candidates.length) return [undefined, undefined]

  let names: [string | undefined, string | undefined] = [candidates[0]?.name, candidates[1]?.name ?? candidates[0]?.name]
  try {
    const list = candidates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
    const raw = await chatCompletion({
      model: MODELS.fast,
      json: true,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Pick 2 distinct premium, clean caption styles from this list for a med-spa clinic's short-form videos — elegant and minimal, never punchy or meme-style. Return JSON only: {"a": "<exact name>", "b": "<exact name>"}\n\n${list}`,
      }],
    })
    const parsed = JSON.parse(raw) as { a?: string; b?: string }
    const allowed = new Set(candidates.map(t => t.name))
    const a = parsed.a && allowed.has(parsed.a) ? parsed.a : names[0]
    const b = parsed.b && allowed.has(parsed.b) && parsed.b !== a ? parsed.b : (candidates.find(t => t.name !== a)?.name ?? a)
    names = [a, b]
  } catch (e) {
    console.warn('[submagic] premium template pick failed, using fallback order:', (e as Error).message)
  }

  premiumTemplateCache = { expiresAt: Date.now() + 30 * 60 * 1000, names }
  return names
}

// ── Submagic   Caption lane classifier (V2) ───────────────────────────────────
// V2 variants each own a fixed caption "lane" (minimal / clean / bold) — that is
// the deliberate diversity Daniel picks from. This sorts the discovered template
// pool into those three lanes ONCE (cached), so a variant's lane resolves to a
// real Submagic templateName at render time. Hormozi-style templates are excluded
// to stay on-brand for the clinic (same rule as pickPremiumTemplates).

const LANE_ORDER: CaptionLane[] = ['minimal', 'clean', 'bold']

let captionLaneCache: { expiresAt: number; lanes: Record<CaptionLane, string[]> } | null = null

async function classifyCaptionLanes(): Promise<Record<CaptionLane, string[]>> {
  if (captionLaneCache && captionLaneCache.expiresAt > Date.now()) return captionLaneCache.lanes

  const templates = await fetchSubmagicTemplates()
  const candidates = templates.filter(t => !/hormozi/i.test(t.name))

  // Fallback: spread candidates across the three lanes by position so every lane
  // has something even if the model call fails or no templates are available.
  const lanes: Record<CaptionLane, string[]> = { minimal: [], clean: [], bold: [] }
  candidates.forEach((t, i) => { lanes[LANE_ORDER[i % 3]].push(t.name) })

  if (candidates.length) {
    try {
      const list = candidates.map((t, i) => `${i + 1}. ${t.name}${t.description ? ` — ${t.description}` : ''}`).join('\n')
      const raw = await chatCompletion({
        model: MODELS.fast,
        json: true,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Sort these caption templates into three lanes for a med-spa clinic's short-form videos:\n` +
            `- "minimal": most understated, elegant, barely-there\n` +
            `- "clean": balanced, premium, clearly readable\n` +
            `- "bold": punchiest of the tasteful set (never meme/Hormozi-style)\n\n` +
            `Every template goes in exactly one lane; use the exact names. Return JSON only: ` +
            `{"minimal": ["..."], "clean": ["..."], "bold": ["..."]}\n\n${list}`,
        }],
      })
      const parsed = JSON.parse(raw) as Partial<Record<CaptionLane, string[]>>
      const allowed = new Set(candidates.map(t => t.name))
      const cleaned: Record<CaptionLane, string[]> = { minimal: [], clean: [], bold: [] }
      for (const lane of LANE_ORDER) {
        cleaned[lane] = (parsed[lane] ?? []).filter(n => typeof n === 'string' && allowed.has(n))
      }
      // Only trust the model's split if it actually placed templates; else keep
      // the positional fallback so no lane ends up empty.
      if (LANE_ORDER.some(l => cleaned[l].length)) {
        for (const lane of LANE_ORDER) if (cleaned[lane].length) lanes[lane] = cleaned[lane]
      }
    } catch (e) {
      console.warn('[submagic] caption lane classification failed, using positional fallback:', (e as Error).message)
    }
  }

  captionLaneCache = { expiresAt: Date.now() + 30 * 60 * 1000, lanes }
  return lanes
}

// Resolve a variant's fixed lane (nudged by the profile's caption mood) to a
// concrete Submagic templateName. Returns undefined only when the pool is empty
// (Submagic then uses its default), which the render tolerates.
export async function resolveCaptionTemplate(
  lane: CaptionLane,
  mood: 'calm' | 'clean' | 'energetic' = 'clean',
): Promise<string | undefined> {
  const lanes = await classifyCaptionLanes()

  // Mood is a gentle secondary nudge: an energetic read bumps toward bolder, a
  // calm read toward softer — but only borrows a neighbor lane if the variant's
  // own lane is empty, so the deliberate per-variant diversity stays intact.
  const neighbors: Record<CaptionLane, CaptionLane[]> =
    mood === 'energetic'
      ? { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'bold', 'minimal'], bold: ['bold', 'clean', 'minimal'] }
      : mood === 'calm'
        ? { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'minimal', 'bold'], bold: ['bold', 'clean', 'minimal'] }
        : { minimal: ['minimal', 'clean', 'bold'], clean: ['clean', 'minimal', 'bold'], bold: ['bold', 'clean', 'minimal'] }

  for (const l of neighbors[lane]) {
    const picks = lanes[l]
    if (picks?.length) {
      // Within a lane, an energetic mood reaches for the last (boldest) entry, a
      // calm mood the first; otherwise the first.
      return mood === 'energetic' ? picks[picks.length - 1] : picks[0]
    }
  }
  return undefined
}

// Resolve a variant's pinned template pool: first pool entry that actually
// exists on the account wins, so a renamed/removed Submagic template degrades
// to the next choice instead of breaking the render. Returns undefined when
// none match (caller falls back to lane resolution).
export async function resolvePooledTemplate(pool: string[]): Promise<string | undefined> {
  const templates = await fetchSubmagicTemplates()
  const available = new Set(templates.map(t => t.name))
  return pool.find(name => available.has(name))
}

// ── Submagic   Fetch first available audio track for music param ──────────────

// The creator's library tracks seeded into Submagic user-media, keyed by the
// library's mood categories (fileName is how the API identifies them). Music
// is mixed BY SUBMAGIC in-render — our local library is never touched here.
const SUBMAGIC_TRACKS_BY_MOOD: Record<string, string[]> = {
  calm: ['aglow.mp3', 'dragonfly.mp3'],
  curious: ['first-kiss.mp3', 'going-quietly.mp3'],
  emotional: ['3-am-walk-slowed-reverb-version.mp3', '7-years-lukas-graham-slowed-chill-piano-version.mp3'],
  funny: ['greedy.mp3'],
  happy: ['cheri-cheri-lady.mp3', 'dip-dip.mp3'],
  motivation: ['cocaina.mp3', 'gravitational-forces.mp3'],
  sad: ['another-love-instrumental.mp3', 'freaks-guitar.mp3'],
}

// Script mood tags -> library mood categories.
const MOOD_TAG_TO_CATEGORY: Record<string, string> = {
  calm: 'calm',
  energetic: 'motivation',
  empathetic: 'emotional',
  educational: 'curious',
  bold: 'motivation',
  'story-driven': 'emotional',
}

// What the footage ACTUALLY is (Gemini watched it) beats the script's planned
// mood tag — delivery often lands differently than the script intended.
function categoryFromProfile(profile: ContentProfile): string {
  if (profile.sensitivity === 'medical_emotional' || profile.sensitivity === 'personal') return 'emotional'
  if (profile.energy === 'high') return 'motivation'
  if (profile.energy === 'low') return 'calm'
  switch (profile.format) {
    case 'story': return 'emotional'
    case 'sales': return 'motivation'
    default: return 'curious'
  }
}

// Each Submagic variant starts at a different position in the category's track
// list, so v1/v2/v3 rendered from the same footage don't all carry the same song.
const VARIANT_TRACK_OFFSET: Record<string, number> = { 'our-v1': 0, 'our-v2': 1, 'our-v3': 2 }

// Categories soft enough for Calm & Clean — v1 never gets a hype track, no
// matter how energetic the footage reads.
const GENTLE_CATEGORIES = new Set(['calm', 'curious', 'emotional', 'sad'])

export async function fetchSubmagicAudioTrack(
  moodTag?: string | null,
  opts: { profile?: ContentProfile | null; variantId?: string } = {},
): Promise<string | null> {
  try {
    const res = await fetch('https://api.submagic.co/v1/user-media?type=AUDIO&limit=50', {
      headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
    })
    const text = await res.text()
    if (!res.ok) {
      console.warn(`[submagic] audio media lookup failed (${res.status}): ${text.slice(0, 250)}`)
      return null
    }
    const data = JSON.parse(text)
    const items: Array<{ id?: string; fileName?: string; name?: string; title?: string }> =
      Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : []
    if (!items.length) return null

    const nameOf = (item: (typeof items)[number]) => item.fileName ?? item.name ?? item.title ?? ''

    let category = opts.profile
      ? categoryFromProfile(opts.profile)
      : MOOD_TAG_TO_CATEGORY[moodTag ?? ''] ?? 'calm'
    if (opts.variantId === 'our-v1' && !GENTLE_CATEGORIES.has(category)) category = 'calm'

    // Walk the category's tracks in variant-rotated order, calm as the safe
    // fallback pool, then anything the account has.
    const offset = VARIANT_TRACK_OFFSET[opts.variantId ?? ''] ?? 0
    const rotated = (names: string[]): string[] =>
      names.length ? names.slice(offset % names.length).concat(names.slice(0, offset % names.length)) : names
    const findByNames = (names: string[]) => {
      for (const n of names) {
        const hit = items.find(i => nameOf(i) === n)
        if (hit) return hit
      }
      return undefined
    }
    const picked =
      findByNames(rotated(SUBMAGIC_TRACKS_BY_MOOD[category] ?? []))
      ?? findByNames(rotated(SUBMAGIC_TRACKS_BY_MOOD.calm))
      ?? items[0]
    if (picked?.id) console.log(`[submagic] selected audio media: ${nameOf(picked) || picked.id} (${opts.profile ? 'profile' : 'moodTag'}: ${moodTag ?? 'none'} -> ${category}, variant: ${opts.variantId ?? 'n/a'})`)
    return picked?.id ?? null
  } catch {
    return null
  }
}

export async function submitSubmagicJob(
  videoUrl: string,
  opts: SubmagicJobOptions
): Promise<string> {
  // aiEditTemplate mode: Submagic controls everything   only base fields allowed
  const body: Record<string, unknown> = opts.aiEditTemplate
    ? {
        title: opts.title,
        language: 'en',
        videoUrl,
        aiEditTemplate: opts.aiEditTemplate,
      }
    : {
        title: opts.title,
        language: 'en',
        videoUrl,
        templateName: opts.templateName,
        magicBrolls: opts.magicBrolls ?? false,
        magicZooms: opts.magicZooms ?? false,
        cleanAudio: opts.cleanAudio ?? true,
        removeSilencePace: opts.removeSilencePace ?? 'extra-fast',
        removeBadTakes: opts.removeBadTakes ?? false,
      }

  if (!opts.aiEditTemplate) {
    if (opts.magicBrolls) body.magicBrollsPercentage = opts.magicBrollsPercentage ?? 40
    if (opts.hookTitle !== undefined) body.hookTitle = opts.hookTitle
    if (opts.musicTrackId) body.music = { userMediaId: opts.musicTrackId, volume: 30, fade: true }
    if (opts.userThemeId) {
      body.userThemeId = opts.userThemeId
      delete body.templateName
    }
  }

  console.log('[submagic] create project body:', JSON.stringify({
    ...body,
    videoUrl: typeof body.videoUrl === 'string' ? `${body.videoUrl.slice(0, 120)}...` : body.videoUrl,
  }))

  // Without a timeout a stalled connection here blocked the variant until the
  // 30-min safety timer — 60s is generous for a JSON submit (the video itself
  // is passed by URL, not uploaded in this request).
  const res = await fetch('https://api.submagic.co/v1/projects', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.SUBMAGIC_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Submagic job failed: ${err}`)
  }

  const data = await res.json()
  return data.id as string
}

// ── Submagic   Poll job status ────────────────────────────────────────────────

export async function pollSubmagicJob(projectId: string): Promise<{
  status: 'processing' | 'ready' | 'failed'
  previewUrl: string | null
  downloadUrl: string | null
  error: string | null
}> {
  // 30s cap: a hung poll is worse than a failed one — every caller already
  // tolerates a throw here (treated as "still processing" / retried next tick).
  const res = await fetch(`https://api.submagic.co/v1/projects/${projectId}`, {
    headers: { 'x-api-key': process.env.SUBMAGIC_API_KEY! },
    signal: AbortSignal.timeout(30_000),
  })

  // A non-OK status here is almost always a TRANSIENT blip — a 429/5xx/gateway
  // hiccup during frequent polling of a project that's still rendering fine.
  // Reporting 'failed' would kill a healthy render and burn a fresh re-run, so
  // treat it as still-processing; a genuinely dead project is caught later by
  // the poll-loop timeout / 45-min stale sweep instead of on one bad response.
  if (!res.ok) {
    console.warn(`[submagic] poll got HTTP ${res.status} for ${projectId} — treating as still-processing`)
    return { status: 'processing', previewUrl: null, downloadUrl: null, error: null }
  }

  const data = await res.json()

  // Submagic reports some states in UPPERCASE — transcriptionStatus comes back
  // as 'FAILED' — so every status read here is case-folded. Comparing
  // data.status to lowercase literals (as before) silently mishandles a render
  // reported as 'COMPLETED'/'DONE' (treated as still-processing → never pulled
  // into R2, then falsely failed by the stale sweep) or 'FAILED' (also read as
  // processing → the real reason never reaches the card).
  const rawStatus = String(data.status ?? '').toLowerCase()
  const transcriptionFailed = String(data.transcriptionStatus ?? '').toLowerCase() === 'failed'
  const failed = transcriptionFailed || rawStatus === 'failed'

  // Surface the actual reason: fall back across the field names Submagic has
  // used so the card says WHY instead of a bare "Unknown error".
  const reason = data.failureReason ?? data.error ?? data.errorMessage ?? data.message ?? null

  if (failed) {
    return {
      status: 'failed',
      previewUrl: null,
      downloadUrl: null,
      error: reason ?? (transcriptionFailed ? 'Transcription failed' : 'Unknown error'),
    }
  }

  // A project can report completed with no rendered file yet (e.g. transcription
  // finished but the export hasn't produced a video). Only a completed status
  // WITH a download URL is truly ready.
  const hasFile = Boolean(data.videoUrl ?? data.downloadUrl ?? data.directUrl)
  const done = (rawStatus === 'done' || rawStatus === 'completed') && hasFile

  return {
    status: done ? 'ready' : 'processing',
    previewUrl: data.previewUrl ?? null,
    downloadUrl: data.videoUrl ?? data.downloadUrl ?? data.directUrl ?? null,
    error: null,
  }
}

// ── Google Drive   Verify file is accessible before processing ────────────────

// Validates the Drive share URL has a file ID. No HTTP fetch   Submagic downloads the file itself.
export function verifyDriveFile(directUrl: string): { ok: boolean; resolvedUrl: string; error?: string } {
  const fileId = directUrl.match(/[?&]id=([^&]+)/)?.[1]
  if (!fileId) {
    return { ok: false, resolvedUrl: directUrl, error: 'Could not parse a file ID from the Google Drive URL.' }
  }
  // Use the confirm=t variant so large files bypass the virus-scan warning page on Submagic's end
  const resolvedUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${fileId}`
  return { ok: true, resolvedUrl }
}
