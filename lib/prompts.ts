import type { AudienceLane, BrandSettings, Script } from './types'
import { buildHumanizerInstruction } from './humanizer'

// Default audience archetypes — niche-agnostic, work for any creator.
// These are universal buying psychology segments, not Jessica-specific content.
// Override per brand by setting brand.lane_descriptions in Supabase.
export const LANE_SYSTEM_DESCRIPTIONS: Record<AudienceLane, string> = {
  adhd_parents: `AUDIENCE ARCHETYPE: Problem-aware seekers who have tried the generic solutions and are frustrated.

WHO THEY ARE: They know they have a problem. They have read the articles, watched the videos, maybe tried some things — and none of it stuck or gave them a real answer. They are skeptical of generic advice because they have already heard it. What they are looking for is someone who names their specific situation, explains why the usual approaches didn't work, and gives them a root-cause answer. They will stop scrolling the second they feel understood. They will bounce in two seconds if the content sounds like everything else they have already tried.

WHAT STOPS THEM FROM SCROLLING: Specificity. Not "here's how to deal with X" but "here's exactly why X keeps happening to you and what's actually causing it." They respond to content that names the mechanism behind the problem — the real reason, not the surface reason everyone else gives.

WHAT CONVERTS THEM: A concrete path forward they haven't heard before. Not more tips — an explanation of why the tips didn't work and what to do instead. Content that earns their trust by proving the creator understands the problem at a level most people don't.

EMOTIONAL CORE: Validation and hope. They need to feel that someone finally gets it before they're willing to believe things can change.`,

  sympathetic_overdrive: `AUDIENCE ARCHETYPE: Emotionally aware but stuck — they understand their problem but can't seem to move through it.

WHO THEY ARE: They are self-aware. They can name what they're going through. They may have already done some version of the work — therapy, courses, books, habits — and they still feel stuck. The problem isn't that they don't know what they should do. The problem is that knowing hasn't been enough. They are looking for the missing piece: a frame, a mechanism, a realization that makes everything finally click. They are tired of being told to "try harder" or "think differently." They are looking for understanding, not more advice.

WHAT STOPS THEM FROM SCROLLING: Content that names the exact feeling they can't quite articulate. Not a diagnosis — a description. "The reason you can't stop even when you want to." "Why motivation works until it doesn't." They stop when the first line sounds like something they've thought but never heard said out loud.

WHAT CONVERTS THEM: Validation that their struggle is real, followed by a reframe that gives them a new way to look at it. Not "here's what to do" — "here's why this is happening and why what you've been trying hasn't worked." The right explanation IS the intervention.

EMOTIONAL CORE: Relief and legitimacy. They want to stop feeling like the problem is a personal failing and start understanding it as something real and addressable.`,

  burnout_professionals: `AUDIENCE ARCHETYPE: Results-driven optimizers who want measurable answers, not soft advice.

WHO THEY ARE: They are achievement-oriented. They have built a life around being capable and performing at a high level. Something is slipping — their output, their energy, their edge — and it bothers them because it's not who they are. They have tried the obvious fixes and they're not working. They don't trust vague wellness content. They want data, mechanisms, specifics. They will engage with content that treats them as intelligent and gives them something actionable and precise. They will scroll past anything that sounds like motivation or generic self-help.

WHAT STOPS THEM FROM SCROLLING: Content that leads with a specific cause, not a feeling. Not "you're burning out" but "here's the specific reason your output has dropped and what's driving it." They respond to numbers, mechanisms, root causes, and language that matches how they already think — performance, optimization, efficiency, results.

WHAT CONVERTS THEM: A specific, measurable path to getting back to baseline or above it. The promise isn't "feel better" — it's "find the actual cause and fix it." They need to believe the creator has a real system, not just general wisdom.

EMOTIONAL CORE: Control and performance. They want their edge back, and they want a plan to get it.`,
}

export function buildLaneSuggestionPrompt(idea: string, brandName?: string): string {
  const brandContext = brandName ? `for ${brandName}` : ''
  return `You are classifying a short-form content idea ${brandContext}. Your job: match the idea to the audience segment most likely to stop scrolling for it.

THE THREE AUDIENCE SEGMENTS:

1. adhd_parents — Problem-aware seekers
   Who: People who know they have a problem, have tried the obvious solutions, and are frustrated they haven't worked. They want the root cause, not another tip.
   Content that stops them: Explains WHY the usual advice doesn't work, or names the specific underlying cause they haven't heard before.
   Signs an idea fits: It debunks a common approach, reveals a hidden cause, or validates a specific frustration.

2. sympathetic_overdrive — Emotionally aware but stuck
   Who: People who understand their situation but feel like they can't move through it. Self-aware, have done the work, still stuck. Need to feel understood before they'll trust a solution.
   Content that stops them: Names a feeling or experience they couldn't quite articulate. Validates before instructing.
   Signs an idea fits: It starts from emotion or lived experience, or reframes something they thought was a personal failing as something external and addressable.

3. burnout_professionals — Results-driven optimizers
   Who: Achievement-oriented people who want specific, measurable answers. Skeptical of soft claims. Respond to data, mechanisms, and precision.
   Content that stops them: Leads with a specific cause or number, not a feeling. Treats the problem as something to diagnose and fix.
   Signs an idea fits: It's framed around performance, output, optimization, or a specific measurable result.

THE IDEA: "${idea}"

Pick the ONE segment this idea speaks to most directly. Consider: who would stop scrolling for this exact angle?

Respond ONLY in valid JSON (no markdown, no explanation outside the JSON):
{
  "suggested_lane": "adhd_parents|sympathetic_overdrive|burnout_professionals",
  "reasoning": "One sharp sentence: what specific pain point this idea addresses for this segment.",
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
  // Use brand-configured lane description when available — this allows the tool
  // to work for any niche without code changes. Falls back to the built-in
  // defaults (currently tuned for Neuro Logic) when not configured.
  const laneDescription = brand.lane_descriptions?.[lane] ?? LANE_SYSTEM_DESCRIPTIONS[lane]
  const baseTone = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const toneList = moodTag ? `${baseTone} -- lean ${moodTag} for this script` : baseTone

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
Study these carefully. Match their sentence rhythm, energy, word choice, and directness. These are scripts the creator has already approved — they define their voice precisely.

${fewShotExamples
  .map(
    (s, i) => `--- Example ${i + 1} ---
HOOK: ${s.hook}
BODY: ${s.body}
CTA: ${s.cta}`
  )
  .join('\n\n')}`
      : 'No approved examples yet. Write with the warmth, specificity, and authority of an expert who has seen this problem many times and knows exactly what causes it.'

  const webSection = searchContext?.trim()
    ? `LIVE WEB CONTEXT — USE THIS:
This is fresh, real-world content pulled from the internet. Use relevant facts, mechanisms, or angles to make the script feel current and credible. Do NOT fabricate statistics — only reference things you can ground in this context or established science.

IMPORTANT: Look for Reddit posts and forum content in the search results (marked [Reddit]). These show the EXACT words real people use to describe this problem or desire. Borrow that language directly — not paraphrased, but the actual phrases people use when they're frustrated, stuck, or searching for answers. That language is what makes a viewer stop and think "this is exactly me."

${searchContext}`
    : `No live web context available. Draw on established expertise in ${brand.creator_name}'s field. Name specific mechanisms, processes, or frameworks — not vague claims. Translate technical language into the plain English the audience uses to describe their own experience.`

  const locationLine = brand.location?.trim() ? ` based in ${brand.location}` : ''

  const positioningLine = brand.unique_angle?.trim()
  const icpLine = brand.audience_description?.trim()
  const offeringsLine = brand.offerings?.trim()
  const proofLine = brand.social_proof?.trim()

  const creatorIntro = brand.unique_angle?.trim()
    ? `${brand.creator_name}${locationLine} — ${brand.unique_angle}`
    : `${brand.creator_name}${locationLine}`

  const systemMessage = `You are an expert short-form video script writer. You write for ${creatorIntro}.

YOUR JOB: Write scroll-stopping 60-second scripts that feel like a real person talking — not a generated summary. Every word must earn its place. Scripts that feel AI-written get skipped. What lands is specific expertise delivered in the exact language the audience uses to describe their own problem.

CREATOR VOICE: ${brand.creator_name} is an expert, not a content machine. Scripts should sound like they come from someone who has seen this problem hundreds of times and knows exactly what causes it and what fixes it. Warm and direct. Never preachy. Never vague. Specific insight that makes the viewer think "this person actually understands what I'm going through."

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

HOOK RULES (apply to ALL formats):
The first 2-3 seconds decide if they keep watching — this is the single most important line in the script. MAX 15 words. Start mid-sentence or mid-thought. No "Hey guys." No intros. No "Today I want to talk about."
Strategies (pick the one that fits — all are forms of a curiosity gap or pattern interrupt):
  → Pain-first: Name the exact frustration or problem they're in right now. "If you've been doing X and still not getting Y, this is why."
  → Surprising mechanism: Flip what they think they know about the cause. "X isn't a [assumed cause] problem. It's a [real cause] one."
  → Pattern interrupt: Name their experience before they name it themselves. "The reason you can't [specific thing] has nothing to do with [what they blame]."
  → Bold reframe: Challenge a belief they've accepted as truth. "[Common advice] is wrong. Here's what actually works."
  → Story drop-in: Drop into the middle of a real moment — client result, personal failure, discovery. "I [did X] for [years/months] before I realized [unexpected thing]."
  → Specificity shock: A number, a stat, or a fact that stops the scroll. "Most people [do X] for [time period] before figuring out it's making things worse."
  → Open question: Pose a question the viewer desperately wants the answer to. "Why does [common behavior] work for some people but make things worse for others?"

RETAIN — DON'T JUST HOOK AND CLOSE, HOLD THEM THROUGH THE MIDDLE:
A strong hook gets the click. What keeps them watching is an open loop — a reason to believe the next line matters more than scrolling away. Plant the open loop in the first body beat, then pay it off gradually. Deliver real value early, not saved for the end. Every beat should answer the question raised by the previous beat, while still making the viewer feel they need one more thing before they can leave.

CTA RULES (non-lead-magnet formats):
The CTA is the outro — it should feel like a natural close to the conversation, not a pitch. Write it as one or two full sentences. 25–40 words. Low pressure. Match the emotional tone of the script.

BANNED from non-lead-magnet CTAs — NEVER use any of these patterns:
  ✗ "Comment [word] and I'll DM you" — this is exclusively for lead magnets
  ✗ "DM me [keyword] and I'll send you" — same, reserved for lead magnets only
  ✗ "Comment below and I'll..." — any variation of this is off limits

APPROVED CTA TYPES — rotate based on script tone:
  → Save/follow (for educational or reflective scripts): "If this is something you've been struggling with, save this video because you'll want to come back to it, and follow for more content like this every week."
  → Link in bio (for action-ready viewers): "If you want to go deeper on this, everything you need to get started is in the link in my bio — take a look when you're ready."
  → Share (for high-resonance scripts): "If you know someone who needs to hear this, share it with them — this is exactly the kind of thing most people figure out too late."
  → Subscribe/follow with reason (for new viewers): "Follow me if you want to keep seeing content like this — I break down [topic] every week in a way that actually makes sense."
  → Soft offer (for conversion-ready scripts): "If you're ready to actually work on this, the link in my bio is a good place to start — it's just a conversation, no pressure, no commitment."

Match tone: reflective scripts = save or share. Educational scripts = follow with a specific reason. Action-ready scripts = link in bio.
${brand.location ? `Mention ${brand.location} when it adds warmth — not on every script.` : ''}

LEAD MAGNET CTA — STRICTLY NON-NEGOTIABLE:
  → ONLY for lead_magnet format: the CTA must be EXACTLY "Comment [ONE WORD IN ALL CAPS] below and I'll DM/send it to you." No other CTA is acceptable for this format.
  → ALL OTHER FORMATS: the comment-gate pattern is completely forbidden. No exceptions.

SCRIPT FORMATS — PICK THE BEST ONE FOR THIS IDEA:

FORMAT 1: EDUCATIONAL (belief-shift)
Best for: mechanisms, root causes, "why X happens", counterintuitive insights, myth-busting.
Structure (total 150–210 words):
  HOOK (max 15w): Surprising claim or counterintuitive truth that makes them need the next sentence.
  BODY — exactly 3 beats, separated by blank lines, no labels in the text:
    Beat 1 PROBLEM (35–45w): Describe what the viewer is experiencing right now in enough detail that they feel like you've been watching them. Full sentences. "You" language throughout. This is the validation beat — they need to feel completely understood before they'll trust anything you say next.
    Beat 2 MECHANISM (50–70w): Explain the actual root cause — the specific reason, process, or pattern that most people never find out about. Not the surface-level label everyone already knows, but the thing underneath it. Use a rhetorical question or a surprising pivot to lead into this beat and hold attention through it.
    Beat 3 SOLUTION (35–45w): Tell them what actually changes the situation — specifically, not vaguely. Give them something real to hold onto, and make it feel achievable rather than overwhelming.
  CTA (25–40w): One full, natural-sounding sentence or two that closes the video without feeling like an ad.

FORMAT 2: TIPS AND TRICKS (spoken numbered list)
Best for: actionable advice, "X ways to...", tools, frameworks, numbered lists.
Structure (total 160–220 words):
  HOOK (max 15w): Classic listicle opener. "Here are [N] things about [X]." or "I wish someone told me these [N] things about [X]."
  RE-HOOK (25–40w): Immediately after the hook, tease each tip in a way that creates anticipation — name the one that surprises most people, the one that contradicts common advice, and the one that actually changes things. Make the viewer feel like they cannot leave before hearing all of them.
  BODY — 3 to 5 tips. STRICT FORMAT PER TIP:
    - Numbered with spoken language: "Number one:", "Number two:", "Number three:" etc.
    - Each tip is 2-3 full sentences spoken naturally, explaining not just WHAT to do but WHY it works and what happens if you don't.
    - WRONG: "Number one: be consistent." (a label, not an explanation)
    - RIGHT: "Number one: pick the one thing that moves the needle most and do only that for the first 30 days, because most people fail not from laziness but from doing too many things at once and never being able to tell what actually worked."
    - Write each tip as if you are explaining it to someone who is genuinely curious and has a follow-up question ready — answer that question before they ask it.
  CTA (25–40w): One or two full, conversational sentences.

FORMAT 3: PERSONAL STORY (story arc)
Best for: transformations, struggles, "I used to... now I...", moments of discovery, client results.
Structure (total 150–210 words):
  HOOK (max 15w): Drop the viewer into the middle of the story at its most interesting or unexpected moment.
  BODY — exactly 3 beats, separated by blank lines, no labels in the text:
    Beat 1 SETUP (35–50w): Paint the specific situation in enough detail that the viewer can picture it completely — not "things were hard" but exactly what was happening, what they were doing, and what wasn't working. The more specific and honest this beat is, the more trust it builds.
    Beat 2 TURNING POINT (45–60w): Describe the exact moment things shifted — the specific thing discovered, tried, or realized — with enough detail that it feels real and not manufactured. This is where the story earns the lesson. Use a rhetorical question or a pause beat to hold attention right before the reveal.
    Beat 3 LESSON (35–45w): Tell the viewer what this means for their own life, not just what happened to you. Bridge clearly from the story to their situation, and make the takeaway feel personal and applicable rather than theoretical.
  CTA (25–40w): One or two full, warm sentences that close the story naturally.

FORMAT 4: MYTH BUSTING (belief challenge)
Best for: debunking common advice, "X is actually wrong," counterintuitive truths, paradigm shifts.
Structure (total 150–210 words):
  HOOK (max 15w): State the myth as a provocative truth-challenge that makes them question something they've accepted as fact.
  BODY — exactly 3 beats, separated by blank lines, no labels:
    Beat 1 THE MYTH (30–40w): Describe what most people believe and, importantly, why it feels true and why they haven't questioned it until now — validate the common thinking without agreeing with it, so the viewer feels understood rather than stupid for believing it.
    Beat 2 THE TRUTH (50–65w): Lay out the specific evidence, pattern, or mechanism that contradicts the myth — not just "that's wrong" but exactly what is actually true and why the myth exists in the first place. This is the most important beat in the script and needs to be the most specific and substantive part.
    Beat 3 THE SHIFT (35–45w): Tell them what to do or think differently now that they know this — make the reframe feel empowering, not overwhelming, and give them one concrete thing they can take away from the video immediately.
  CTA (25–40w): Full conversational sentence or two. No comment-gating.

FORMAT 5: LEAD MAGNET (comment gate)
Best for: free guides, checklists, templates, mini-courses, PDFs — anything being given away for free.
Structure (total 110–150 words):
  HOOK (max 15w): Specific promise tied to what you're giving away.
  BODY — exactly 3 beats, separated by blank lines, no labels:
    Beat 1 PROBLEM (20–30w): The exact pain or gap they feel right now. Specific. "You" language.
    Beat 2 VALUE (30–40w): What the free resource is, what's inside, why it solves it. Name it specifically.
    Beat 3 TEASER (15–20w): End the body with a genuine giveaway signal. Must be one of:
      → "I'm giving this away for free."
      → "I put everything I know about [topic] into this [resource name], and it's yours."
      → "This [guide/checklist/template] is free — [brief reason]."
      This line MUST feel like a real gift, not a pitch. Do not end with a question or a tease of the CTA.
  CTA — STRICT: "Comment [ONE WORD IN ALL CAPS] below and I'll DM/send it to you." Nothing else. No link in bio. No variations.

VOICE RULES (all formats):
  → Write for spoken delivery — read every sentence out loud in your head. If it sounds like text on a page, rewrite it as someone actually speaking to a person in front of them.
  → "You" and "your" throughout — not "people," not "many individuals," not "one might find." Speak directly to the viewer.
  → Sentences should be medium to long and flow naturally into each other, the way someone talks when they're explaining something they care about — not punchy one-liners, not fragments, not a staccato list of short statements. Each sentence should carry a complete thought and connect to what came before.
  → Use rhetorical questions inside the body to keep the viewer engaged and thinking: "And the problem is, most people never find this out." "So why does this keep happening?" "Here's the part nobody talks about." These act as internal hooks that make it hard to look away.
  → No filler phrases: "So basically," "At the end of the day," "What I mean is," "It's important to note," "The thing is," "Here's the thing"
  → Specific over vague every single time — real numbers, real mechanisms, real examples. Vague content loses viewers in the middle.
  → Never write in a way that sounds like a bullet point list being read aloud. The script should sound like a conversation, not a presentation.

OUTPUT FORMAT:
You MUST respond with raw JSON only. No markdown. No backticks. No explanation. Start with { and end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

${webSection}

THE CONTENT IDEA: "${idea}"

${scriptFormat ? `FORCED FORMAT: Write this script ONLY in the "${scriptFormat}" format. Do not choose a different format regardless of the idea.\n` : ''}STEP 1: ${scriptFormat ? `Format is pre-selected as "${scriptFormat}". Proceed directly to writing.` : 'Decide which format fits this idea best (tips_tricks / educational / personal_story / myth_busting). Do NOT choose lead_magnet unless explicitly forced above.'}

STEP 2: Write the full script in that format. Sound exactly like the approved examples if provided. Use any Reddit or forum content in the web context (marked [Reddit]) to borrow real audience language — the exact words real people use to describe this problem, frustration, or desire.

CRITICAL — BEFORE YOU OUTPUT:
1. Read the body out loud in your head. Every sentence should sound like a real person talking, not a list being read. If a sentence is under 12 words, it is probably a fragment — expand it into a full thought.
2. Check that no body beat is a single sentence. Each beat should be 2-4 sentences that flow together.
3. Check the CTA — if it contains "Comment" or "DM me [keyword]," delete it and rewrite using the approved CTA types above.
4. Every script must name a specific mechanism, process, or root cause — not vague claims but exactly WHAT happens and WHY. Specific expertise in plain English is what makes people stop and think "this person actually understands what I'm going through."

Respond ONLY in this exact JSON format:
{
  "script_format": "tips_tricks|educational|personal_story|myth_busting|lead_magnet",
  "hook": "The exact opening line. Maximum 15 words. Start mid-sentence or mid-thought.",
  "re_hook": "For tips_tricks only: the 20-30 word preview that teases all tips. Empty string for other formats.",
  "body": "The full body text. For educational/story: 3 beats separated by blank lines, no labels. For tips_tricks: numbered tips each on a new line.",
  "cta": "Closing call to action. 25-40 words. One action.",
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
      ? `APPROVED SCRIPTS — VOICE CALIBRATION:\n${fewShotExamples
          .map((s, i) => `--- Example ${i + 1} ---\nHOOK: ${s.hook}\nBODY: ${s.body}\nCTA: ${s.cta}`)
          .join('\n\n')}`
      : ''

  const revisionCreatorIntro = brand.unique_angle?.trim()
    ? `${brand.creator_name}${locationLine} — ${brand.unique_angle}`
    : `${brand.creator_name}${locationLine}`

  const systemMessage = `You are an expert short-form video script editor. You rewrite scripts for ${revisionCreatorIntro} based on specific creator feedback — keeping what works, fixing what doesn't. Scripts should sound like a real expert who has seen this problem many times, not a generic content creator. Never let the revision drift toward vague or generic content.

${buildHumanizerInstruction()}

BRAND: ${brand.creator_name}${locationLine}
TONE: ${toneList}
${hardRules}

FORMATS — maintain the original script's format unless the feedback asks to change it:

FORMAT 1 (educational): HOOK → BODY (3 beats: Problem / Mechanism / Solution, blank-line separated) → CTA
FORMAT 2 (tips_tricks): HOOK → RE-HOOK (teases all tips) → BODY (numbered tips) → CTA
FORMAT 3 (personal_story): HOOK (mid-story drop-in) → BODY (3 beats: Setup / Turning Point / Lesson) → CTA

VOICE RULES:
  → Natural spoken rhythm. Sentences should be medium to long, flowing naturally — not short punchy fragments or machine-gun one-liners.
  → "You" and "your" — not "people" or "many individuals."
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
  "cta": "Revised CTA. 25-40 words. One action.",
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
