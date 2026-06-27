# Captions and Transcript

Everything needed to wire word-level transcripts into caption compositions.

## Transcript Format

`transcript.json` is a flat array of word objects. No nested segments, no wrapper.

```json
[
  { "id": "w0", "text": "Hello", "start": 0.0, "end": 0.5 },
  { "id": "w1", "text": "world.", "start": 0.6, "end": 1.2 }
]
```

Field | Notes
`text` | The spoken word (may include punctuation)
`start` | Seconds from clip start when word begins
`end` | Seconds when word ends
`id` | Stable reference (`w0`, `w1`, ...) added by `hyperframes transcribe` - optional for hand-authored transcripts

Generate from audio:
```bash
npx hyperframes transcribe narration.wav -d . --json --model small.en
```

## Transcript Quality Check (Mandatory)

Before authoring captions, read the transcript and check:

- Music tokens (`♪`, `♫`, `?`) - if more than 20% of entries, transcription failed
- Obvious garbled words ("Do a chin", "Get so gay") from misheard speech
- Very short word spans (`end - start < 0.05`) - unreliable alignment
- Final word's `end` past actual media duration - clamp it

If quality fails, retry with `--model medium.en`, then fall back to external API.

Cleaning a raw transcript before use:
```js
const words = raw.filter(w => {
  if (!w.text || w.text.trim().length === 0) return false;
  if (/^[♪?]+$/.test(w.text)) return false;
  if (/^(huh|uh|um|ah|oh)$/i.test(w.text) && w.end - w.start < 0.1) return false;
  return true;
});
```

## Word Grouping

Break transcript words into groups of 2-6. Break on terminal punctuation, pauses of 150ms+, or max count. Group sizes: high-energy 2-3 words, conversational 3-5, calm/storytelling 4-6.

```js
const GROUPS = [
  { text: "Hello world", words: [{ text: "Hello", start: 0.0, end: 0.5 }, { text: "world", start: 0.6, end: 1.2 }], start: 0.0, end: 1.2 },
];
```

## Per-Word Karaoke Animation Pattern

The baseline for all caption styles is karaoke: each word activates as it is spoken.

For each group, build three GSAP phases: enter, karaoke word-by-word, exit.

```js
const GROUPS = [...]; // from transcript

GROUPS.forEach(function(group, gi) {
  const groupEl = document.getElementById("cg-" + gi);
  if (!groupEl) return;

  // ENTER: group container fades in at group.start
  tl.fromTo(groupEl,
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.2, ease: "power2.out" },
    group.start
  );

  // KARAOKE: activate each word as it is spoken
  group.words.forEach(function(word, wi) {
    const wordEl = groupEl.querySelector('[data-word="' + wi + '"]');
    if (!wordEl) return;

    // Activate (word is now being spoken)
    tl.to(wordEl, {
      color: "#ffeb3b",     // accent color
      scale: 1.08,
      duration: 0.06,
      ease: "power2.out"
    }, word.start);

    // Deactivate when word ends (or next word starts)
    const deactivateAt = gi < group.words.length - 1
      ? group.words[wi + 1].start
      : group.end;

    tl.to(wordEl, {
      color: "#ffffff",
      scale: 1.0,
      duration: 0.1,
      ease: "power2.in"
    }, deactivateAt - 0.06);
  });

  // EXIT ANIMATION + HARD KILL (see Hard Kill section below)
  tl.to(groupEl,
    { opacity: 0, scale: 0.95, duration: 0.12, ease: "power2.in" },
    group.end - 0.12
  );
  tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
});
```

HTML for the group elements:
```html
<div id="cg-0" class="caption-group" style="visibility:hidden; opacity:0;">
  <span class="word" data-word="0">Hello</span>
  <span class="word" data-word="1">world.</span>
</div>
```

Initial state must be `visibility:hidden; opacity:0`. The GSAP `tl.set` at `group.start` will show it, or the `fromTo` enter tween handles visibility.

## fitTextFontSize - Overflow Prevention

Always compute font size to fit the available width. Never hard-code a size that might overflow for long groups.

```js
const result = window.__hyperframes.fitTextFontSize(group.text.toUpperCase(), {
  fontFamily: "Outfit",
  fontWeight: 900,
  maxWidth: 900,       // 900 for portrait 1080w (leave margins)
  baseFontSize: 78,    // start here and shrink down
  minFontSize: 42,     // never go below this
  step: 2,
  fontWeight: 900
});
groupEl.style.fontSize = result.fontSize + "px";
```

Landscape maxWidth: 1600 (for 1920w canvas)
Portrait maxWidth: 900 (for 1080w canvas)

When per-word styling uses `scale > 1.0`, reduce maxWidth to leave headroom:
```js
maxWidth: 900 / maxScale  // e.g. 900 / 1.15 = 783
```

CSS safety nets on caption container:
```css
.caption-group {
  position: absolute;
  width: 1000px;        /* wider than text to allow overflow visible */
  left: 40px;
  bottom: 160px;
  overflow: visible;    /* NOT hidden - clips glow/scale effects */
  text-align: center;
}
```

Do NOT use `left: 50%; transform: translateX(-50%)` on the caption container - causes clipping at composition edges. Use absolute left positioning instead.

## Hard Kill Guarantee

Every caption group MUST have a hard `tl.set` kill at `group.end`. This is non-negotiable.

```js
// Fade out
tl.to(groupEl, { opacity: 0, scale: 0.95, duration: 0.12, ease: "power2.in" }, group.end - 0.12);
// Hard kill - tl.set is instant (not a tween), safe for visibility
tl.set(groupEl, { opacity: 0, visibility: "hidden" }, group.end);
```

Only one group visible at a time. If the next group starts before the current ends, the current must be killed first.

## Self-Lint

After building timeline, before `window.__timelines[id] = tl`, seek each group to `group.end + 0.01` and warn if `opacity !== "0"` or `visibility !== "hidden"`. Then `tl.seek(0)`.

## Overlap Prevention

Two caption groups must never overlap in both time AND screen region simultaneously. Options:

1. **Handoff** (default): set `group.end` of current group exactly at the `start` of next group
2. **Spatial separation**: place groups in different vertical bands so they can coexist
3. **Allow overlap deliberately**: add `"allow_overlap": true` to silence the validator warning

Group window must envelop all its words:
- `group.start <= min(word.start)` across all words
- `group.end >= max(word.end)` across all words

If `group.start` is after a word's start, that word fires silently late - this is a common 800ms sync bug.

## Caption Positioning

Portrait (1080x1920):
- Lower third: `bottom: 160px` from bottom
- Above face (BOTTOM mode): `bottom: 980px`
- Never cover the face

Landscape (1920x1080):
- Lower third: `bottom: 80px` to `bottom: 120px`

Use `position: absolute`, never `position: relative` for caption containers.

## Caption Composition Root Attributes

When captions are their own sub-composition, mark the root:

```html
<div
  id="root"
  data-composition-id="captions"
  data-timeline-role="captions"
  data-caption-root="true"
  data-width="1080"
  data-height="1920"
>
```

## Pre-Built Caption Components vs Hand-Authoring

Before building from scratch, check the registry - 15 caption components are ready:

```bash
npx hyperframes catalog --tag caption-style
npx hyperframes add caption-highlight
```

Wire as a sub-composition:
```html
<div
  data-composition-id="captions"
  data-composition-src="compositions/components/caption-highlight.html"
  data-start="0"
  data-duration="90"
  data-track-index="3"
  data-width="1080"
  data-height="1920"
></div>
```

Caption components have transparent backgrounds - they are pure overlays. If video background is bright/busy, add a semi-transparent contrast layer in the host composition beneath the caption sub-comp, not inside the component.

## Timing Constraint

Word timings must match `transcript.json` within 80ms. Drift beyond that breaks the illusion of captions matching speech.

Each caption group: minimum 0.5s on screen (shorter = unreadable).

Never pack multiple transcript words into one tween entry with shared start/end - the second word fires at the first word's timestamp. Use separate entries.

## Fonts for Rendering

The renderer auto-embeds a built-in mapped set (Inter, Roboto, Montserrat, etc.). For any other font, supply an `@font-face` with a `.woff2` bundled with the project:

```css
@font-face {
  font-family: "Outfit";
  src: url("../assets/fonts/Outfit-900.woff2") format("woff2");
  font-weight: 900;
  font-display: block;
}
```

`font-display: block` is required - prevents flash of unstyled text during render.

Do not assume a font you see locally will be available in headless Chrome. Ship the woff2.

## Audio-Reactive Captions (for Music Content)

Generate frequency data: `python3 skills/hyperframes-creative/scripts/extract-audio-data.py audio.mp3 --fps 30 --bands 8 -o audio-data.json`

Inline JSON into composition, then per group: read `peakBass = max(frames[startFrame..endFrame].bands[0])`, tween `scale: 1 + peakBass * 0.05` at `group.start`, reset scale at `group.end - 0.15`. Keep modulation subtle (3-6% scale max). This shapes animation at build time, fully deterministic.
