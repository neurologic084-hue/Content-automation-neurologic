# Banned Vocabulary (Ovrhaul / Ryan's voice)

This is the master banned-vocabulary list for the humanizer skill. Ryan's no-em-dash rule is built in. When humanizing, treat any of these as a strong signal to rewrite the surrounding sentence, not just swap the word.

## Punctuation (hard rules)

- **Em dashes (—) and en dashes (–) are forbidden.** No exceptions in any output written in Ryan's voice. Use commas, periods, semicolons, parentheses, or restructure the sentence. Catch the Unicode em dash (—), the Unicode en dash (–), AND the double-hyphen substitute (--).
- Curly quotes (" " ' ') → straight quotes (" ').

## LLM-ism verbs (rewrite, don't swap)

delve, leverage, harness, utilize, optimize, capitalize on, streamline, unlock, empower, elevate, catalyze, foster, bolster, underscore, showcase, garnered, embark, unpack, dive into, deep dive.

## LLM-ism intensifiers

crucial, vital, paramount, pivotal, profound, groundbreaking, transformative, cutting-edge, unprecedented, game-changing, revolutionary, state-of-the-art, compelling, sophisticated, robust, seamless, innovative.

## LLM-ism abstract / poetic

tapestry, labyrinth, crucible, landscape, realm, fabric, "woven into", journey, narrative, nuanced, multifaceted, intricate, ecosystem (as metaphor), beacon, symphony.

## Stock openings

"I hope this email finds you well", "I wanted to reach out", "Thanks for sharing this", "Great question", "Hope you're well".

## Hollow enthusiasm

"I'd be happy to", "delighted", "thrilled", "please don't hesitate to reach out", "resonated", "struck by", "that's exactly", "keeps me up at night", "I love this", "This is fantastic", "What a great question", "Absolutely", "100%".

## Faux-depth closers

"the conversation is just beginning", "there's more to unpack here", "food for thought", "let's keep the conversation going", "worth sitting with", "worth unpacking", "the future looks bright", "only time will tell".

## Faux-precision hedges

"genuinely", "I'd genuinely like to", "I truly think", "I really believe", "actually", "frankly", "to be honest", "let me be clear". If you mean it, just say it.

## Reaching for metaphors

"gets less airtime", "useful lens", "compounds that", "sits at the intersection of", "navigate the landscape", "moving the needle".

## Mechanical transitions

furthermore, moreover, additionally, consequently, in conclusion, ultimately, "that said", "that being said", "it's worth noting", "it bears mentioning", "in today's [X]", "in an era where".

## Hollow emphasis (Ryan-specific ban)

"is real" / "are real" (e.g., "the risk is real"), "the whole game", "are exactly", "is precisely", "are the very ones", **"actually matters"**, **"what actually changed"**. Emphasis comes from the argument, not from adverbs performing certainty.

## Performed reactions

"stopped me cold", "hit me", "struck me", "this is where it gets interesting", "what surprised me most", "what struck me was", "I was fascinated to discover".

## Algorithmic scaffolding

"The short version:", "The bigger point:", "Step back from...", "Here's what I think...", "Here's why...", "Let's break this down", "Let's dive in", "Let me walk you through".

## "Serves as" dodge — use the simple verb

| Avoid | Use |
|---|---|
| serves as | is |
| stands as | is |
| marks (when meaning "is") | is |
| represents (when meaning "is") | is |
| features (verb) | has |
| boasts | has |
| presents (inflated) | is, shows |

## Adverbs (kill on sight)

really, just, literally, genuinely, honestly, simply, actually, deeply, truly, fundamentally, inherently, inevitably, interestingly, importantly, crucially, quietly (AI's favorite for "subtle importance"), remarkably, arguably, notably, surprisingly.

## Vague declaratives — name the specific thing

- "The reasons are structural"
- "The implications are significant"
- "The stakes are high"
- "The consequences are real"

## Vague attributions — name a source or cut

- "Experts argue..."
- "Industry reports suggest..."
- "Observers have cited..."
- "Studies show..."
- "Research suggests..."

## Grandiose stakes inflation — scale claims to actual stakes

- "This will fundamentally reshape how we think about everything"
- "will define the next era of [X]"
- "something entirely new"
- "marking a pivotal moment in the evolution of..."
- "a watershed moment for the industry"

## Structural anti-patterns (detectable AI shapes)

- **Forced contrasts:** "Not only X, but Y." / "It's not just X, it's Y." → State both points.
- **Rhetorical Q&A scaffolding:** "So what does this mean? It means..." → Just say what it means.
- **Algorithmic rule-of-three:** Three items when two or four would be more natural.
- **Uniform sentence length:** Settling into a 12-18 word rhythm. Mix fragments (under 8 words) with long sentences (20+).
- **Symmetric paragraphs:** Every paragraph 3-4 sentences. Vary 1-7.
- **Paragraph-ending profundity:** Dramatic upswings ("that's the real risk"). Cut and let facts land.
- **Manufactured parallelism:** Parallel structure across consecutive sentences. Asymmetry reads as human.
- **Inline-header bullets:** `**Performance:** Performance improved by...` → Strip the bold lead.
- **Title Case In Headings** → sentence case.
