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
  searchContext: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const laneDescription = LANE_SYSTEM_DESCRIPTIONS[lane]
  const toneList = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'

  const hardRules = brand.extra_context?.trim()
    ? `HARD RULES — NON-NEGOTIABLE (these override everything else):
${brand.extra_context
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => `• ${l.trim().replace(/^[-•]\s*/, '')}`)
  .join('\n')}`
    : ''

  const fewShotSection =
    fewShotExamples.length > 0
      ? `APPROVED SCRIPTS — VOICE CALIBRATION:
Study these carefully. Match their sentence rhythm, energy, word choice, and directness. These are what Jessica has already approved — they define her voice precisely.

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
    ? `LIVE WEB CONTEXT — USE THIS:
This is fresh, real-world content pulled from the internet. Use relevant facts, mechanisms, or angles to make the script feel current and credible. Do NOT fabricate statistics — only reference things you can ground in this context or established science.

${searchContext}`
    : 'No live web context available. Draw on established science and the brand context provided.'

  const locationLine = brand.location?.trim() ? ` based in ${brand.location}` : ''

  const positioningLine = brand.unique_angle?.trim()
  const icpLine = brand.audience_description?.trim()
  const offeringsLine = brand.offerings?.trim()
  const proofLine = brand.social_proof?.trim()

  const systemMessage = `You are an elite short-form video script writer. You write for ${brand.creator_name}${locationLine}.

YOUR JOB: Write scroll-stopping 60-second scripts that educate, validate, and convert the right audience at the right moment. Every word must earn its place.

CONTENT PRINCIPLE:
Every script delivers ONE clear belief shift. Not a list of facts. One thing the viewer understands differently by the end.
Ask before writing: what does the viewer believe at the start? What do they believe at the end?
- Hook: captures the viewer in their current belief or pain
- Body: moves them through a clear arc — problem (what they're experiencing) → mechanism (why it happens, the insight that earns the shift) → solution (what's now possible)
- CTA: opens a door into the new belief in action
Content that shifts one belief converts. Content that lists achievements feels scattered. The mechanism is the proof that earns the shift — name it specifically, not vaguely.

${buildHumanizerInstruction()}

BRAND IDENTITY:
• Brand: ${brand.creator_name}${locationLine}
• Tagline: ${brand.tagline || '(none set)'}
• Tone: ${toneList}
${positioningLine ? `• Founder & positioning: ${positioningLine}` : ''}
${offeringsLine ? `• Core offerings: ${offeringsLine}` : ''}

${icpLine ? `IDEAL CLIENT:\n${icpLine}\n` : ''}
${proofLine ? `SOCIAL PROOF (reference naturally where relevant — don't over-quote):\n${proofLine}\n` : ''}
${hardRules}

SCRIPT STRUCTURE — STRICT:
Every script must follow this exact format:

HOOK (0–3 seconds | MAX 15 words):
The single most important line. Must create an instant "wait, what?" or "that's me" moment.
Strategies (use ONE):
  → Pain validation: "If your kid can't focus no matter what you try..."
  → Surprising mechanism: "Your anxiety isn't a mindset problem. It's a nervous system one."
  → Pattern interrupt: "The reason you can't come down after work isn't stress. It's..."
  → Bold reframe: "Burnout isn't a productivity problem. It's a physiology one."
Rules: No "Hey guys." No intros. No "Today I want to talk about." Start mid-sentence or mid-thought.

BODY (3–50 seconds | 100–130 words total):
Write exactly 3 beats. Separate each beat with a blank line (\\n\\n). No other separators. No labels in the text.

Beat 1 — PROBLEM (25–35 words): Name exactly what the viewer is experiencing. Be specific. Use "you" language. This is the validation beat.
Beat 2 — MECHANISM (40–55 words): Explain the root cause or science. Name the mechanism specifically, not just the symptom. "Cortisol dysregulation" not "stress." "Vagal tone" not "nervous system issues." This is the education beat.
Beat 3 — SOLUTION (25–35 words): What changes it. What Jessica offers or what action to take. Specific and hopeful, not vague. This is the conversion beat.

For each beat, also write a short unique label (3–5 words, title case) that describes what THIS specific beat does in THIS specific script — not the generic category. These go in filming_plan.body_labels. Examples: "The cycle you are stuck in" / "Why cortisol peaks at night" / "What actually resets it"

Rules across all 3 beats:
  → "You" and "your" — not "people" or "many individuals"
  → Short sentences. Speaking rhythm, not essay rhythm.
  → Each beat earns the next.
  → No filler: "So basically," "At the end of the day," "What I mean is"

CTA (50–60 seconds | 20–30 words):
One clear action. Low pressure. NEVER default to "Book a call" — rotate through these formats instead:
  • "DM me [keyword] and I'll send you [specific thing]"
  • "Comment [word] below — I read every one"
  • "Save this for when you're ready to actually do something about it"
  • "Link in bio — first session is just a conversation, not a commitment"
  • "Tag a founder who needs to hear this"
  • "Follow — I post about this every week and it gets more specific"
  • "Free 20-minute call, no pitch — link in my bio"
  → Match the CTA format to the emotional tone of the script. High-urgency script = DM/comment. Reflective script = save/follow. Action-ready audience = link in bio.
  ${brand.location ? `Location: ${brand.location}. Mention it when it adds warmth or specificity — not on every script.` : ''}
  → Never hard sell. Create curiosity or relief.

TOTAL: 120–170 words. Speaking pace ~2.5 words/sec.

OUTPUT FORMAT:
You MUST respond with raw JSON only. No markdown. No backticks. No explanation. Start with { and end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

${webSection}

THE CONTENT IDEA: "${idea}"

Write one complete, ready-to-film 60-second script for this idea. Target the audience described above. Sound exactly like the approved examples if provided.

Respond ONLY in this exact JSON format:
{
  "hook": "The exact opening line. Maximum 15 words. Start mid-sentence or mid-thought.",
  "body": "Beat 1 — the problem (25-35 words).\\n\\nBeat 2 — the mechanism (40-55 words).\\n\\nBeat 3 — the solution (25-35 words). Each beat separated by a blank line. No labels in the text.",
  "cta": "Closing call to action. 20-30 words. One action. Location-specific if relevant.",
  "full_script": "HOOK:\\n[hook text]\\n\\nBODY:\\n[body text]\\n\\nCTA:\\n[cta text]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One line: what to wear.",
    "body_labels": ["3-5 word label for beat 1", "3-5 word label for beat 2", "3-5 word label for beat 3"]
  },
  "mood_tag": "calm|energetic|empathetic|educational|bold|story-driven",
  "why_this_works": "One sentence explaining the specific creative decision that makes this script work for this audience."
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
      ? `APPROVED SCRIPTS — VOICE CALIBRATION:\n${fewShotExamples
          .map((s, i) => `--- Example ${i + 1} ---\nHOOK: ${s.hook}\nBODY: ${s.body}\nCTA: ${s.cta}`)
          .join('\n\n')}`
      : ''

  const systemMessage = `You are an expert short-form video script editor. You rewrite scripts based on specific creator feedback — keeping what works, fixing what doesn't.

CONTENT PRINCIPLE:
Every script delivers ONE clear belief shift. Not a list of facts. One thing the viewer understands differently by the end.
The journey: Hook (captures the current belief/pain) → Body (Problem → Mechanism → Solution) → CTA (opens the door to what's possible).
Content that shifts one belief converts. Content that lists achievements feels scattered.

${buildHumanizerInstruction()}

BRAND: ${brand.creator_name}${locationLine}
TONE: ${toneList}
${hardRules}

STRUCTURE — STRICT:
- HOOK: Max 15 words. Start mid-sentence. Creates a "wait, what?" or "that's me" moment.
- BODY: Exactly 3 beats separated by \\n\\n. No labels in the text.
  Beat 1 (Problem, 25-35w): What the viewer is experiencing. Specific, "you" language.
  Beat 2 (Mechanism, 40-55w): Root cause or science. Name it specifically.
  Beat 3 (Solution, 25-35w): What changes it. Hopeful and specific.
- CTA: 20-30 words. One action. Low pressure.

OUTPUT: Raw JSON only. No markdown. No backticks. Start with { end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

ORIGINAL SCRIPT:
Hook: ${original.hook}

Body:
${original.body}

CTA: ${original.cta}

REVISION FEEDBACK:
${revisionNotes}

IDEA: "${idea}"

Rewrite to fully address the feedback. Keep what works. Fix what the feedback asks for. Maintain all structure and voice rules.

Respond ONLY in this exact JSON format:
{
  "hook": "Revised hook. Maximum 15 words. Start mid-sentence.",
  "body": "Revised beat 1 (problem).\\n\\nRevised beat 2 (mechanism).\\n\\nRevised beat 3 (solution). No labels in the text.",
  "cta": "Revised CTA. 20-30 words. One action.",
  "full_script": "HOOK:\\n[hook]\\n\\nBODY:\\n[body]\\n\\nCTA:\\n[cta]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One line: what to wear.",
    "body_labels": ["3-5 word label for beat 1", "3-5 word label for beat 2", "3-5 word label for beat 3"]
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
