# HyperFrames Render Contract

Non-negotiable rules. Violating any of these breaks the render or produces wrong output.

## Root Element Requirements

Every composition needs a root div with ALL four attributes:

```html
<div
  id="root"
  data-composition-id="my-video"
  data-width="1920"
  data-height="1080"
  data-duration="30"
>
```

Common sizes: landscape `1920x1080`, portrait `1080x1920`.

## GSAP Timeline Registration

Every composition must register a paused GSAP timeline keyed to its `data-composition-id`:

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
// add tweens...
window.__timelines["my-video"] = tl; // key MUST match data-composition-id exactly
```

Rules:
- Timeline key must exactly match `data-composition-id` on the root element. Mismatch = static frames.
- Always `{ paused: true }`. Never call `tl.play()`.
- Build the timeline synchronously at page load. No `async`, `setTimeout`, `Promise`, event handlers.
- Timeline duration = composition duration. If timeline ends at 8s but video is 120s, the render stops at 8s. Fix: `tl.set({}, {}, 120)` to extend without affecting elements.
- No `repeat: -1`. Use `Math.max(0, Math.floor(duration / cycleDuration) - 1)` for loops.

## Clip Requirements

All timed visible elements (img, div, section) must have `class="clip"`:

```html
<h1 id="title" class="clip" data-start="2" data-duration="5" data-track-index="1">text</h1>
```

Without `class="clip"`: the element stays visible the entire video ignoring timing.

Video elements do NOT use `class="clip"` (framework manages them directly).

`data-duration` is:
- Required for `<img>` and timed `<div>`
- Optional for `<video>` and `<audio>` (defaults to remaining source duration from `data-media-start`)
- Not used on sub-composition host divs (duration from internal GSAP timeline)

## Track Index Rules

`data-track-index` is temporal, not visual. Two clips on the same track must not overlap in time. Use CSS `z-index` for layering, not track index. Audio should use a high track (e.g. `10`) to avoid lint collisions with visual tracks.

## Determinism Forbidden Patterns

These break reproducibility and are banned:

- `Date.now()` or `performance.now()` in visual state
- Unseeded `Math.random()` - use a seeded PRNG if you need randomness
- Render-time network fetches for assets
- `requestAnimationFrame`, `setTimeout`, `setInterval` for animation
- `video.play()`, `video.pause()`, `audio.currentTime =` in scripts (framework owns media)
- `repeat: -1` infinite loops
- Animating `display` or `visibility` properties directly
- `getBoundingClientRect()` at tween time (DOM measurements desync in parallel seeks)

## What NOT to Animate with GSAP

Never animate `width`, `height`, `top`, or `left` directly on a `<video>` element - stops Chrome from rendering frames. Wrap the video in a div and animate the wrapper.

Never animate the same property on the same element from multiple timelines simultaneously.

Use only GSAP transform aliases for motion: `x`, `y`, `scale`, `rotation`, `opacity`, `color`, `backgroundColor`, `borderRadius`. Never animate layout properties for motion.

## Sub-Composition Pitfalls

Three silent failures that pass lint but break the render:

1. `<style>` or `<script>` in `<head>` instead of inside `<template>` - runtime discards head entirely
2. Host `data-composition-id` does not match the template's internal `data-composition-id` - animations never play, 45s timeout per scene
3. Root styled by a class (`.frame {}`) instead of `#root {}` - CSS scoper can't match it, all styles drop

Sub-composition file shape:
```html
<body>
  <template>
    <style> #root { ... } </style>
    <div id="root" data-composition-id="scene-name" data-width="1920" data-height="1080">
      <!-- content -->
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["scene-name"] = tl;
    </script>
  </template>
</body>
```

Do NOT manually `master.add(child)` sub-composition timelines into the parent. Framework drives them independently. Double-nesting causes double-seeks.

## Media in Sub-Compositions

Video and audio elements must be direct children of the host root (`index.html`), never inside a sub-comp `<template>`. The sub-comp handles the visual frame/shell; the host places media over it. Animate media via the main timeline at global time (scene-local time + slot's `data-start`).

## Relative Timing Rules

`data-start` accepts a clip id: `data-start="intro"` means "start when intro ends". Offsets: `data-start="intro + 2"` or `data-start="intro - 0.5"`.

Constraints:
- References resolve inside the same composition only (no cross-file references)
- Referenced clip must have a known duration
- No circular references (A -> B -> A rejected)
- Overlapping clips must be on different tracks

## Pre-Render Validation

```bash
npx hyperframes lint      # static HTML structure checks (catches missing class="clip", track overlaps, etc.)
npx hyperframes validate  # runtime check in headless Chrome (JS errors, missing assets)
npx hyperframes snapshot my-video --at 5,15,25  # visual spot check before full render
```

Both lint and validate must pass before render.

## Caption Composition Marker

Caption compositions should declare their role on the root:

```html
<div
  data-composition-id="captions"
  data-timeline-role="captions"
  data-caption-root="true"
  ...
>
```

## Body Font Family Rule

`font-family` on `html, body` must list concrete font names, not CSS variables. The renderer's static analyzer does not expand `var(--font-family)` when resolving fonts:

```css
/* CORRECT */
html, body { font-family: "Inter", "Caveat", ui-sans-serif, sans-serif; }

/* BROKEN - triggers font_family_without_font_face lint, falls back to generic */
html, body { font-family: var(--font-family); }
```

Cards and sub-components may still use `var(--font-family)` internally.
