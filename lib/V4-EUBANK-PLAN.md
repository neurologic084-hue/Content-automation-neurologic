# V4 "Eubank" — premium concept-driven edit

Reverse-engineered from `Alex Eubank Sample.mp4` (2:06, 5 overlapping Gemini
passes, July 2026). This doc is the style contract for `our-v4`: what the
reference does, and which part of the engine implements each device.

## The reference's recurring grammar

1. **Concept visualization (~70-80% of key claims)** — when the speaker names a
   concept, the edit SHOWS it: a spoken list builds as a Notes-app checklist
   (yellow checkmarks popping per item), a comparison becomes an on-screen
   equation ("Format > Concept"), a do-this-not-that becomes a cross-out
   ("~~Copy Content~~ / **Copy Structure**"), a framework becomes floating
   translucent cards over the blurred speaker ("[ Winner ]" → "Effective
   Concept" → "Effective Hook"), a key phrase flashes as clean white text the
   moment it's said.
2. **Captions: clean, semantic, adaptive** — geometric sans (Inter-like),
   sentence case, white on subtle shadow, phrase pages of 3-5 words building
   word by word. Emphasis words are BOLD and color-coded by meaning: green for
   positive/wins, red for negative/warnings, gold for neutral emphasis. Short
   punchlines ("every single time.") render big and centered with a spring pop.
   Position adapts to the frame (lower-third default, upper-third over busy
   B-roll, occasional left-aligned block).
3. **The 2.5-second rule** — never more than ~2.5s without a cut, punch-in, or
   insert. Punch-ins jump 1.15-1.25x on key transitions (multi-cam feel).
4. **Constant drift + handheld noise** — no static frame ever: slow continuous
   zoom on every talking-head shot plus a tiny organic position/rotation drift.
5. **Hard cuts by default** — transitions (flash/zoom-through + motion blur)
   are saved for major structural shifts only.
6. **Tactile sound design** — every graphic event has a literal sound: pop on
   card entrances, ding per checkmark, metallic shing on the cross-out, deep
   boom on framework cards, whoosh on transitions/punch-ins. Sounds are
   peak-aligned to the motion.
7. **Premium grade** — warm high-contrast footage, deep shadows, vignette,
   film grain; graphics sit on either a dimmed/blurred frame or a clean light
   grid canvas.

## Engine mapping

| Device | Where |
| --- | --- |
| Concept graphics planner (notes/equation/crossout/keyword/cards) | `lib/eubank-graphics.ts` (LLM plan, word-timing anchored, face-aware placement) |
| Graphic renderers | `remotion/src/compositions/ShortEdit.tsx` (Eubank pack) |
| Semantic caption colors + punch pages + adaptive position | `planEubankCaptions` in `lib/edit-plan.ts` + `EubankCaptionPage` renderer |
| Punch-in framing jumps | existing `pace: 'punchy'` segment splitting; eubank zoom ranges in `SegmentClip` |
| Handheld drift | `handheld` prop on `ShortEdit`, set by the v4 render kit |
| Tactile SFX | `planEubankSfxCues` + new `shing` category in `lib/sound-effects.ts` |
| Grade/grain/vignette | existing `grade: 'cinematic'` |
| Identity | `REMOTION_IDENTITIES['our-v4']` in `lib/render-kit.ts` |

Design rule carried over from the rest of the engine: the model finds the
moments and quotes the copy; the CODE owns all timing validation, styling,
caps, and placement. Every graphic is anchored to the moment its words are
actually spoken, and everything degrades gracefully (a failed plan = a clean
edit with no graphics, never a broken render).

Caps per render: max 6 concept graphics, max 1 notes card, max 1 cross-out
(the full light-canvas method scene: grid paper, icon with long soft shadows,
gold script method name, strike → green-accented replacement), max 1
framework-cards moment (diagonal glowing labels + frosted "[ Winner ]" card),
max 2 quote panels; graphics never overlap each other, B-roll covers, or the
first 2s hook.
