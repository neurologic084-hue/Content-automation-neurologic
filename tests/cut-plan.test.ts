// Regression tests for the cut planner (lib/edit-plan.ts). Two real bugs, both
// found by watching a rendered video and then reproducing them here.
//
// 1. isRestartedBy — Haiku marked "You should," in
//      "...You should hear some music. [You should,] uh, see some captions..."
//    as a false start on 5/5 runs, deleting two real words. It is the LATER
//    occurrence, and the prompt explicitly says to keep the final take. The
//    validator enforces the precondition the model states but does not obey:
//    an abandoned attempt is a near-duplicate of the speech that FOLLOWS it.
//
// 2. findStutterDrops — the viewer heard "enough ... enough" at 1:05 of every
//    variant. The old rule compared adjacent TOKENS, and a filler sat between
//    the two takes ("enough," / "uh," / "enough"), so it compared "enough" to
//    "uh" and found nothing. It never fired once on the whole transcript. The
//    fix compares each word to the next SURVIVING word.
//
//   npm run test:cut
//
// No network, no API keys, no spend — pure functions over synthetic transcripts.

import { isRestartedBy, findStutterDrops, findRepeatedTakes, findSelfCorrectionDrops, buildRetakeWindows, sanitizeWordTimings, planKeepSegments, remapToEditedTimeline } from '../lib/edit-plan'
import type { WordTimestamp } from '../lib/caption-renderer'

// Build word timings from a sentence; timings are irrelevant to isRestartedBy
// but keep the type honest.
function w(text: string): WordTimestamp[] {
  return text.split(/\s+/).map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }))
}

// Explicit timings, for the stutter cases where the gap IS the signal.
// "word@start-end" — e.g. timed('enough,@74.60-74.90', 'uh,@74.98-75.34')
function timed(...specs: string[]): WordTimestamp[] {
  return specs.map(s => {
    const [text, span] = s.split('@')
    const [start, end] = span.split('-').map(Number)
    return { text, start, end }
  })
}

interface Case {
  name: string
  words: WordTimestamp[]
  span: [number, number]
  expect: boolean   // true = a real retake, safe to drop
}

const CASES: Case[] = [
  {
    // THE OBSERVED BUG. Must be rejected.
    name: 'new sentence that echoes the previous one is NOT a retake',
    words: w('You should hear some music in the back. You should, uh, see some captions on the screen'),
    span: [8, 10],           // "You should, uh,"
    expect: false,
  },
  {
    name: 'classic false start: phrase abandoned then restarted verbatim',
    words: w('I think the best I think the best way to do this is'),
    span: [0, 3],            // "I think the best"
    expect: true,
  },
  {
    name: 'restart that drops a word still counts (>= 60% of content words reappear)',
    words: w('So the first thing you want So the first thing is consistency'),
    span: [0, 5],            // "So the first thing you want"
    expect: true,
  },
  {
    name: 'restart beginning slightly later in the window',
    words: w('The best way I think the best way is repetition'),
    span: [0, 2],            // "The best way"
    expect: true,
  },
  {
    name: 'pure filler span carries no meaning, always droppable',
    words: w('and then uh um we move on to the next part'),
    span: [2, 3],            // "uh um"
    expect: true,
  },
  {
    name: 'span at the very end is the final take, never a retake',
    words: w('and that is really all there is to it'),
    span: [6, 8],
    expect: false,
  },
  {
    name: 'unrelated span that shares no opening word is not a retake',
    words: w('We measured the results carefully and then published the paper'),
    span: [0, 3],            // "We measured the results"
    expect: false,
  },
  {
    name: 'emphasis repetition across a full clause is not a restart',
    words: w('This matters a lot because your audience can tell when you rush the delivery'),
    span: [0, 3],            // "This matters a lot"
    expect: false,
  },
  {
    // THE VALIDATOR HOLE. A flubbed word never returns verbatim, so "for
    // higher," restarted as "for high achievers" matched 1 of 2 words (50% <
    // 60%) and the validator rejected the model's CORRECT flag. Near-miss
    // words ("higher"/"high") now count as reappearing.
    name: 'flubbed word restated as its near-miss IS a restart',
    words: w('for higher, for high achievers need structure daily'),
    span: [0, 1],            // "for higher,"
    expect: true,
  },
  {
    name: 'mid-span flub restated with the corrected word still validates',
    words: w('this is import this is important work every day'),
    span: [0, 2],            // "this is import"
    expect: true,
  },
  {
    // Near-miss matching must never loosen the HEAD: the anchor word has to
    // reappear exactly, so an echo of a merely similar word stays untouched.
    name: 'near-miss anchor is not enough — echo of a similar word is not a restart',
    words: w('Keep working. Work is what matters most here'),
    span: [1, 1],            // "working."
    expect: false,
  },
]

let failed = 0
console.log('── isRestartedBy (retake validator) ─────────────────────────────')
for (const c of CASES) {
  const got = isRestartedBy(c.words, c.span[0], c.span[1])
  const ok = got === c.expect
  if (!ok) failed++
  const span = c.words.slice(c.span[0], c.span[1] + 1).map(x => x.text).join(' ')
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      span "${span}" -> ${got ? 'drop' : 'keep'} (expected ${c.expect ? 'drop' : 'keep'})`)
}

// ── findStutterDrops ─────────────────────────────────────────────────────────

interface StutterCase {
  name: string
  words: WordTimestamp[]
  dropped: number[]      // indices already removed (fillers, retakes) before the rule runs
  expect: number[]       // indices the rule must drop
}

const STUTTER: StutterCase[] = [
  {
    // THE OBSERVED BUG — real timings from the demo transcript, indices 272-274.
    name: 'duplicate separated by a filler ("enough, uh, enough")',
    words: timed('thing@74.42-74.52', 'enough,@74.60-74.90', 'uh,@74.98-75.34', 'enough@75.38-75.74', 'footage@75.76-76.08'),
    dropped: [2],        // "uh," already dropped as filler
    expect: [1],         // the FIRST "enough," goes
  },
  {
    name: 'plain adjacent duplicate across a pause still drops the first',
    words: timed('fact@10.0-10.4', 'fact,@10.9-11.3', 'if@11.35-11.5'),
    dropped: [],
    expect: [0],
  },
  {
    name: 'back-to-back repetition with no pause is emphasis, not a stutter',
    words: timed('no,@5.0-5.2', 'no!@5.25-5.5'),
    dropped: [],
    expect: [],          // gap 0.05s < 0.25s
  },
  {
    name: 'short words (< 3 chars) are never treated as stutters',
    words: timed('to@1.0-1.1', 'to@1.6-1.7', 'the@1.75-1.9'),
    dropped: [],
    expect: [],
  },
  {
    name: 'duplicate separated by a REAL word is a retake, not a stutter',
    words: timed('money@2.0-2.4', 'makes@2.5-2.9', 'money@3.4-3.8'),
    dropped: [],
    expect: [],          // "makes" survives, so the two are not consecutive survivors
  },
  {
    // NB: uses a >=3 char word on purpose. "so so so" is exempt by the length
    // guard, same as the "to to" case above — short function words are never
    // treated as stutters.
    name: 'three takes of the same word collapse to the last one',
    words: timed('and@1.0-1.3', 'and@1.7-2.0', 'and@2.4-2.7', 'anyway@2.75-3.2'),
    dropped: [],
    expect: [0, 1],      // both earlier takes go, final take stays
  },
  {
    name: 'duplicate hidden behind TWO fillers',
    words: timed('really@1.0-1.4', 'um,@1.5-1.8', 'uh,@1.85-2.1', 'really@2.2-2.6', 'good@2.65-3.0'),
    dropped: [1, 2],
    expect: [0],
  },
]

console.log('\n── findStutterDrops (spoken stutters) ───────────────────────────')
for (const c of STUTTER) {
  const got = findStutterDrops(c.words, new Set(c.dropped))
  const ok = JSON.stringify(got) === JSON.stringify(c.expect)
  if (!ok) failed++
  const show = (idx: number[]) => idx.length ? idx.map(i => `[${i}] "${c.words[i].text}"`).join(' ') : '(none)'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      "${c.words.map(x => x.text).join(' ')}"`)
  console.log(`      drops ${show(got)}  (expected ${show(c.expect)})`)
}

// ── findRepeatedTakes ────────────────────────────────────────────────────────
// The client's report: "some of the cutting is not good on the repeting the same
// sentence". A restated SENTENCE had no deterministic detector — only the Haiku
// pass, which returns [] on any miss or network failure. These lock in both the
// catches and, more importantly, the rhetorical figures that must survive.

interface RepeatCase {
  name: string
  words: WordTimestamp[]
  dropped: number[]
  expect: number[]
}

const REPEATS: RepeatCase[] = [
  {
    name: 'whole sentence restated after a filler drops the FIRST take',
    words: w('Number one you fall asleep fine uh Number one you fall asleep fine but you wake up at three'),
    dropped: [6],                       // "uh" already dropped as filler
    expect: [0, 1, 2, 3, 4, 5],         // first take goes, keeper stays
  },
  {
    name: 'restate that rewords slightly still collapses to the later take',
    words: w('Your nervous system is stuck in high gear Your nervous system is stuck in high gear and it cannot power down'),
    dropped: [],
    expect: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  {
    name: 'abandoned tail between the two attempts goes with the first take',
    words: w('The racing thoughts are not the I mean The racing thoughts are not the cause of this'),
    dropped: [],
    expect: [0, 1, 2, 3, 4, 5, 6, 7],   // includes the "I mean" fragment
  },
  {
    // THE FIGURE THAT MUST SURVIVE — named explicitly in the bug report triage.
    name: 'rhetorical contrast "it is not X, it is Y" is never a retake',
    words: w('This is not a sleep problem This is a cortisol timing issue that we can measure'),
    dropped: [],
    expect: [],
  },
  {
    name: 'anaphora with different payloads is rhetoric, not a retake',
    words: w('You deserve real rest You deserve real recovery and your brain deserves both'),
    dropped: [],
    expect: [],
  },
  {
    name: 'conversational glue is never collapsed on its own',
    words: w('and so then you know and so then you know'),
    dropped: [],
    expect: [],                          // fewer than 2 distinct substantial words
  },
  {
    name: 'three takes of the same sentence collapse to the last',
    words: w('Cortisol rises too early in the morning Cortisol rises too early in the morning Cortisol rises too early in the morning hours for you'),
    dropped: [],
    expect: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  },
  {
    name: 'a phrase that recurs far later in the script is left alone',
    words: w('slow wave sleep is the deep stage where your brain clears waste and repairs before you ever reach slow wave sleep again'),
    dropped: [],
    expect: [],                          // second occurrence is well past the skip window
  },
]

console.log('\n── findRepeatedTakes (restated sentences) ───────────────────────')
for (const c of REPEATS) {
  const got = findRepeatedTakes(c.words, new Set(c.dropped))
  const ok = JSON.stringify(got) === JSON.stringify(c.expect)
  if (!ok) failed++
  const show = (idx: number[]) => idx.length ? idx.map(i => `"${c.words[i].text}"`).join(' ') : '(none)'
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      "${c.words.map(x => x.text).join(' ')}"`)
  console.log(`      drops ${show(got)}`)
  if (!ok) console.log(`      expected ${show(c.expect)}`)
}


// ── findSelfCorrectionDrops ──────────────────────────────────────────────────
// Reported from a rendered video: "for higher, for high achievers" — she got
// the word wrong and restarted, and the abandoned attempt shipped. It fell
// between the two detectors above: findStutterDrops needs the words IDENTICAL
// ("higher" is not "high") and findRepeatedTakes needs three words to call
// something a sentence. The keep cases matter more than the cut cases here —
// leaving a stumble in is far better than eating real speech.
let CORRECTIONS = 0
console.log('\n── findSelfCorrectionDrops (word-level restarts) ────────────────')
{
  const SELF_CORRECTION_CASES: Array<{ text: string; cut: string }> = [
    { text: 'for higher, for high achievers',        cut: 'for higher,' },
    { text: 'this is import, this is important work', cut: 'this is import,' },
    { text: 'the nerv, the nervous system',          cut: 'the nerv,' },
    // Ordinary speech that merely repeats a word — must survive untouched.
    { text: 'for you and for me',                    cut: '' },
    { text: 'the high road and the higher ground',   cut: '' },
    { text: 'she works harder and harder every day', cut: '' },
    { text: 'it is not about work it is about rest', cut: '' },
    { text: 'more and more people feel this',        cut: '' },
    { text: 'a little bit at a time',                cut: '' },
  ]
  for (const { text, cut } of SELF_CORRECTION_CASES) {
    const words = w(text)
    const got = findSelfCorrectionDrops(words, new Set()).map(i => words[i].text).join(' ')
    const ok = got === cut
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${cut ? 'cuts' : 'keeps '} "${text}"`)
    console.log(`      -> ${got || '(nothing)'}${ok ? '' : `   EXPECTED ${cut || '(nothing)'}`}`)
  }
  CORRECTIONS = SELF_CORRECTION_CASES.length
}

// ── buildRetakeWindows ───────────────────────────────────────────────────────
// The LLM retake pass used to slice its prompt at 8,000 characters, leaving
// everything past ~2 minutes of speech with no LLM coverage. It now reads the
// whole transcript in overlapping windows; this pins the boundary math —
// every word covered, windows overlap so a retake straddling a boundary is
// seen whole by at least one window, and a short transcript stays one call.
let WINDOWS = 0
console.log('\n── buildRetakeWindows (full-transcript coverage) ────────────────')
{
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    console.log(`      ${detail}`)
    WINDOWS++
  }

  const short = buildRetakeWindows(300)
  check('a short transcript stays a single window',
    short.length === 1 && short[0][0] === 0 && short[0][1] === 300,
    `300 words -> ${JSON.stringify(short)}`)

  const long = buildRetakeWindows(1200)
  const coversAll = long[0][0] === 0 && long[long.length - 1][1] === 1200 &&
    long.every(([a, b], i) => i === 0 || a < long[i - 1][1])
  check('a long transcript is fully covered, first word to last',
    coversAll, `1200 words -> ${JSON.stringify(long)}`)

  // A retake spans up to ~14 words plus its restart; the overlap must be wide
  // enough that one straddling a boundary is whole inside SOME window.
  const overlapOk = long.every(([a], i) => i === 0 || long[i - 1][1] - a >= 30)
  check('adjacent windows overlap enough to see a straddling retake whole',
    overlapOk, `overlaps: ${long.slice(1).map(([a], i) => long[i][1] - a).join(', ')}`)
}

// ── sanitizeWordTimings + tail integrity ─────────────────────────────────────
// Found by the cut harness on a real client clip: Scribe stretched the final
// "bio." across 1.1s of trailing silence (122.58-123.98, silence from 122.89).
// The cut was judged with clamped timings but the caption remap read RAW ones,
// so the word's raw midpoint landed inside the carved silence and the last
// word of the CTA vanished from the captions while the audio kept it.
let TAIL = 0
console.log('\n── sanitizeWordTimings (stretched tokens, tail integrity) ───────')
// Async block (planKeepSegments is async even when it makes no LLM calls);
// the tally waits for it. tsx compiles this file as CJS, so no top-level await.
;(async () => {
  const check = (name: string, ok: boolean, detail: string) => {
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    console.log(`      ${detail}`)
    TAIL++
  }

  // Silence beginning inside the word and swallowing its tail clamps the word
  // to the silence start — the precise signal.
  const stretched = sanitizeWordTimings(
    timed('my@9.4-9.6', 'bio.@10.0-11.4'),
    [[10.3, 13.0]],
  )
  check('silence swallowing a word tail clamps the word to the silence start',
    Math.abs(stretched[1].end - 10.3) < 0.001,
    `"bio." 10.0-11.4 with silence from 10.3 -> end ${stretched[1].end.toFixed(2)}`)

  // No silence detected there: the blunt 1.2s -> 0.9s fallback still applies.
  const blunt = sanitizeWordTimings(timed('fact,@5.0-8.7'))
  check('a stretched token with no silence data falls back to the 0.9s clamp',
    Math.abs(blunt[0].end - 5.9) < 0.001,
    `"fact," 5.0-8.7 -> end ${blunt[0].end.toFixed(2)}`)

  // Normal words pass through untouched (same object, no copy).
  const normal = sanitizeWordTimings(timed('link@1.0-1.3', 'in@1.35-1.45'), [[2.0, 3.0]])
  check('normal words are untouched',
    normal[0].end === 1.3 && normal[1].end === 1.45,
    'no clamp applied')

  // THE OBSERVED BUG, end to end: cut then remap. Under 12 words, so
  // planKeepSegments makes no LLM calls — this is fully deterministic. The
  // final word must survive into the edited words (= the captions).
  const cta = timed(
    'book@7.0-7.2', 'a@7.25-7.3', 'call@7.35-7.6', 'through@7.65-7.9',
    'the@7.95-8.0', 'link@8.05-8.3', 'in@8.35-8.4', 'my@8.45-8.6', 'bio.@8.7-10.1',
  )
  const silences: Array<[number, number]> = [[9.0, 12.0]]
  const segs = await planKeepSegments(cta, 12.0, { silences })
  const edited = remapToEditedTimeline(sanitizeWordTimings(cta, silences), segs)
  const lastWord = edited[edited.length - 1]?.text
  check('the final word of a CTA survives the trailing-silence carve into the captions',
    lastWord === 'bio.',
    `edited words end with "${lastWord}" (segments ${segs.map(s => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(', ')})`)

  const total = CASES.length + STUTTER.length + REPEATS.length + CORRECTIONS + WINDOWS + TAIL
  console.log(`\n${total - failed}/${total} passed`)
  if (failed) process.exit(1)
})().catch(e => { console.error(e); process.exit(1) })
