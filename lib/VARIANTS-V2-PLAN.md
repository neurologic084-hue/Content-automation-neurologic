# Variants V2 — Content-Aware Submagic Settings (Plan)

Status: proposal, not wired in. For Jun + Daniel to mark up before we build.

## The idea in one line

Watch the video once with Gemini, then use what it learned to drive smarter,
more controlled Submagic settings per variant.

## Why we're changing it

Today the per-variant settings (v1/v2/v3) come from a vague English "directive"
handed to a fast **text** model that has never seen the footage — it only reads
the written hook/CTA + transcript. Two problems:

1. **Not grounded in the actual video.** It guesses B-roll %, pace, zooms without
   knowing if there's anything on screen worth cutting to, or how the person is
   framed, or how emotional the topic is.
2. **Creative identity drifts.** Because the model picks *everything* from a loose
   directive, "Bold & Punchy" isn't reliably punchy run-to-run.

## The principle (from Daniel's framing)

Split every editing lever into two buckets:

- **Quality baseline → LOCKED.** Things where there's one correct answer and no
  viewer would ever want it worse. Clean audio, cut bad takes, trim dead air,
  B-roll on. Same on every variant, always.
- **Creative identity → AI-DRIVEN.** Things where there's no "correct," only taste,
  and where *different* is the whole point. Caption style, zooms, pace feel, hook
  titles. This is the diversity Daniel picks from.

Rule of thumb: **if varying it could only make the video worse, lock it. If
varying it just makes the video different, let AI play.**

## Step 1 — One Gemini "content profile" pass per video

Run the compressed video (already produced in `getLocalCompressedSource`) through
`lib/gemini.ts` ONCE, cached on the job, shared by all variants. Every field maps
to a real downstream decision:

| Field | Values | Drives |
|---|---|---|
| speechPace | slow / measured / fast | pace sanity |
| energy | low / medium / high | pace, zooms |
| sensitivity | neutral / personal / medical_emotional | **pace + effects guardrail** |
| format | story / educational / list / sales | context |
| brollableRichness | none / some / rich | **B-roll % (pulls it down)** |
| hasNumbers | boolean | hook titles, stat overlays |
| keyNumbers | e.g. ["3 steps", "50% off"] | hook titles, stat overlays |
| emphasisPhrases | 3-5 punched lines | caption highlight, hook text |
| hookStrength | weak / medium / strong | whether to show a hook title |
| suggestedHookTitle | short, <=6 words | hook title text |
| captionMood | calm / clean / energetic | nudges caption template pick |
| faceFraming | tight / wide | **zooms look bad on tight framing** |

Runs once, right after compression, before any variant fires.

## Step 2 — The locked floor

Extend the existing `SUBMAGIC_ALWAYS_ON`. Never AI-touched, identical everywhere:

- removeBadTakes: true (cut flubs)
- cleanAudio: true (audio enhancement)
- magicBrolls: true (B-roll ON is baseline — the % is NOT, see below)
- silence trimming always on; only its aggressiveness varies per variant

## Step 3 — Each variant gets a fixed personality + adaptive ranges

Locked per variant (the diversity Daniel picks from):
- caption lane (minimal / clean / bold)
- zooms on/off
- intended pace (natural / fast / extra-fast)

Adaptive (content pulls it, never invents):
- B-roll % — variant sets a CEILING per richness; Gemini can only lower it.

| Variant | Caption lane | Zooms | Intended pace | B-roll ceiling (none/some/rich) | Music |
|---|---|---|---|---|---|
| v1 Calm & Clean | minimal | off | natural | 0 / 8 / 12 | no |
| v2 Balanced Energy | clean | on | fast | 6 / 14 / 20 | yes |
| v3 Bold & Punchy | bold | on | extra-fast | 8 / 18 / 26 | yes |

(v4/v5 reuse the same profile + resolver, then add the Remotion motion-graphics
layer on top. v6 stays a Submagic-free test.)

## The two safety rails (the smart part)

Even with fixed personalities, the content profile overrides when a setting would
look wrong for THIS video:

1. **Sensitivity caps pace.** medical_emotional forces pace to natural even on the
   "punchy" variant; personal downgrades extra-fast to fast.
2. **Richness + framing gate effects.** B-roll % never exceeds what the footage
   earns (no random stock clips on a static talking head); zooms turn off when the
   framing is already tight.

## Step 4 — The resolver

A near-deterministic function `resolveSubmagicSettings(spec, profile)` replaces most
of `deriveSmartSubmagicSettings`:
- start from `SUBMAGIC_ALWAYS_ON`
- apply the variant's locked knobs
- pick B-roll % from the ceiling table using `brollableRichness`
- apply the two guardrails (sensitivity → pace, richness/framing → effects)
- caption template = variant lane resolved against the discovered Submagic pool,
  nudged by `captionMood` (upgrade of `pickPremiumTemplates`, cached, one-time
  classification — not a per-render LLM call)
- hook title text pulled straight from `suggestedHookTitle`

Net: render path = one Gemini video pass + pure lookups. No per-variant text-LLM
guessing.

## Worked examples

**Video A — punchy sales, product on screen, "50% off this week", wide framing**
(fast / neutral / rich / hasNumbers / wide / energetic)

| | v1 Calm | v2 Balanced | v3 Bold |
|---|---|---|---|
| template | minimal | clean | bold |
| B-roll % | 12 | 20 | 26 |
| zooms | off | on | on |
| pace | natural | fast | extra-fast |
| hook title | off | "50% off this week" | "50% off this week" |

**Video B — personal emotional story, static tight framing, nothing to illustrate**
(medical_emotional / none / tight / calm)

| | v1 Calm | v2 Balanced | v3 Bold |
|---|---|---|---|
| B-roll % | 0 | 6 | 8 |
| zooms | off | off (tight framing) | off (tight framing) |
| pace | natural | natural (sensitivity cap) | natural (sensitivity cap) |

Point of Video B: even "Bold & Punchy" behaves itself — keeps its caption identity
but drops the zooms/stock-clips that'd look wrong on a vulnerable story.

## v4 / v5 — the premium + motion-graphics variants

These have TWO layers, and the content profile improves both.

**Layer 1 — their Submagic pass.** Same as v1/v2/v3. Today v4/v5 hardcode zooms
(v4 off, v5 on) and pull templates from `pickPremiumTemplates`. Under V2 the same
resolver + guardrails apply here (framing gates zooms, richness caps B-roll,
sensitivity caps pace). No new mechanism, just reuse.

**Layer 2 — the Remotion motion graphics.** This is the bigger unlock and it's
100% authored by us, so grounding it is where quality jumps most.

### What's built vs what this plan adds

BUILT (works today):
- Remotion overlay compositions (intro_card, lower_third, keyword_callout, stat,
  list, outro_card) in `remotion/` — they render fine.
- The pipeline: plan graphics -> render transparent overlay -> FFmpeg composite.
- Two visual treatments: `minimal` (v4) and `bold` (v5).
- `lib/gemini.ts` client — but UNUSED, nothing imports it yet.

NOT built (this plan):
- Any video understanding feeding the graphics. `lib/graphics-plan.ts` is a
  BLIND text model today — reads transcript + hook/CTA and guesses; never sees
  the footage; Gemini is nowhere in that path.
- So graphics CONTENT is not currently driven by Gemini's read of the video.

Note: v4 and v5 already differ from each other today, but only via style
(minimal/bold), Submagic template, and zoom. The graphics CONTENT (which callouts,
what stats, what text) is planned the same blind way for both.

### How the content profile upgrades `planMotionGraphics`

- **Stats** — `keyNumbers`/`hasNumbers` give exact figures; skip stat cards
  entirely when there are none, instead of straining to manufacture one.
- **Callouts** — `emphasisPhrases` are the actually-punched lines; with the word
  timestamps we already have, callouts land exactly when the line is said.
- **Graphic types** — `format` drives them: list -> list graphic; story -> fewer,
  atmospheric; educational -> callouts/definitions.
- **Intro/outro text** — grounded in `suggestedHookTitle` (what's really said on
  camera), not just the written hook.

### The two things only a video-watcher can provide

- **Placement** — `faceFraming: tight/wide` tells the overlay where the person is,
  so lower-thirds/callouts don't cover the face. Impossible from a transcript.
- **Density/intensity** — `sensitivity` + `energy` gate how busy the graphics get:
  fewer/calmer on an emotional story (maps to v4 minimal), more/punchier on a
  high-energy sell (maps to v5 bold).

### Cleanup: one analysis pass

Today transcription happens in multiple places (v1-v3 smart settings, and again
inside `addMotionGraphics` for v4/v5). A Gemini pass would be a third look. Fold
it into ONE analysis pass per video that yields transcript + word timings +
content profile, cached on the job, read by all six variants. Cheaper, and no
risk of layers disagreeing about what was said.

## Open questions before building

1. **Ceiling numbers** (0-26 to match current clamp) — guesses. Daniel eyeballing a
   few real renders will tune fast.
2. **Number of caption lanes** — 3 (minimal/clean/bold) enough, or want more
   variants for a wider spread to choose from?

## Build order

- [x] 1. `analyzeVideoContent()` in `lib/video-analysis.ts` (Gemini pass + strict
      schema + graceful fallback). Cached on the job via the new `content_profile`
      column; `ensureContentProfile()` (motion-renderer) runs it once at
      `prepareJobSource` and reuses the ElevenLabs `transcript` to ground text.
- [x] 2. Baseline: `removeBadTakes` / `cleanAudio` stay in `SUBMAGIC_ALWAYS_ON`;
      B-roll and zooms became per-variant/guardrail decisions in the resolver
      (better than forcing them on globally).
- [x] 3. `VariantSpec` + `VARIANT_SPECS` (v1-v5) in `lib/variant-specs.ts`.
- [x] 4. `resolveSubmagicSettings()` with the three guardrails. Wired into the
      v1-v3 route path (legacy `deriveSmartSubmagicSettings` kept only as a
      no-spec fallback) AND the v4/v5 Submagic pass in `renderSmartCinematic`.
- [x] 5. `resolveCaptionTemplate()` cached caption-lane classifier (video-pipeline).
- [x] 6. `planMotionGraphics` now takes the content profile — real numbers gate
      stat cards, emphasis phrases anchor callouts, format picks graphic types,
      tight framing keeps overlays minimal, sensitivity/energy scale density.
- [ ] 7. Tune numbers + graphics density with Daniel on real footage.

### Not yet verified end-to-end
Needs a live job with `GEMINI_API_KEY` set (analysis is best-effort — falls back
to a neutral profile if the key is missing or the call fails, so nothing breaks
without it). Model defaults to `gemini-3.5-flash`, overridable via `GEMINI_MODEL`.
Pre-existing branch issues unrelated to this work (`@aws-sdk/client-s3` not
installed, a `catalog.ts` type error) will block `next build` until resolved.
