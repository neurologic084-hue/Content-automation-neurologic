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

// The only anti-jargon guidance used to live in brand.extra_context, phrased as
// "avoid unnecessary clinical jargon unless explaining a scientific concept
// clearly". The model took that escape hatch every single time: across the last
// 38 generated scripts, 49 sentences name the prefrontal cortex, almost always
// glossed inline ("your amygdala, the brain's threat-detection center"). It was
// also outnumbered by six separate instructions demanding "mechanism" and
// "specificity", which a model satisfies most cheaply by naming a brain region.
// These rules ban the terms outright, close the gloss loophole, and are stated
// as an override so neither the specificity instructions nor the creator's own
// extra_context can win the conflict.
//
// The word lists below are per-brand and deliberately NOT shared. A banned-word
// list is the most niche-specific thing in the whole prompt: "amygdala" is
// jargon to a neurofeedback audience and plain vocabulary to a neuroscience
// channel, and "the people I work with" is one clinician's phrasing, not a
// house style. Brands with no profile here get the niche-agnostic core, which
// bans jargon by description rather than by list.
interface PlainLanguageProfile {
  /** Who is on the other end of the video, in this brand's own terms. */
  audience: string
  /** Terms that fail the script outright. */
  bannedTerms: string
  /** Machine-checkable form of bannedTerms, used to stamp the few-shot examples
   *  with their own violations. Kept separate so bannedTerms can stay readable
   *  prose ("delta/theta/alpha waves") while the scanner stays accurate. */
  scanTerms: string[]
  /** BAD/GOOD rewrite pairs proving the inline definition does not rescue a banned term. */
  glossExamples: string
  /** Field words the audience uses about itself   banning these flattens the voice. */
  allowedTerms: string
  /** What this creator's authority rests on, e.g. "A DOCTOR". */
  credential: string
}

// Keyed by normalised creator_name so a profile survives "Dr. Jessica Wendling"
// vs "Jessica Wendling". Renaming a brand in settings drops it back to the core
// rules, which is the intended failure direction: a brand quietly losing its
// term list is recoverable, another tenant's scripts quietly inheriting a
// neurofeedback clinician's vocabulary is not.
const PLAIN_LANGUAGE_PROFILES: Record<string, PlainLanguageProfile> = {
  'jessica wendling': {
    audience:
      'a worried parent, an exhausted 42-year-old, someone watching on their phone at 11pm. Not a colleague, not a conference room. If a line would read as normal in a chart note or a lecture slide, it is wrong here.',
    bannedTerms:
      'prefrontal cortex, cortex, amygdala, limbic, hippocampus, HPA axis, autonomic, sympathetic nervous system, parasympathetic, vagus, vagal, dysregulated, dysregulation, hyperarousal, hypoarousal, neuroplasticity, neural pathway, circuitry, reward circuitry, EEG, qEEG, delta/theta/alpha/beta/high-beta/SMR waves, norepinephrine, cortisol elevation, elevated baseline, metabolic efficiency, physiologic, psychophysiology, executive function, white matter, comorbid, etiology, reward prediction error, threshold, protocol, intervention, modality, contraindicated, clinical, patients, symptoms, presentation, assessment.',
    scanTerms: [
      'prefrontal', 'cortex', 'amygdala', 'limbic', 'hippocamp', 'hpa axis', 'autonomic',
      'sympathetic nervous', 'parasympathetic', 'vagus', 'vagal', 'dysregulat', 'hyperarous',
      'hypoarous', 'neuroplastic', 'neural pathway', 'circuitry', 'eeg', 'delta wave',
      'theta', 'alpha wave', 'high-beta', 'slow-wave', 'brainwave', 'norepinephrine',
      // Bare "cortisol" is allowed once per script, so only the clinical
      // constructions of it count as violations worth flagging on an example.
      'cortisol elevation', 'elevated baseline', 'metabolic', 'physiolog', 'psychophysiolog',
      'executive function', 'white matter', 'comorbid', 'etiology', 'reward prediction',
      'contraindicat', 'clinical', 'patients', 'symptom', 'modality', 'protocol',
    ],
    glossExamples: `  BAD:  "That's your amygdala, the brain's threat-detection center, running at a chronically elevated baseline."
  GOOD: "That's your brain's alarm system, stuck in the on position."
  BAD:  "The prefrontal cortex, the region responsible for focus and clear thinking, loses the metabolic fuel it needs to stay online."
  GOOD: "The part of your brain that does the hard thinking runs out of fuel and quietly goes offline."
  BAD:  "when your HPA axis, the system that regulates your stress hormones, has been dysregulated by chronic stress"
  GOOD: "your body's stress dial got turned up years ago and nothing ever turned it back down"
  BAD:  "Brain fog isn't a personality trait. It's a dysregulation pattern."
  GOOD: "Brain fog isn't who you are. It's a pattern your brain got stuck in."
  BAD:  "We'll talk through your symptoms and figure out if neurofeedback is a good fit for you."
  GOOD: "We'll talk through what's been going on and see if this is a good fit for you."`,
    allowedTerms:
      'brain, neurofeedback, brain fog, burnout, anxiety, ADHD, trauma, PTSD, sleep, stress, fight-or-flight, dopamine. "Nervous system" is allowed at most twice per script and never as the explanation itself. "Cortisol" is allowed once, described plainly as a stress hormone. Say "the people I work with", never "patients". Say "what you\'re dealing with", never "symptoms".',
    credential: 'A DOCTOR',
  },
}

function plainLanguageProfileKey(creatorName: string): string {
  return creatorName
    .toLowerCase()
    .replace(/^(dr|doctor|prof|professor)\.?\s+/, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pass the ACTIVE brand so a tenant only ever gets its own vocabulary. Called
 *  with no brand (the lean, brand-free pipeline) it returns the core rules,
 *  which still ban jargon   just by description instead of by term list. */
export function buildPlainLanguageRules(brand?: Pick<BrandSettings, 'creator_name'>): string {
  const creatorName = brand?.creator_name?.trim() ?? ''
  const profile = creatorName ? PLAIN_LANGUAGE_PROFILES[plainLanguageProfileKey(creatorName)] : undefined

  const audience =
    profile?.audience ??
    'whoever is watching on their phone at 11pm, not a colleague and not a conference room. If a line would read as normal in a professional report or a lecture slide, it is wrong here.'

  const bannedSection = profile
    ? `BANNED WORDS. If even one appears in the hook, body, or CTA, the script has failed. No context makes them acceptable:
${profile.bannedTerms}`
    : `BANNED VOCABULARY. Any word a viewer outside this field would have to look up fails the script, wherever it appears in the hook, body, or CTA: anatomy and biochemistry names, diagnostic and clinical labels, industry or academic terminology, and the abstract nouns professionals only use with each other. If you know the word from training rather than from conversation, it does not go in.`

  const glossSection = `THE GLOSS LOOPHOLE IS CLOSED. Defining a banned term inline does not license it. All of these are violations:
${
  profile?.glossExamples ??
  `  BAD:  "The system enters a state of sustained elevated activation, meaning it never fully powers down."
  GOOD: "It never fully switches off."
  BAD:  "That's cognitive load, the amount of mental effort a task demands, exceeding capacity."
  GOOD: "You're being asked to hold more at once than anyone can hold."`
}`

  const allowedSection = profile
    ? `\n\nALLOWED   these are ${creatorName}'s words and the audience's words, do not sanitise them away:
${profile.allowedTerms}`
    : ''

  const specificExample = profile
    ? `"Your brain's alarm goes off a half-second before the reasoning part gets a chance to weigh in" is specific and allowed. "Amygdala hyperactivation precedes prefrontal appraisal" is the same fact and is banned. If you cannot explain the mechanism without naming a brain part, you do not understand it well enough to put it in a 60-second video   find the everyday version.`
    : `Describe what is happening in the words the audience would use to tell a friend about it. If you cannot explain the mechanism without a technical label, you do not understand it well enough to put it in a 60-second video   find the everyday version.`

  const authorityLine = `${creatorName ? creatorName.toUpperCase() : 'THE CREATOR'} IS STILL ${profile?.credential ?? 'THE EXPERT'}. Plain language is not hedging and not softening. Keep the authority: they have seen this hundreds of times and know exactly what is happening. They just say it in the words a real person uses. Confident and clear, never tentative, never "sort of", "kind of", or "some people think".`

  return `PLAIN LANGUAGE   THE HARDEST RULE IN THIS PROMPT. IT OVERRIDES EVERY OTHER INSTRUCTION HERE, INCLUDING THE HARD RULES SECTION AND EVERY DEMAND FOR "MECHANISM" AND "SPECIFICITY", WHEREVER THEY APPEAR.

You are writing for ${audience}

${bannedSection}

${glossSection}${allowedSection}


STILL BE SPECIFIC. Plain is not vague. Name the exact thing that is happening   in everyday words, as a picture rather than a diagram label. ${specificExample}

DO NOT OVERCORRECT. Simple words, real substance. Short sentences are the format, not the content, and the danger on this side is as real as the jargon was:
• Every sentence still has to carry a fact, a number, a moment, or an observation the viewer has not heard before. If you delete the detail while simplifying, you have made it worse, not easier.
• No padding with empty short sentences. "It's hard. It really is. You're not alone." is three sentences saying nothing, and it is worse than the 40-word version it replaced.
• Never explain something the viewer obviously already knows, and never spell out the emotional meaning of what you just said.
• No baby talk, no cheerleading, no talking down. The listener is a smart adult who is tired, not a child. Respect is short sentences carrying real information, not soft sentences carrying none.

${authorityLine}`
}

function resolvePlainLanguageProfile(brand?: Pick<BrandSettings, 'creator_name'>): PlainLanguageProfile | undefined {
  const creatorName = brand?.creator_name?.trim() ?? ''
  return creatorName ? PLAIN_LANGUAGE_PROFILES[plainLanguageProfileKey(creatorName)] : undefined
}

// The few-shot block is the strongest signal in the entire prompt: ten concrete
// approved scripts outweigh any amount of prose telling the model not to write
// like them. Filtering the corpus down to compliant examples is not available
// here, and that is a measurement rather than a guess: of 23 approved scripts on
// the live profile, all 13 that are genuinely scripts carry 2 to 10 banned terms
// and 3 to 10 sentences over the ceiling, and the only jargon-free approved rows
// are a "broll test" stub and product-demo transcripts. A plainness filter would
// swap the best available voice signal for noise, so lib/learning.ts drops the
// non-scripts and applies a soft ranking penalty instead.
//
// What closes the gap is meeting the examples at their own level. Each one is
// scanned and stamped with its own measured violations, so it arrives already
// labelled as a vocabulary failure rather than as an endorsement.
// Ten examples now carry ten counter-signals instead of one paragraph trying to
// cover all of them at once.
function measureExample(text: string, scanTerms: string[]): { banned: string[]; total: number } {
  const lower = text.toLowerCase()
  const banned = scanTerms.filter((t) => lower.includes(t))
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
  return {
    banned,
    total: sentences.length,
  }
}

function buildFewShotSection(
  examples: Script[],
  brand: Pick<BrandSettings, 'creator_name'> | undefined,
  emptyFallback: string
): string {
  if (examples.length === 0) return emptyFallback

  const scanTerms = resolvePlainLanguageProfile(brand)?.scanTerms ?? []

  const rendered = examples
    .map((s, i) => {
      const m = measureExample(`${s.hook} ${s.body} ${s.cta}`, scanTerms)
      const problems: string[] = []
      if (m.banned.length) problems.push(`${m.banned.length} banned words (${m.banned.slice(0, 6).join(', ')})`)
      const verdict = problems.length
        ? `FAILS THE CURRENT BAR: ${problems.join('; ')}. Reproduce none of that.`
        : `Closer to the bar than most, but check it against the rules anyway rather than trusting it.`
      return `--- Example ${i + 1} ---
${verdict}
HOOK: ${s.hook}
BODY: ${s.body}
CTA: ${s.cta}`
    })
    .join('\n\n')

  return `APPROVED SCRIPTS   RHYTHM CALIBRATION ONLY:
Study these for one thing: how directly they speak to the viewer, and the energy and structure of the delivery. Nothing else.

THEY SHOW VOICE, NOT VOCABULARY. Every one of these was approved before the plain-language and readability rules existed, and the note above each one is a real count taken from that example just now. They are the exact defect you are being told to fix. Reading them will pull you toward technical words because that is what they are made of, and that pull is the single most likely reason this script fails.

So use them like this: take the rhythm, the directness, the confidence, the way a beat turns into the next one. Then say all of it using words the audience actually uses. A script that sounds like these without a single piece of clinical vocabulary is the target.

${rendered}`
}

// brand.extra_context is user-editable and seeded with an anti-jargon line that
// carries its own escape hatch ("avoid clinical jargon UNLESS explaining a
// scientific concept clearly"). That clause is where every jargon-heavy script
// came from. Two things fix it and both are needed: the plain-language block is
// emitted AFTER this one so it holds the last and strongest position, and the
// carve-out is voided by name here. The creator's lines are still passed
// through verbatim   they also carry medical-claim and compliance rules we have
// no business silently dropping, and editing someone's own brand settings out
// from under them in code is worse than overriding one clause in the open.
function buildBrandHardRules(brand: BrandSettings): string {
  const context = brand.extra_context?.trim()
  if (!context) return ''

  const rules = context
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `• ${l.trim().replace(/^[-•]\s*/, '')}`)
    .join('\n')

  return `HARD RULES FROM THE CREATOR   NON-NEGOTIABLE, except where PLAIN LANGUAGE below says otherwise:
${rules}

READING THESE RULES:
• Any exception in them that permits technical, clinical, or scientific vocabulary "when explained clearly", "in patient-friendly language", or under any similar condition is VOID. There is no condition under which a banned word is acceptable, and defining it clearly is not a way to earn it. The PLAIN LANGUAGE section below wins that conflict every time.
• These rules are written in the creator's professional shorthand, so some of them use words the script itself may not use ("symptoms", "physiologic", "nervous system"). They tell you what to MEAN, never which words to WRITE. Follow the intent and say it the audience's way.`
}

export function buildScriptGenerationMessages(
  idea: string,
  lane: AudienceLane,
  brand: BrandSettings,
  fewShotExamples: Script[],
  searchContext: string,
  moodTag?: string,
  scriptFormat?: string,
  learningSections?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  // Use brand-configured lane description when available — this allows the tool
  // to work for any niche without code changes. Falls back to the built-in
  // defaults (currently tuned for Neuro Logic) when not configured.
  const laneDescription = brand.lane_descriptions?.[lane] ?? LANE_SYSTEM_DESCRIPTIONS[lane]
  const baseTone = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const toneList = moodTag ? `${baseTone} -- lean ${moodTag} for this script` : baseTone

  const hardRules = buildBrandHardRules(brand)

  const fewShotSection = buildFewShotSection(
    fewShotExamples,
    brand,
    'No approved examples yet. Write with the warmth, specificity, and authority of an expert who has seen this problem many times and knows exactly what causes it.'
  )

  const webSection = searchContext?.trim()
    ? `LIVE WEB CONTEXT — USE THIS:
This is fresh, real-world content pulled from the internet. Use relevant facts, mechanisms, or angles to make the script feel current and credible. Do NOT fabricate statistics — only reference things you can ground in this context or established science.

IMPORTANT: Look for Reddit posts and forum content in the search results (marked [Reddit]). These show the EXACT words real people use to describe this problem or desire. Borrow that language directly — not paraphrased, but the actual phrases people use when they're frustrated, stuck, or searching for answers. That language is what makes a viewer stop and think "this is exactly me."

${searchContext}`
    : `No live web context available. Draw on established expertise in ${brand.creator_name}'s field. Explain specific mechanisms and processes — not vague claims — but do the translation yourself before you write: work out the science, then say it in the plain English the audience uses to describe their own experience. The technical version never reaches the page.`

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
    Beat 2 MECHANISM (50–70w): Explain the actual root cause — the specific reason, process, or pattern that most people never find out about. Not the surface-level label everyone already knows, but the thing underneath it. Describe what is HAPPENING, never what it is CALLED: no brain-part names, no hormone names, no technical labels, no inline definitions. This is the beat that fails the plain-language rules most often — write it as if explaining it to the viewer's mother. Use a rhetorical question or a surprising pivot to lead into this beat and hold attention through it.
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
  Never state credentials or say "I've helped X people" as a standalone trust line — including for case-study-style stories (client results, before/afters). The proof must live inside the specific numbers and details of the story itself, never a bolted-on credibility statement.
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
  → Sentences carry one complete thought each and flow into each other, the way someone talks when they're explaining something they care about. Short is the default. What makes it sound like talking is that each sentence answers the one before it, not that any single sentence is long.
  → Use rhetorical questions inside the body to keep the viewer engaged and thinking: "And the problem is, most people never find this out." "So why does this keep happening?" "Here's the part nobody talks about." These act as internal hooks that make it hard to look away.
  → No filler phrases: "So basically," "At the end of the day," "What I mean is," "It's important to note," "The thing is," "Here's the thing"
  → Specific over vague every single time — real numbers, real examples, real mechanisms described in everyday words. Vague content loses viewers in the middle. Technical vocabulary is not specificity, it is the substitute for it.
  → Never write in a way that sounds like a bullet point list being read aloud. The script should sound like a conversation, not a presentation.

${buildPlainLanguageRules(brand)}

OUTPUT FORMAT:
You MUST respond with raw JSON only. No markdown. No backticks. No explanation. Start with { and end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

${learningSections?.trim() ? `${learningSections}\n\n` : ''}${webSection}

THE CONTENT IDEA: "${idea}"

${scriptFormat ? `FORCED FORMAT: Write this script ONLY in the "${scriptFormat}" format. Do not choose a different format regardless of the idea.\n` : ''}STEP 1: ${scriptFormat ? `Format is pre-selected as "${scriptFormat}". Proceed directly to writing.` : 'Decide which format fits this idea best (tips_tricks / educational / personal_story / myth_busting). Do NOT choose lead_magnet unless explicitly forced above.'}

STEP 2: Write the full script in that format. Match the rhythm and directness of the approved examples if provided, never their vocabulary. Use any Reddit or forum content in the web context (marked [Reddit]) to borrow real audience language — the exact words real people use to describe this problem, frustration, or desire.

CRITICAL — BEFORE YOU OUTPUT:
1. JARGON SWEEP — DO THIS FIRST AND DO IT LITERALLY. Go through the hook, body, and CTA word by word against the BANNED WORDS list. Every hit gets its whole sentence rewritten in everyday words, and then you sweep again. Defining a term inline does not count as fixing it. One banned word means the script has failed, so the sweep is not optional and it is not a formality.
2. FIRST-LISTEN TEST. Read the body out loud in your head, once, at speaking speed. Any sentence you would need to hear twice gets rewritten in plainer words — the fix is vocabulary and concreteness, never length.
3. SUBSTANCE CHECK — THE OTHER HALF OF THE BAR, AND SKIPPING IT IS HOW SIMPLIFYING GOES WRONG. Reread the shortened version and ask what the viewer actually learned. Every sentence must still carry a fact, a number, a moment, or a specific observation. Any sentence that survives only as filler you produced while cutting gets deleted, and the real detail goes back in plain words. Short and empty fails exactly as hard as long and technical.
4. Check that no body beat is a single sentence.
5. Check the CTA — if it contains "Comment" or "DM me [keyword]," delete it and rewrite using the approved CTA types above.
6. Every script must explain a specific mechanism or root cause — exactly WHAT happens and WHY — described the way you would describe it to a friend across a table. Naming a brain region or a hormone is not an explanation, it is a label standing in for one. Specific expertise in plain English is what makes people stop and think "this person actually understands what I'm going through."

Respond ONLY in this exact JSON format:
{
  "script_format": "tips_tricks|educational|personal_story|myth_busting|lead_magnet",
  "hook": "The exact opening line. Maximum 15 words. Start mid-sentence or mid-thought.",
  "alt_hooks": ["Alternate hook with a DIFFERENT angle (e.g. question vs statement, curiosity vs pain point). Max 15 words.", "Second alternate with a different structure again. Max 15 words."],
  "re_hook": "For tips_tricks only: the 20-30 word preview that teases all tips. Empty string for other formats.",
  "body": "The full body text. For educational/story: 3 beats separated by blank lines, no labels. For tips_tricks: numbered tips each on a new line.",
  "cta": "Closing call to action. 25-40 words. One action.",
  "full_script": "HOOK:\\n[hook]\\n\\n[re_hook if tips_tricks, otherwise skip]\\n\\nBODY:\\n[body]\\n\\nCTA:\\n[cta]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One-line outfit recommendation that fits THIS topic and mood — e.g. a soft casual sweater for a vulnerable story, smart casual for a myth-busting piece, athletic wear for an energy topic. Keep it simple and practical.",
    "b_roll": ["2-4 B-roll shot ideas tied to actual lines or beats of THIS script. HARD CONSTRAINT: each must be filmable ALONE with just a phone propped up or held, at home or around the creator's own workspace/clinic — simple everyday actions and objects (pouring tea, journaling, opening curtains, walking down the office hallway, hands on a keyboard, tidying a desk). Never suggest anything that needs production: other people on camera, staged sessions or procedures, special equipment setups, or a second pair of hands. Each under 12 words, e.g. 'Pouring tea, hands only, over the hook'. Order them to match the script's flow."],
    "body_labels": ["3-5 word label for beat/tip 1", "3-5 word label for beat/tip 2", "3-5 word label for beat/tip 3"]
  },
  "delivery_cues": ["3-5 short coaching notes for the creator ON CAMERA, each tied to a specific line or beat: where to pause, which word to punch, when to slow down, when to lean in or smile. E.g. 'Pause a full beat after the hook — let it land before explaining.' Write them for THIS script, not generic advice."],
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
  fewShotExamples: Script[],
  learningSections?: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const toneList = brand.tone_keywords?.length ? brand.tone_keywords.join(', ') : 'warm, direct, science-backed'
  const locationLine = brand.location?.trim() ? ` based in ${brand.location}` : ''
  // Honour the brand's own lane copy the way generation does, so a revision
  // can't quietly re-aim the script at the built-in default audience.
  const laneDescription = brand.lane_descriptions?.[lane] ?? LANE_SYSTEM_DESCRIPTIONS[lane]

  const hardRules = buildBrandHardRules(brand)

  // Same annotated corpus as the generation path. Without it, "make this less
  // clinical" feedback gets rewritten against a corpus approved back when the
  // jargon was fine, and the revision reintroduces exactly what was flagged.
  const fewShotSection = buildFewShotSection(fewShotExamples, brand, '')

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
  → Natural spoken rhythm. One complete thought per sentence, each answering the one before it. Short is the default; the flow comes from how the sentences connect, never from their length.
  → "You" and "your" — not "people" or "many individuals."
  → Specific over vague. No filler phrases.
  → If it sounds like a blog post or a bullet list, rewrite it as someone actually talking.

${buildPlainLanguageRules(brand)}

The original script below was written before these rules and probably breaks them. Fix every violation you find even when the feedback did not mention it — a revision that preserves the original's jargon or its 30-word sentences has not done its job, whatever else it fixed. Simplifying is not a licence to drop detail: the rewrite keeps every fact, number, and specific moment the original had.

OUTPUT: Raw JSON only. No markdown. No backticks. Start with { end with }.`

  const userMessage = `${laneDescription}

${fewShotSection}

${learningSections?.trim() ? `${learningSections}\n\n` : ''}ORIGINAL SCRIPT:
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

BEFORE YOU OUTPUT, in this order:
1. Sweep the rewritten hook, body, and CTA word by word against the BANNED WORDS list. Every hit gets its sentence rewritten in everyday words, then sweep again. One banned word means the revision has failed.
2. Count the words in every sentence. Anything over 20 gets split into two sentences that each say one thing, then count again. Splitting, not trimming.
3. Reread it and ask what the viewer learned. Every sentence still has to carry a fact, a number, or a specific moment. If simplifying left you with short empty sentences, delete them and put the real detail back in plain words.

Respond ONLY in this exact JSON format:
{
  "script_format": "tips_tricks|educational|personal_story",
  "hook": "Revised hook. Maximum 15 words. Start mid-sentence.",
  "alt_hooks": ["Alternate hook with a different angle. Max 15 words.", "Second alternate with a different structure. Max 15 words."],
  "re_hook": "For tips_tricks only. Empty string otherwise.",
  "body": "Revised body. Match format structure.",
  "cta": "Revised CTA. 25-40 words. One action.",
  "full_script": "HOOK:\\n[hook]\\n\\n[re_hook if tips_tricks]\\n\\nBODY:\\n[body]\\n\\nCTA:\\n[cta]",
  "filming_plan": {
    "shot_type": "talking head | b-roll with voiceover | walk-and-talk",
    "setup": "One sentence: where to stand, how to light it, how to frame it.",
    "wardrobe": "One-line outfit recommendation that fits this topic and mood. Keep it simple and practical.",
    "b_roll": ["2-4 B-roll shot ideas tied to actual lines or beats of THIS script, each under 12 words, ordered to match the script's flow. Each must be filmable alone with just a phone, at home or around the creator's own workspace/clinic — simple actions only, no staged sessions, other people, or equipment setups."],
    "body_labels": ["3-5 word label for beat/tip 1", "3-5 word label for beat/tip 2", "3-5 word label for beat/tip 3"]
  },
  "delivery_cues": ["3-5 short coaching notes for delivering THIS script on camera: where to pause, which word to punch, when to slow down or lean in."],
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
