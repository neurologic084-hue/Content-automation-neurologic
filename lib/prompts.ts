import type { AudienceLane, BrandSettings, Script } from './types'
import { buildHumanizerInstruction } from './humanizer'

export const LANE_SYSTEM_DESCRIPTIONS: Record<AudienceLane, string> = {
  adhd_parents: `AUDIENCE: Startup founders and solopreneurs growing a personal brand using AI.

WHO THEY ARE: Building something real but posting inconsistently. They know content matters for distribution but have no system, no time, and no idea what to say. They've tried generic AI tools and gotten generic output. They want to sound like themselves, not a chatbot. They are smart, skeptical of hype, and will stop scrolling the second something feels automated.

WHAT STOPS THEM FROM SCROLLING: Content that speaks the language of someone who actually ships product. Specificity about the problem they're in: not "grow your brand" but "why you posted once this week and felt nothing from it." They respond to mechanisms and real examples.

WHAT CONVERTS THEM: A concrete, non-generic system they can plug into their existing workflow. The promise of sounding more like them, not less.

EMOTIONAL CORE: Legitimacy. They want content that reflects how sharp they actually are, not a watered-down version for the algorithm.`,

  sympathetic_overdrive: `AUDIENCE: Marketing teams trying to scale content output and workflows with AI.

WHO THEY ARE: Managing content at volume with too few people. They've tried ChatGPT for everything and ended up with mediocre output that sounds like everyone else. They spend hours editing AI drafts instead of saving time. They know AI is the answer but haven't found the right system. They're responsible for results, not experiments.

WHAT STOPS THEM FROM SCROLLING: Content that names their specific failure mode, not just "AI for marketing." They pause for: "why your AI content sounds the same as your competitor's" or "the prompt mistake that kills voice." They respond to systems and before/after examples.

WHAT CONVERTS THEM: A workflow that actually reduces editing time and maintains brand voice across the team. ROI language. Time saved.

EMOTIONAL CORE: Control. The feeling that they finally have a repeatable system, not a random output machine.`,

  burnout_professionals: `AUDIENCE: Consultants, coaches, and LinkedIn creators trying to stand out in a crowded feed.

WHO THEY ARE: Smart, credentialed, and posting into the void. They've been told to "share value" and "be consistent" but their posts get 12 likes from their friends. They don't understand the algorithm and aren't willing to dance for it. They want to grow without becoming a content machine. They're skeptical of LinkedIn gurus.

WHAT STOPS THEM FROM SCROLLING: Content that doesn't sound like LinkedIn. Direct language, specific numbers, a point of view that isn't safe. They stop for "what I stopped doing on LinkedIn that doubled my reach" or "the post format no one talks about."

WHAT CONVERTS THEM: A system that makes them look like they know what they're doing without changing who they are. A shortcut that feels honest.

EMOTIONAL CORE: Credibility. They want to grow without selling out.`,
}

export function buildLaneSuggestionPrompt(idea: string): string {
  return `You are classifying a short-form content idea for an AI growth systems brand. Your job: match the idea to the audience lane most likely to stop scrolling for it.

THE THREE AUDIENCE LANES:

1. adhd_parents (label: Founders Building Brand)
   Who: Startup founders and solopreneurs growing a personal brand with AI. No system, no time, tired of sounding like a chatbot.
   Responds to: Specific founder pain points, personal brand mechanics, how to scale voice without losing it.
   Trigger words: personal brand, founder content, authenticity, distribution, posting, audience, newsletter, X, Twitter.

2. sympathetic_overdrive (label: Marketing Teams Scaling)
   Who: Marketing teams scaling content output with AI. Drowning in mediocre AI drafts, need a real workflow.
   Responds to: Workflow systems, prompt engineering, brand voice at scale, time-to-publish, team content ops.
   Trigger words: content team, scaling, workflow, prompt, brand voice, AI writing, content ops, editing time, ChatGPT.

3. burnout_professionals (label: LinkedIn Creators)
   Who: Consultants and creators posting on LinkedIn trying to stand out. Smart but invisible. Skeptical of gurus.
   Responds to: Algorithm insights, post formats, growth without selling out, credibility, specific numbers.
   Trigger words: LinkedIn, engagement, posts, algorithm, thought leadership, reach, followers, visibility, hooks.

THE IDEA: "${idea}"

Pick the ONE lane this idea speaks to most directly. Consider: what specific pain point does it address? Who would pause their scroll for this exact topic?

Respond ONLY in valid JSON (no markdown, no explanation outside the JSON):
{
  "suggested_lane": "adhd_parents|sympathetic_overdrive|burnout_professionals",
  "reasoning": "One sharp sentence: what specific pain point this idea addresses for this lane.",
  "confidence": "high|medium|low"
}`
}

export function buildScriptGenerationMessages(
  idea: string,
  lane: AudienceLane,
  brand: BrandSettings,
  fewShotExamples: Script[],
  searchContext: string,
  moodTag?: string,
  scriptFormat?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const laneDescription = LANE_SYSTEM_DESCRIPTIONS[lane]
  const baseTone = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const toneList = moodTag ? `${baseTone} -- lean ${moodTag} for this script` : baseTone

  const hardRules = brand.extra_context?.trim()
    ? `HARD RULES   NON-NEGOTIABLE (these override everything else):
${brand.extra_context
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => `• ${l.trim().replace(/^[-•]\s*/, '')}`)
  .join('\n')}`
    : ''

  const fewShotSection =
    fewShotExamples.length > 0
      ? `APPROVED SCRIPTS   VOICE CALIBRATION:
Study these carefully. Match their sentence rhythm, energy, word choice, and directness. These are what Jessica has already approved   they define her voice precisely.

${fewShotExamples
  .map(
    (s, i) => `--- Example ${i + 1} ---
HOOK: ${s.hook}
BODY: ${s.body}
CTA: ${s.cta}`
  )
  .join('\n\n')}`
      : 'No approved examples yet. Write as if you are a seasoned short-form health content creator who speaks with warmth, specificity, and authority.'

  const webSection = searchContext?.trim()
    ? `LIVE WEB CONTEXT   USE THIS:
This is fresh, real-world content pulled from the internet. Use relevant facts, mechanisms, or angles to make the script feel current and credible. Do NOT fabricate statistics   only reference things you can ground in this context or established science.

${searchContext}`
    : 'No live web context available. Draw on established science and the brand context provided.'

  const locationLine = brand.location?.trim() ? ` based in ${brand.location}` : ''

  const positioningLine = brand.unique_angle?.trim()
  const icpLine = brand.audience_description?.trim()
  const offeringsLine = brand.offerings?.trim()
  const proofLine = brand.social_proof?.trim()

  const systemMessage = `You are an elite short-form video script writer. You write for ${brand.creator_name}${locationLine}.

YOUR JOB: Write scroll-stopping 60-second scripts that feel like a real person talking   not a generated summary. Every word must earn its place. Scripts that feel AI-written get skipped.

${buildHumanizerInstruction()}

BRAND IDENTITY:
• Brand: ${brand.creator_name}${locationLine}
• Tagline: ${brand.tagline || '(none set)'}
• Tone: ${toneList}
${positioningLine ? `• Founder & positioning: ${positioningLine}` : ''}
${offeringsLine ? `• Core offerings: ${offeringsLine}` : ''}

${icpLine ? `IDEAL CLIENT:\n${icpLine}\n` : ''}
${proofLine ? `SOCIAL PROOF (reference naturally where relevant   don't over-quote):\n${proofLine}\n` : ''}
${hardRules}

HOOK RULES (apply to ALL formats):
The first 2-3 seconds decide if they keep watching   this is the single most important line in the script. MAX 15 words. Start mid-sentence or mid-thought. No "Hey guys." No intros. No "Today I want to talk about."
Strategies (pick the one that fits   all are forms of a curiosity gap or pattern interrupt):
  → Pain-first: "If your kid can't focus no matter what you try..."
  → Surprising mechanism: "Your anxiety isn't a mindset problem. It's a nervous system one."
  → Pattern interrupt: "The reason you can't come down after work has nothing to do with stress."
  → Bold reframe: "Burnout isn't a productivity problem. It's a physiology one."
  → Story drop-in: "I spent 3 years telling clients to just breathe. I was wrong."
  → Open question: pose a question the viewer needs the answer to badly enough to keep watching.

RETAIN   DON'T JUST HOOK AND CLOSE, HOLD THEM THROUGH THE MIDDLE:
A strong hook gets the click. What keeps them watching is an open loop early in the body   a reason to believe the next line matters more than scrolling away. Deliver real value early and often through the body, not all saved for the end. Every beat should answer something the previous beat raised, while still owing the viewer one more thing.

CTA RULES (non-lead-magnet formats):
One clear action. 20–30 words. Low pressure. NEVER default to "Book a call." Rotate:
  • "DM me [keyword] and I'll send you [specific thing]"
  • "Save this for when you need it"
  • "Link in bio   first session is just a conversation, not a commitment"
  • "Follow   I post about this every week and it gets more specific"
  • "Free 20-minute call, no pitch   link in my bio"
Match tone: reflective = save/follow. Action-ready = link in bio. High-urgency = DM.
${brand.location ? `Mention ${brand.location} when it adds warmth   not on every script.` : ''}

LEAD MAGNET CTA   STRICTLY NON-NEGOTIABLE:
  → ONLY for lead_magnet format: the CTA must be EXACTLY "Comment [ONE WORD IN ALL CAPS] below and I'll DM/send it to you." No other CTA is acceptable for this format.
  → ALL OTHER FORMATS: NEVER use "Comment X and I'll..." pattern. This is reserved exclusively for lead magnets.

SCRIPT FORMATS   PICK THE BEST ONE FOR THIS IDEA:

FORMAT 1: EDUCATIONAL (belief-shift)
Best for: mechanisms, science, "why X happens", counterintuitive insights, myth-busting.
Structure (total 120–170 words):
  HOOK (max 15w): Surprising claim or counterintuitive truth.
  BODY   exactly 3 beats, separated by blank lines, no labels in the text:
    Beat 1 PROBLEM (25–35w): What the viewer is experiencing RIGHT NOW. Specific. "you" language. Validation beat.
    Beat 2 MECHANISM (40–55w): The root cause or science. Name it precisely   "cortisol dysregulation" not "stress," "vagal tone" not "nervous system issues." This is the insight that earns the shift.
    Beat 3 SOLUTION (25–35w): What actually changes it. Specific and hopeful. This is the conversion beat.
  CTA (20–30w).

FORMAT 2: TIPS AND TRICKS (spoken numbered list)
Best for: actionable advice, "X ways to...", tools, frameworks, numbered lists.
Structure (total 130–180 words):
  HOOK (max 15w): Classic listicle opener. "Here are [N] things about [X]." or "I wish someone told me these [N] things about [X]."
  RE-HOOK (20–30w): IMMEDIATELY after the hook, tease why they need to stay. Build curiosity about specific tips. "Number one sounds obvious but almost nobody does it. Number three is what changed everything for my clients. And number five   that one is going to surprise you." Make each tip sound like it has a specific payoff.
  BODY   3 to 5 tips. STRICT FORMAT PER TIP:
    - Numbered with spoken language: "Number one:", "Number two:", "Number three:" etc.
    - Each tip is 1-2 full natural sentences spoken aloud. Not fragments. Not a label.
    - WRONG: "1. Hydration."
    - WRONG: "1. Drink water." (too short, feels like a bullet point)
    - RIGHT: "Number one: drink a full glass of water before you eat breakfast. Your cortisol is already elevated in the morning and dehydration makes it worse."
    - The tip should feel like someone explaining it to you, not reading a checklist.
  CTA (20–30w).

FORMAT 3: PERSONAL STORY (story arc)
Best for: transformations, struggles, "I used to... now I...", moments of discovery, client stories.
Structure (total 120–170 words):
  HOOK (max 15w): Drop the viewer into the middle of the story. "I [did X] and [unexpected result]."
  BODY   exactly 3 beats, separated by blank lines, no labels in the text:
    Beat 1 SETUP (25–35w): What was happening. Ground the viewer in the specific moment   not "I was stressed" but "I was seeing 12 clients a week and couldn't sleep past 4am."
    Beat 2 TURNING POINT (35–45w): The moment of discovery or the shift. Specific detail. The thing you found, tried, or realized.
    Beat 3 LESSON (25–35w): What changed. What you now know. What this means for the viewer   bridge from your story to their life.
  CTA (20–30w).

FORMAT 4: MYTH BUSTING (belief challenge)
Best for: debunking common advice, "X is actually wrong," counterintuitive truths, paradigm shifts.
Structure (total 120–170 words):
  HOOK (max 15w): State the myth as a provocative truth-challenge. "Everyone says X. Here's why that's wrong."
  BODY   exactly 3 beats, separated by blank lines, no labels:
    Beat 1 THE MYTH (20–30w): What people believe and why it feels true. Validate the common thinking without agreeing.
    Beat 2 THE TRUTH (40–55w): The specific mechanism or evidence that contradicts it. Precise. Name the science or the real pattern.
    Beat 3 THE SHIFT (25–35w): What to do or think differently now.
  CTA (20–30w): Standard rotation above. Never comment-gate.

FORMAT 5: LEAD MAGNET (comment gate)
Best for: free guides, checklists, templates, mini-courses, PDFs   anything being given away for free.
Structure (total 110–150 words):
  HOOK (max 15w): Specific promise tied to what you're giving away.
  BODY   exactly 3 beats, separated by blank lines, no labels:
    Beat 1 PROBLEM (20–30w): The exact pain or gap they feel right now. Specific. "You" language.
    Beat 2 VALUE (30–40w): What the free resource is, what's inside, why it solves it. Name it specifically.
    Beat 3 TEASER (15–20w): End the body with a genuine giveaway signal. Must be one of:
      → "I'm giving this away for free."
      → "I put everything I know about [topic] into this [resource name], and it's yours."
      → "This [guide/checklist/template] is free   [brief reason]."
      This line MUST feel like a real gift, not a pitch. Do not end with a question or a tease of the CTA.
  CTA   STRICT: "Comment [ONE WORD IN ALL CAPS] below and I'll DM/send it to you." Nothing else. No link in bio. No variations.

VOICE RULES (all formats):
  → "You" and "your"   not "people" or "many individuals"
  → Natural spoken rhythm. Vary sentence length   some short, some medium. Never machine-gun one-liners. Never choppy fragments. Write like someone talking to a friend, not reading a bullet list.
  → No filler: "So basically," "At the end of the day," "What I mean is," "It's important to note"
  → Specific over vague every single time. Numbers, names, mechanisms, real examples.
  → If it sounds like a blog post or a bullet list, rewrite it as someone actually talking.

OUTPUT FORMAT:
You MUST respond with raw JSON only. No markdown. No backticks. No explanation. Start with { and end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

${webSection}

THE CONTENT IDEA: "${idea}"

${scriptFormat ? `FORCED FORMAT: Write this script ONLY in the "${scriptFormat}" format. Do not choose a different format regardless of the idea.\n` : ''}STEP 1: ${scriptFormat ? `Format is pre-selected as "${scriptFormat}". Proceed directly to writing.` : 'Decide which format fits this idea best (tips_tricks / educational / personal_story / myth_busting). Do NOT choose lead_magnet unless explicitly forced above.'}

STEP 2: Write the full script in that format. Sound exactly like the approved examples if provided. Use the Reddit posts in the web context (marked [Reddit]) to borrow real language   the exact words real people use to describe this problem.

Respond ONLY in this exact JSON format:
{
  "script_format": "tips_tricks|educational|personal_story|myth_busting|lead_magnet",
  "hook": "The exact opening line. Maximum 15 words. Start mid-sentence or mid-thought.",
  "re_hook": "For tips_tricks only: the 20-30 word preview that teases all tips. Empty string for other formats.",
  "body": "The full body text. For educational/story: 3 beats separated by blank lines, no labels. For tips_tricks: numbered tips each on a new line.",
  "cta": "Closing call to action. 20-30 words. One action.",
  "full_script": "HOOK:\\n[hook]\\n\\n[re_hook if tips_tricks, otherwise skip]\\n\\nBODY:\\n[body]\\n\\nCTA:\\n[cta]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One line: what to wear.",
    "body_labels": ["3-5 word label for beat/tip 1", "3-5 word label for beat/tip 2", "3-5 word label for beat/tip 3"]
  },
  "mood_tag": "calm|energetic|empathetic|educational|bold|story-driven",
  "why_this_works": "One sentence: what format you chose and the specific creative decision that makes this script work for this audience."
}`

  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ]
}

export function buildRevisionMessages(
  original: { hook: string; body: string; cta: string },
  revisionNotes: string,
  idea: string,
  lane: AudienceLane,
  brand: BrandSettings,
  fewShotExamples: Script[]
): Array<{ role: 'system' | 'user'; content: string }> {
  const toneList = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const locationLine = brand.location?.trim() ? ` based in ${brand.location}` : ''
  const laneDescription = LANE_SYSTEM_DESCRIPTIONS[lane]

  const hardRules = brand.extra_context?.trim()
    ? `HARD RULES:\n${brand.extra_context
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => `• ${l.trim().replace(/^[-•]\s*/, '')}`)
        .join('\n')}`
    : ''

  const fewShotSection =
    fewShotExamples.length > 0
      ? `APPROVED SCRIPTS   VOICE CALIBRATION:\n${fewShotExamples
          .map((s, i) => `--- Example ${i + 1} ---\nHOOK: ${s.hook}\nBODY: ${s.body}\nCTA: ${s.cta}`)
          .join('\n\n')}`
      : ''

  const systemMessage = `You are an expert short-form video script editor. You rewrite scripts based on specific creator feedback   keeping what works, fixing what doesn't.

${buildHumanizerInstruction()}

BRAND: ${brand.creator_name}${locationLine}
TONE: ${toneList}
${hardRules}

FORMATS   maintain the original script's format unless the feedback asks to change it:

FORMAT 1 (educational): HOOK → BODY (3 beats: Problem / Mechanism / Solution, blank-line separated) → CTA
FORMAT 2 (tips_tricks): HOOK → RE-HOOK (teases all tips) → BODY (numbered tips) → CTA
FORMAT 3 (personal_story): HOOK (mid-story drop-in) → BODY (3 beats: Setup / Turning Point / Lesson) → CTA

VOICE RULES:
  → Natural spoken rhythm. Vary sentence length   some short, some medium. Never choppy fragments or machine-gun one-liners.
  → "You" and "your"   not "people" or "many individuals."
  → Specific over vague. No filler phrases.
  → If it sounds like a blog post or a bullet list, rewrite it as someone actually talking.

OUTPUT: Raw JSON only. No markdown. No backticks. Start with { end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

ORIGINAL SCRIPT:
Format: ${(original as any).script_format || 'educational'}
Hook: ${original.hook}
${(original as any).re_hook ? `Re-hook: ${(original as any).re_hook}\n` : ''}
Body:
${original.body}

CTA: ${original.cta}

REVISION FEEDBACK:
${revisionNotes}

IDEA: "${idea}"

Rewrite to fully address the feedback. Keep what works. Fix what the feedback asks for. Maintain format and voice rules.

Respond ONLY in this exact JSON format:
{
  "script_format": "tips_tricks|educational|personal_story",
  "hook": "Revised hook. Maximum 15 words. Start mid-sentence.",
  "re_hook": "For tips_tricks only. Empty string otherwise.",
  "body": "Revised body. Match format structure.",
  "cta": "Revised CTA. 20-30 words. One action.",
  "full_script": "HOOK:\\n[hook]\\n\\n[re_hook if tips_tricks]\\n\\nBODY:\\n[body]\\n\\nCTA:\\n[cta]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One line: what to wear.",
    "body_labels": ["3-5 word label for beat/tip 1", "3-5 word label for beat/tip 2", "3-5 word label for beat/tip 3"]
  },
  "mood_tag": "calm|energetic|empathetic|educational|bold|story-driven",
  "why_this_works": "One sentence: what changed and why this version is stronger."
}`

  return [
    { role: 'system', content: systemMessage },
    { role: 'user', content: userMessage },
  ]
}

// Keep backward-compatible wrapper (used nowhere but good for safety)
export function buildScriptGenerationPrompt(
  idea: string,
  lane: AudienceLane,
  brand: BrandSettings,
  fewShotExamples: Script[],
  searchContext: string
): string {
  const msgs = buildScriptGenerationMessages(idea, lane, brand, fewShotExamples, searchContext)
  return msgs.map((m) => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n')
}
