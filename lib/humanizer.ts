// Voice rules derived from humanizer/banned-vocab.md and humanizer/SKILL.md
// Inject buildHumanizerInstruction() into every generation system prompt.

export const BANNED_VERBS = [
  'delve', 'leverage', 'harness', 'utilize', 'optimize', 'capitalize on',
  'streamline', 'unlock', 'empower', 'elevate', 'catalyze', 'foster',
  'bolster', 'underscore', 'showcase', 'garnered', 'embark', 'unpack',
  'dive into', 'deep dive',
]

export const BANNED_INTENSIFIERS = [
  'crucial', 'vital', 'paramount', 'pivotal', 'profound', 'groundbreaking',
  'transformative', 'cutting-edge', 'unprecedented', 'game-changing',
  'revolutionary', 'state-of-the-art', 'compelling', 'sophisticated',
  'robust', 'seamless', 'innovative',
]

export const BANNED_ABSTRACT = [
  'tapestry', 'labyrinth', 'crucible', 'landscape', 'realm', 'fabric',
  'woven into', 'journey', 'narrative', 'nuanced', 'multifaceted',
  'intricate', 'ecosystem', 'beacon', 'symphony',
]

export const BANNED_TRANSITIONS = [
  'furthermore', 'moreover', 'additionally', 'consequently', 'in conclusion',
  'ultimately', 'that said', 'that being said', "it's worth noting",
  'it bears mentioning',
]

export const BANNED_ADVERBS = [
  'really', 'literally', 'genuinely', 'honestly', 'simply', 'actually',
  'deeply', 'truly', 'fundamentally', 'inherently', 'inevitably',
  'interestingly', 'importantly', 'crucially', 'quietly', 'remarkably',
  'arguably', 'notably', 'surprisingly',
]

export const BANNED_HOLLOW = [
  "I'd be happy to", 'delighted', 'thrilled', 'resonated', 'struck by',
  "that's exactly", 'Absolutely', 'I love this', 'This is fantastic',
  'What a great question',
]

export const BANNED_STRUCTURAL_PHRASES = [
  "Let's break this down",
  "Let's dive in",
  'Let me walk you through',
  "Here's what I think",
  "Here's why",
  'The short version:',
  'The bigger point:',
  'Step back from',
  'food for thought',
  "the conversation is just beginning",
  "there's more to unpack here",
]

// Hard post-pass: prompts ban em/en dashes, but models still slip them in.
// Every generated string runs through this before being saved or returned, so
// a dash can never reach the UI, a script, a caption, or the DB.
export function stripDashes(text: string): string {
  return text
    // numeric ranges keep a plain hyphen: "10–20" -> "10-20"
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1-$2')
    // any remaining em/en dash or double-hyphen becomes a comma splice
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/(\S)\s*--+\s*(\S)/g, '$1, $2')
    // tidy the artifacts a blind replace can leave behind
    .replace(/,\s*,+/g, ',')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/,\s*([.!?;:)])/g, '$1')
    .replace(/^\s*,\s*/gm, '')
}

// Recursively sanitize every string in a parsed LLM response (objects, arrays,
// nested filming plans, alt hooks, delivery cues) in one call.
export function stripDashesDeep<T>(value: T): T {
  if (typeof value === 'string') return stripDashes(value) as T
  if (Array.isArray(value)) return value.map(v => stripDashesDeep(v)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripDashesDeep(v)
    return out as T
  }
  return value
}

export function buildHumanizerInstruction(): string {
  const allBanned = [...BANNED_VERBS, ...BANNED_INTENSIFIERS, ...BANNED_ABSTRACT]

  return `VOICE RULES   NON-NEGOTIABLE:

PUNCTUATION (hard rules):
- Zero em dashes ( ). Zero en dashes (–). Zero double-hyphens (--). Use a comma, period, semicolon, or rewrite the sentence.
- Straight quotes only. No curly/smart quotes.

BANNED WORDS   never use:
${allBanned.join(', ')}

BANNED TRANSITIONS   use a period or restructure:
${BANNED_TRANSITIONS.join(', ')}

BANNED ADVERBS   cut them:
${BANNED_ADVERBS.join(', ')}

BANNED HOLLOW PHRASES:
${BANNED_HOLLOW.join(', ')}

BANNED STRUCTURAL PHRASES:
${BANNED_STRUCTURAL_PHRASES.join(', ')}

STRUCTURAL RULES:
- No forced contrasts: "Not only X, but Y" or "It's not just X, it's Y"   state both points plainly.
- No rhetorical Q&A scaffolding: "So what does this mean? It means..."   just say it.
- No rule-of-three forced groupings. Use two or four if that's more natural.
- Vary sentence length. Short punches (under 8 words) mixed with longer sentences (20+). No 12-18 word rhythm lock.
- Simple verbs: "is" not "serves as", "has" not "boasts", "shows" not "highlights".
- Name specific things. Never write vague claims like "the implications are significant" or "the stakes are high".
- No vague sources: "experts say", "studies show", "research suggests"   cite a specific source or cut the claim.
- No paragraph-ending profundity. Let facts land. Cut dramatic upswings.`
}
