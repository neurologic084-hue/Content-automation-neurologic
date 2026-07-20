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

import { isRestartedBy, findStutterDrops, findRepeatedTakes } from '../lib/edit-plan'
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

const total = CASES.length + STUTTER.length + REPEATS.length
console.log(`\n${total - failed}/${total} passed`)
if (failed) process.exit(1)
