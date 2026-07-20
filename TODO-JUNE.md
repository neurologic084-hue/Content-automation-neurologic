# June's to-do — start here

Written 2026-07-21 by Daniel. This is the current priority list; work it top to
bottom. Everything below is scoped to **the six output variants**, and most of
the open work is on **v1–v3** (the Submagic path).

Context you need before touching anything: a large amount changed on
2026-07-20. Read **"What changed under you"** at the bottom first — several of
these tasks only make sense against that history, and one of them reverses a
decision made that day.

---

## 1. Custom B-roll on v1–v3

**Status: deliberately removed on 2026-07-20. Daniel now wants it back.**

Read this before re-adding it, because it was removed for real reasons and
re-adding it naively will reproduce the bugs:

- Her clips were time-matched against the **uncut** source, but Submagic
  receives the **pre-cut** one. When the two disagreed, a cutaway landed past
  the end of the video and Submagic rejected the **entire submission** — that
  is what made v1–v3 fail on real footage, not a Submagic problem.
- Registering each clip with Submagic (`createSubmagicUserMedia`) plus hosting
  them was slow enough to contribute to the old 300s timeout.
- `'both'` silently collapsed to `'custom'` on this path — stock and her clips
  never actually mixed, so the Smart setting did nothing here.

`createSubmagicUserMedia` and `SubmagicJobOptions.items` were **deleted**, not
left dormant — check the 2026-07-20 history to recover them.

**What "working" has to mean:**

- placements are timed against **whatever file Submagic actually receives**
  (today that is `source-cut-clean.mp4`), never a different cut
- `both` genuinely mixes her clips with Submagic's stock, or the UI stops
  offering `both` on v1–v3
- a clip that cannot be placed is skipped **without** taking the submission
  down with it
- the same "only where it fits" rule the Motion Lab uses — no forced placements
  (see `planCustomBrollSlots` in `lib/broll.ts`, and the note about why the
  content-blind top-up was removed)

## 2. Custom B-roll: smart AND cheap

Task 1 is "make it work on v1–v3". This one is the standard it has to meet on
**all six** — because the naive version of task 1 is what made the pipeline
slow and fragile in the first place.

**Smart** means the placement is earned, not filled:

- a clip goes in where its *content* matches what she is saying at that moment,
  judged against the transcript — never on a timer or in upload order. A
  content-blind filler that placed clips by array order was removed on
  2026-07-20; it put an elevator over a line about captions
- **if nothing fits, place nothing.** A low count is a correct answer, not a
  failure to paper over. Daniel's rule verbatim: use them "when they make
  sense, otherwise its fine"
- never over her face in the opening `HOOK_PROTECT_SECONDS` (5s) or over the
  closing call to action (`CTA_PROTECT_SECONDS`, 2.5s)
- stock fills what is genuinely left, and never lands on top of her clips

**Efficient** means the expensive parts happen once, ever:

| Work | Cached as | Keyed by | Scope |
|---|---|---|---|
| Gemini describing a clip | `entry.windows` on the job + `broll-cache/shared/*-windows.json` | Drive file id | **across jobs** |
| Cutting a chosen window | `broll-cache/shared/<key>-d<dur>-<offset>-<len>.mp4` | source + duration + offset | **across jobs** |

So the second job that uses the same Drive folder should download nothing and
call Gemini zero times. Verify that: run two jobs on one folder and confirm the
second logs `reusing N cached window(s)` for every clip.

Things that will quietly undo this — check each before shipping:

- **do not key a cache by anything job-scoped.** A `jobId` in a cache key means
  every job re-does the work and leaves an orphan behind. This exact bug
  existed and was fixed on 2026-07-20
- **do not cut windows from a staged file.** Cuts must come from the original
  source; seeking into an already-cut file lands on the wrong footage. This is
  what produced a clip labelled "a person walks down a sidewalk" that actually
  showed elevator doors
- **do not re-add per-job Submagic media registration.** Hosting and
  registering 12 clips per job was slow enough to help blow the old 300s
  request cap. If v1–v3 need her clips, find a way that does not scale with
  clip count on the request path
- keep the cut-window key wide enough that two different clips cannot collide —
  the old 32-bit hash could, and served one clip's footage for another

Worth measuring while you are in here: how many seconds does B-roll prep add to
a cold job, and to a warm one? If the warm number is not close to zero, the
caching is not doing its job.

## 3. End-to-end flow, no silent failures

Every step that can fail must fail **loudly, with a backup, and with a link**.

Current fallback chains — verify each still holds, and extend where it does not:

| Service | Used for | Falls back to |
|---|---|---|
| ElevenLabs | transcription | OpenRouter Whisper |
| ElevenLabs | sound effects | local ffmpeg synthesis |
| Auphonic | audio cleaning | ElevenLabs isolation → original |
| OpenRouter | all AI | Anthropic direct — **needs `ANTHROPIC_API_KEY` set** |
| Tavily | research | OpenRouter web search |
| Pexels | stock B-roll | Openverse |
| KIE.ai | collage images | skipped, video still fine |
| Replicate | subject cutout | caption renders in front |

Rules to hold to:

- a failure message says **whether a backup saved it** — "this did not stop
  your video" reads very differently from "this one has no backup left"
- every failure that a human can fix carries a link (`failureAction()` in
  `lib/error-explain.ts`)
- **no raw technical output on a card.** ffmpeg's build banner reached a
  client's screen once; there is a guard for that specific case now, but the
  principle is general
- when a variant dies, it must reach `failed` with a reason — never sit on
  `processing` forever

**Submagic still has no backup.** If it is down, v1–v3 cannot render. That is
acceptable (v4–v6 are independent), but the message should say so plainly.

## 4. Cutting quality — the AI cut is sometimes wrong

Daniel's report: the cut is sometimes bad and should not have been made.

Where it lives: `lib/edit-plan.ts` (`planKeepSegments`) is the shared brain —
**both paths use it**, so a fix here reaches all six variants. v1–v3 apply it
via the pre-cut file; v4–v6 apply it in-render.

Known-good, do not regress:
- retake removal keeps the **later** take (she restates when the first attempt
  was bad)
- deliberate repetition must survive — "this is what burnout looks like / what
  anxiety looks like / what trauma looks like" must not collapse to one clause.
  There are tests for exactly this: `npm run test:cut` (23 currently pass)

If you change the cut rules, **bump nothing and rebuild nothing manually** —
a forced retry now re-cuts with current rules automatically
(`refreshPrecutForRetry`). But old jobs keep their existing cut until retried.

## 5. Colour is sometimes weird

Retuned on 2026-07-20 after measuring shipped renders: `smart` had shifted her
skin **−25% blue/red with 16% of face pixels clipping**. It now applies no
colour temperature shift at all and measures ~−5%, the same as applying
nothing.

Both paths must stay in step — they are separate code:
- `lib/color-grade.ts` → ffmpeg grades (v1–v3)
- `remotion/src/compositions/ShortEdit.tsx` → CSS filters (v4–v6)

If Daniel reports colour problems again, **measure before tuning**. Extract
frames from a shipped render and from that job's ungraded
`source-compressed.mp4`, compare mean RGB on the face. The trap: raising
saturation reads as yellow on skin, because blue is skin's weakest channel —
that was the actual cause, not the temperature setting everyone assumed.

## 6. Scripting — no action needed

Daniel considered asking for changes here and concluded it is fine. The jargon
rules landed on 2026-07-20 (measured: 2.3 banned terms per script → 0) and the
sentence-length rules were deliberately **reverted** — long sentences are fine,
jargon is not. Leave it alone unless he raises it again.

## 7. Storage — keep it small

R2 grows and bills automatically, so nothing breaks, but it should not sprawl.

- Settings → section 09 shows usage, with a **Clear working files** button that
  removes per-job intermediates while keeping every finished video
- the shared B-roll cache (`broll-cache/`) is **cross-job** — deleting it makes
  every future job re-download and re-analyse the same clips. Leave it
- there is a full backup at `backup/2026-07-20/` including a database dump.
  Safe to delete once you are confident, it is roughly 8 GB
- `scripts/job-checklist.ts` prints what every job actually has in storage

Also watch the **Docker image**: it hit 11 GB once because `.dockerignore`
missed `public/renders`. It is ~3.4 GB now. If Railway builds start failing,
check image size first.

## 8. Verify all six variants, one at a time

This is the acceptance test for everything above. Do not batch it — run them
individually and actually **watch the output**.

| | engine | check |
|---|---|---|
| v1 | Submagic | captions clear of her face (pool leads with `Iman`), audio clean |
| v2 | Submagic | historically the least reliable — 2 of its 4 runs failed |
| v3 | Submagic | — |
| v4 | Motion Lab | grade natural, B-roll placements sensible |
| v5 | Motion Lab | — |
| v6 | Motion Lab | — |

For each: does it finish, does the audio sound clean, do the cuts make sense,
does the colour look natural, do the captions avoid her face, and is her B-roll
used where it makes sense.

`node --env-file=.env.local --import tsx scripts/job-checklist.ts` shows what
each job already has, so a retry does not redo paid work.

---

## What changed under you (2026-07-20)

The short version, so nothing surprises you:

- **Moved Vercel → Railway.** Renders now run *inside* the app container, so a
  redeploy interrupts anything rendering (it is marked retryable). Deploy when
  idle. The old Vercel URL forwards via `MIGRATED_APP_URL`.
- **The cause of nearly every historical v1–v3 failure:** Vercel killed the
  request at 300s *before Submagic was ever contacted*. All 6 recorded failures
  had no `external_id`. It is a background task now.
- **Submagic is out of the audio chain entirely.** Auphonic is primary; v4–v6
  never touch Submagic. v1–v3 now receive audio we already cleaned
  (`source-cut-clean.mp4`) and Submagic's own cleaner is switched **off** for
  it — that filename is the signal, so old jobs keep their own behaviour.
- **Prep runs once per job** and every step self-skips if already done. Nothing
  is stored to track this — it is derived by checking what exists in storage,
  which is why jobs created before any of this still report correctly.
- **B-roll rule:** use her clips where they fit, never force them. A
  content-blind filler that placed clips by upload order was removed — it put
  an elevator over a line about captions.
- **Not proven:** the Anthropic fallback has never actually run, and v1–v3
  custom B-roll (task 1) is currently absent by design, not broken.
