import fs from 'fs'
import path from 'path'
import os from 'os'

export interface WordTimestamp {
  text: string
  start: number  // seconds
  end: number    // seconds
}

// ── Style definitions ─────────────────────────────────────────────────────────
// ASS color format: &HAABBGGRR  (alpha, blue, green, red — all reversed from CSS)
// alpha: 00 = fully opaque, FF = fully transparent
//
// PrimaryColour   = color AFTER the karaoke sweep reaches a word (past/active)
// SecondaryColour = color BEFORE the sweep reaches a word (upcoming)
//
// With \kf (fill sweep): you can see EXACTLY which word is being spoken because
// the sweep is mid-word during that word's duration. Words stay in primary after
// being spoken, giving a visual trail — but with 2-3 words per group this is
// brief and reads naturally as "highlighting as you speak".

interface CaptionStyle {
  fontName: string
  fontSize: number
  primaryColor: string    // active/spoken word color
  secondaryColor: string  // upcoming word color (dimmer)
  outlineColor: string
  backColor: string
  bold: boolean
  outline: number
  shadow: number
  marginV: number         // pixels from bottom edge
  wordsPerGroup: number   // how many words to display at once
  uppercase: boolean
  kMode: 'k' | 'kf'      // 'k' = instant snap, 'kf' = sweep fill (more dynamic)
  spacing: number         // letter spacing
}

// Bundled in /fonts (OFL-licensed, Google Fonts) so rendering never depends on
// what's installed on the machine running FFmpeg. Pass via fontsdir in the ass
// filter — see addNativeCaptions in motion-renderer.ts.
//
// IMPORTANT: fontName must match the font's INTERNAL family name, not the
// filename — verified via fontTools against each downloaded .ttf. Poppins is
// a trap: Regular/Bold share the "Poppins" family (Bold flag works normally),
// but Medium/SemiBold/Black are each their OWN separate family name — set
// fontName to the full name directly and bold:false for those.
export const FONTS_DIR = path.join(process.cwd(), 'fonts')

const STYLES: Record<string, CaptionStyle> = {
  // High-energy: Anton, yellow sweep, 2 words, uppercase — bold/energetic/lead_magnet
  bold: {
    fontName: 'Anton',
    fontSize: 92,
    primaryColor: '&H0000FFFF',    // yellow #FFFF00
    secondaryColor: '&H66FFFFFF',  // white 60% opaque
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 5,
    shadow: 2,
    marginV: 300,
    wordsPerGroup: 2,
    uppercase: true,
    kMode: 'kf',
    spacing: 1,
  },

  // Clean educational: Poppins SemiBold, white on dim-gray, 4 words, mixed case
  calm: {
    fontName: 'Poppins SemiBold',
    fontSize: 70,
    primaryColor: '&H00FFFFFF',    // white
    secondaryColor: '&H99AAAAAA',  // gray 40% opaque
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 3,
    shadow: 1,
    marginV: 300,
    wordsPerGroup: 4,
    uppercase: false,
    kMode: 'k',
    spacing: 0,
  },

  // Warm storytelling: Varela Round, amber highlight, 3 words, mixed case
  warm: {
    fontName: 'Varela Round',
    fontSize: 76,
    primaryColor: '&H0040A5FF',    // amber #FFA540 (R=FF G=A5 B=40 → reversed)
    secondaryColor: '&H55FFFFFF',  // white 67% opaque
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 3,
    shadow: 1,
    marginV: 300,
    wordsPerGroup: 3,
    uppercase: false,
    kMode: 'k',
    spacing: 0,
  },

  // Brand default: Poppins Black, brand orange sweep, 3 words, mixed case
  brand: {
    fontName: 'Poppins Black',
    fontSize: 80,
    primaryColor: '&H00174FFF',    // brand orange #FF4F17 (R=FF G=4F B=17 → &H00174FFF)
    secondaryColor: '&H66FFFFFF',  // white 60% opaque
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 4,
    shadow: 2,
    marginV: 300,
    wordsPerGroup: 3,
    uppercase: false,
    kMode: 'kf',
    spacing: 0,
  },

  // Dramatic: Alfa Slab One, red sweep, 2 words, uppercase, max outline — myth_busting
  dramatic: {
    fontName: 'Alfa Slab One',
    fontSize: 88,
    primaryColor: '&H000000FF',    // red #FF0000
    secondaryColor: '&H55FFFFFF',  // white 67% opaque
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 6,
    shadow: 3,
    marginV: 300,
    wordsPerGroup: 2,
    uppercase: true,
    kMode: 'kf',
    spacing: 2,
  },

  // Playful: Righteous, hot pink, 3 words, mixed case — light/fun energy
  playful: {
    fontName: 'Righteous',
    fontSize: 78,
    primaryColor: '&H009314FF',    // hot pink #FF1493 (R=FF G=14 B=93)
    secondaryColor: '&H66FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 4,
    shadow: 2,
    marginV: 300,
    wordsPerGroup: 3,
    uppercase: false,
    kMode: 'kf',
    spacing: 0,
  },

  // Urban: Bungee, neon green, 2 words, uppercase — hype/street energy
  urban: {
    fontName: 'Bungee',
    fontSize: 80,
    primaryColor: '&H0014FF39',    // neon green #39FF14 (R=39 G=FF B=14)
    secondaryColor: '&H66FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 5,
    shadow: 2,
    marginV: 300,
    wordsPerGroup: 2,
    uppercase: true,
    kMode: 'kf',
    spacing: 1,
  },

  // Impact: Bebas Neue, white/cyan, 3 words, uppercase — minimal, text-forward
  impact: {
    fontName: 'Bebas Neue',
    fontSize: 84,
    primaryColor: '&H00FFFF00',    // cyan #00FFFF
    secondaryColor: '&H66FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 4,
    shadow: 1,
    marginV: 300,
    wordsPerGroup: 3,
    uppercase: true,
    kMode: 'k',
    spacing: 1,
  },

  // Luxe: Lilita One, gold, 3 words, mixed case — premium/aspirational
  luxe: {
    fontName: 'Lilita One',
    fontSize: 78,
    primaryColor: '&H0037AFD4',    // gold #D4AF37 (R=D4 G=AF B=37 → reversed)
    secondaryColor: '&H66FFFFFF',
    outlineColor: '&H00000000',
    backColor: '&H80000000',
    bold: false,
    outline: 4,
    shadow: 2,
    marginV: 300,
    wordsPerGroup: 3,
    uppercase: false,
    kMode: 'kf',
    spacing: 0,
  },
}

export function moodToStyleKey(moodTag: string | null, scriptFormat?: string): string {
  if (scriptFormat === 'myth_busting') return 'dramatic'
  if (scriptFormat === 'lead_magnet') return 'bold'
  switch (moodTag) {
    case 'bold':
    case 'energetic':
      return 'bold'
    case 'calm':
    case 'educational':
      return 'calm'
    case 'empathetic':
    case 'story-driven':
      return 'warm'
    default:
      return 'brand'
  }
}

// ── Timing helpers ────────────────────────────────────────────────────────────

function toASSTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.round((s % 1) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// ── Word grouping ─────────────────────────────────────────────────────────────
// Splits word list into display groups (shown as one caption line).
// Splits on: max word count, long pauses, sentence-ending punctuation.

function groupWords(words: WordTimestamp[], maxPerGroup: number): WordTimestamp[][] {
  const groups: WordTimestamp[][] = []
  let cur: WordTimestamp[] = []

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    // Skip purely whitespace / empty tokens
    if (!w.text.trim()) continue
    cur.push(w)

    const isLast = i === words.length - 1
    const gapToNext = !isLast ? words[i + 1].start - w.end : Infinity
    const atMax = cur.length >= maxPerGroup
    const longPause = gapToNext > 0.35
    const sentenceEnd = /[.!?;]/.test(w.text)
    const commaBreak = cur.length >= 2 && /[,:]/.test(w.text)

    if (atMax || longPause || sentenceEnd || commaBreak || isLast) {
      groups.push(cur)
      cur = []
    }
  }

  if (cur.length > 0) groups.push(cur)
  return groups
}

// ── ASS file generation ───────────────────────────────────────────────────────

export function generateASSCaptions(
  words: WordTimestamp[],
  moodTag: string | null,
  scriptFormat?: string,
): string {
  const key = moodToStyleKey(moodTag, scriptFormat)
  const s = STYLES[key]

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 2 = bottom-center. MarginV is distance from bottom edge.
    `Style: Karaoke,${s.fontName},${s.fontSize},${s.primaryColor},${s.secondaryColor},${s.outlineColor},${s.backColor},${s.bold ? -1 : 0},0,0,0,100,100,${s.spacing},0,1,${s.outline},${s.shadow},2,40,40,${s.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  const groups = groupWords(words, s.wordsPerGroup)

  const dialogueLines = groups.map((group, i) => {
    const lineStart = group[0].start
    // Hold briefly after last word so it doesn't vanish mid-syllable — but
    // never past the next group's start, or two caption lines render
    // simultaneously, stacked on top of each other (visually broken).
    const desiredEnd = group[group.length - 1].end + 0.15
    const nextStart = groups[i + 1]?.[0]?.start
    const cappedEnd = nextStart !== undefined ? Math.min(desiredEnd, nextStart - 0.02) : desiredEnd
    // Guard against back-to-back groups leaving no room at all — never let a
    // line collapse to near-zero duration, even if it means a brief overlap.
    const lineEnd = Math.max(cappedEnd, lineStart + 0.2)

    const kText = group.map(w => {
      // Duration in centiseconds — minimum 8cs so very fast words still register
      const dCs = Math.max(Math.round((w.end - w.start) * 100), 8)
      // Strip leading/trailing punctuation that shouldn't be uppercased
      const display = s.uppercase ? w.text.toUpperCase() : w.text
      return `{\\${s.kMode}${dCs}}${display} `
    }).join('').trimEnd()

    return `Dialogue: 0,${toASSTime(lineStart)},${toASSTime(lineEnd)},Karaoke,,0,0,0,,${kText}`
  })

  return header + '\n' + dialogueLines.join('\n') + '\n'
}

// ── ElevenLabs transcription (local file) ────────────────────────────────────
// Uses multipart upload — no need to host the file publicly first.

export async function transcribeLocalFile(filePath: string): Promise<WordTimestamp[]> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY not set — cannot generate native captions')

  console.log(`[caption-renderer] transcribing ${path.basename(filePath)}...`)

  // Native FormData + Blob, not the npm form-data package — fetch() doesn't
  // reliably serialize form-data's stream-based body for real file uploads
  // (it can silently work for small text-only fields, then break on actual
  // files). This matches the proven-working pattern in zapcap-client.ts.
  const fileBuffer = fs.readFileSync(filePath)
  const form = new globalThis.FormData()
  form.append('model_id', 'scribe_v1')
  form.append('timestamps_granularity', 'word')
  form.append('language_code', 'en')
  form.append('file', new Blob([fileBuffer], { type: 'video/mp4' }), 'video.mp4')

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(180_000),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`ElevenLabs transcription failed (${res.status}): ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  const words: WordTimestamp[] = (data.words ?? [])
    .filter((w: { text: string; start: number; end: number }) => w.text?.trim())
    .map((w: { text: string; start: number; end: number }) => ({
      text: w.text,
      start: w.start,
      end: w.end,
    }))

  console.log(`[caption-renderer] transcribed ${words.length} words`)
  return words
}

// ── Write ASS file to temp ───────────────────────────────────────────────────

export function writeASSFile(content: string): string {
  const filePath = path.join(os.tmpdir(), `captions_${Date.now()}.ass`)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}
