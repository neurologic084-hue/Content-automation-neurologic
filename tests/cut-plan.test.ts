// Regression test for the cut planner's retake validator (lib/edit-plan.ts).
//
// The bug this pins down: Haiku marked "You should," in
//   "...You should hear some music. [You should,] uh, see some captions..."
// as a false start on 5/5 runs, deleting two real words. It is the LATER
// occurrence, and the prompt explicitly says to keep the final take.
//
// isRestartedBy() enforces the precondition the model states but does not obey:
// an abandoned attempt is a near-duplicate of the speech that FOLLOWS it.
//
//   npm run test:cut
//
// No network, no API keys, no spend — pure function over synthetic transcripts.

import { isRestartedBy } from '../lib/edit-plan'
import type { WordTimestamp } from '../lib/caption-renderer'

// Build word timings from a sentence; timings are irrelevant to isRestartedBy
// but keep the type honest.
function w(text: string): WordTimestamp[] {
  return text.split(/\s+/).map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }))
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
for (const c of CASES) {
  const got = isRestartedBy(c.words, c.span[0], c.span[1])
  const ok = got === c.expect
  if (!ok) failed++
  const span = c.words.slice(c.span[0], c.span[1] + 1).map(x => x.text).join(' ')
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      span "${span}" -> ${got ? 'drop' : 'keep'} (expected ${c.expect ? 'drop' : 'keep'})`)
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`)
if (failed) process.exit(1)
