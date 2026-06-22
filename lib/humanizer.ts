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

export function buildHumanizerInstruction(): string {
  const allBanned = [...BANNED_VERBS, ...BANNED_INTENSIFIERS, ...BANNED_ABSTRACT]

  return `VOICE RULES — NON-NEGOTIABLE:

PUNCTUATION (hard rules):
- Zero em dashes (—). Zero en dashes (–). Zero double-hyphens (--). Use a comma, period, semicolon, or rewrite the sentence.
- Straight quotes only. No curly/smart quotes.

BANNED WORDS — never use:
${allBanned.join(', ')}

BANNED TRANSITIONS — use a period or restructure:
${BANNED_TRANSITIONS.join(', ')}

BANNED ADVERBS — cut them:
${BANNED_ADVERBS.join(', ')}

BANNED HOLLOW PHRASES:
${BANNED_HOLLOW.join(', ')}

BANNED STRUCTURAL PHRASES:
${BANNED_STRUCTURAL_PHRASES.join(', ')}

STRUCTURAL RULES:
- No forced contrasts: "Not only X, but Y" or "It's not just X, it's Y" — state both points plainly.
- No rhetorical Q&A scaffolding: "So what does this mean? It means..." — just say it.
- No rule-of-three forced groupings. Use two or four if that's more natural.
- Vary sentence length. Short punches (under 8 words) mixed with longer sentences (20+). No 12-18 word rhythm lock.
- Simple verbs: "is" not "serves as", "has" not "boasts", "shows" not "highlights".
- Name specific things. Never write vague claims like "the implications are significant" or "the stakes are high".
- No vague sources: "experts say", "studies show", "research suggests" — cite a specific source or cut the claim.
- No paragraph-ending profundity. Let facts land. Cut dramatic upswings.`
}
