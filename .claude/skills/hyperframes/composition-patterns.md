# Composition Patterns

Practical patterns for Jessica's talking-head video pipeline.

## Project Structure

```
my-video/
  index.html               <- root orchestrator (thin: slots + audio only)
  DESIGN.md                <- brand tokens
  STORYBOARD.md            <- beat-by-beat plan
  transcript.json          <- word-level timestamps [{ text, start, end }]
  narration.wav            <- TTS audio
  compositions/
    beat-1-hook.html       <- each beat is a sub-composition
    beat-2-body.html
    captions.html          <- caption overlay sub-comp
  assets/
    footage.mp4
    music.mp3
```

## 4-Layer Scaffold for Talking-Head Videos

Typical z-order from back to front:

```
Track 0: ambient-bg       <- full-bleed video/image background (or gradient div)
Track 1: face-wrapper     <- the talking-head video element (host root, NOT in sub-comp)
Track 2: seam-treatment   <- scene overlays, B-roll, lower-thirds (sub-comps)
Track 3+: captions        <- caption overlay (sub-comp or inline)
Track 10: audio           <- music/sfx (high track number, separate from visual)
```

In `index.html`:

```html
<div id="root" data-composition-id="root" data-width="1080" data-height="1920" data-duration="90">

  <!-- LAYER 0: ambient background (not a clip, always visible) -->
  <div id="ambient-bg" style="position:absolute;inset:0;background:#0a0a0a;z-index:0;"></div>

  <!-- LAYER 1: face video (host root child, NOT inside sub-comp template) -->
  <video
    id="face-video"
    src="assets/footage.mp4"
    data-start="0"
    data-duration="90"
    data-track-index="0"
    data-has-audio="true"
    data-volume="1"
    muted
    playsinline
    style="position:absolute; left:0; top:0; width:1080px; height:1920px; object-fit:cover; z-index:1;"
  ></video>

  <!-- LAYER 2: scene overlay (sub-comp) -->
  <div
    id="el-beat1"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"
    data-duration="12"
    data-track-index="1"
    data-width="1080"
    data-height="1920"
    style="position:absolute;inset:0;z-index:2;"
  ></div>

  <!-- LAYER 3: captions (always-on overlay for whole video) -->
  <div
    id="el-captions"
    data-composition-id="captions"
    data-composition-src="compositions/captions.html"
    data-start="0"
    data-duration="90"
    data-track-index="2"
    data-timeline-role="captions"
    data-width="1080"
    data-height="1920"
    style="position:absolute;inset:0;z-index:3;pointer-events:none;"
  ></div>

  <!-- AUDIO: music at high track index -->
  <audio
    id="el-music"
    src="assets/music.mp3"
    data-start="0"
    data-duration="90"
    data-track-index="10"
    data-volume="0.3"
  ></audio>

</div>

<script>
  window.__timelines = window.__timelines || {};
  window.__timelines["root"] = gsap.timeline({ paused: true });
  // Root timeline stays near-empty. All animation is in sub-comps.
</script>
```

## Face Mode Choreography

Jessica's pipeline has two main face modes for portrait (1080x1920):

### FULLSCREEN mode (face fills frame)

Used for hook, emotional peaks, CTA moments.

```css
/* face-video */
position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; object-fit: cover;
```

Captions go in the lower third: `bottom: 160px` from screen bottom.

Overlays can use any zone. Avoid covering the face above the shoulders.

### BOTTOM mode (face in lower half, content above)

Used for informational beats where text/graphics are primary.

```css
/* face-video */
position: absolute; left: 0; top: 960px; width: 1080px; height: 960px; object-fit: cover; object-position: center top;
```

The upper 960px is free for title cards, data, B-roll overlays.

Captions go just above the face crop: `bottom: 980px` or inside the content zone.

### Transitioning between modes

Animate the face wrapper div, not the `<video>` element itself:

```html
<!-- Wrap face video in an animated wrapper -->
<div id="face-wrapper" style="position:absolute; left:0; top:0; width:1080px; height:1920px; overflow:hidden;">
  <video id="face-video" ... style="width:100%; height:100%; object-fit:cover;"></video>
</div>
```

In the GSAP timeline:
```js
// Transition to BOTTOM mode at t=12
tl.to("#face-wrapper", { top: 960, height: 960, duration: 0.6, ease: "power2.inOut" }, 12);
// Transition back to FULLSCREEN at t=30
tl.to("#face-wrapper", { top: 0, height: 1920, duration: 0.6, ease: "power2.inOut" }, 30);
```

## Sub-Composition Pattern (Per-Beat Scene)

Each beat file `compositions/beat-1-hook.html`:

```html
<body>
  <template>
    <style>
      #root { position: absolute; inset: 0; pointer-events: none; }
      .title-card { position: absolute; left: 40px; top: 120px; width: 1000px; }
    </style>
    <div id="root" data-composition-id="beat-1-hook" data-width="1080" data-height="1920">
      <div class="title-card" id="hook-title">
        <p style="font-size:72px; font-weight:900; color:#fff;">Your hook text here</p>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#hook-title", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 0.2);
      tl.to("#hook-title", { opacity: 0, duration: 0.3, ease: "power2.in" }, 11.0);
      window.__timelines["beat-1-hook"] = tl;
    </script>
  </template>
</body>
```

Key rules: all `<style>` and `<script>` inside `<template>` (not `<head>`). Root styled via `#root` not a class. Timeline key matches `data-composition-id` exactly. Prefer `gsap.fromTo()` over `gsap.from()` for entrance tweens (safer on seek-back).

## B-Roll / Scene Overlay Injection

To add a B-roll clip during a beat, it must live at the host root (index.html), not inside the sub-comp:

```html
<!-- In index.html, alongside the beat sub-comp slot -->
<video
  id="broll-1"
  src="assets/broll-product.mp4"
  class="clip"
  data-start="5"
  data-duration="4"
  data-track-index="3"
  data-volume="0"
  muted
  playsinline
  style="position:absolute; left:0; top:0; width:1080px; height:960px; object-fit:cover; z-index:4; opacity:0;"
></video>
```

Then in the root or main script, drive it:
```js
// B-roll enters and exits (global time = 5s)
main.fromTo("#broll-1", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 5);
main.to("#broll-1", { opacity: 0, duration: 0.4 }, 8.6);
```

## Continuous Background Pattern

When the background must persist visually across scene cuts:

```html
<!-- NOT a clip - no data-start/data-duration/data-track-index -->
<!-- Always visible, driven by the GSAP timeline -->
<div id="ambient-bg" style="position:absolute;inset:0;background:#0a0a0a;z-index:0;"></div>
```

In the root timeline:
```js
// Animate the shared background across the whole video
main.to("#ambient-bg", { backgroundColor: "#1a0a2e", duration: 6 }, 0);
main.to("#ambient-bg", { backgroundColor: "#0a0a0a", duration: 8 }, 30);
```

Do not duplicate background divs on each scene. One shared layer driven by one timeline.

## Variables for Reusable Sub-Comps

Pass per-instance data via `data-variable-values` on the host slot:
```html
<div data-composition-id="lower-third" data-composition-src="compositions/lower-third.html"
  data-variable-values='{"title":"Follow for more","accent":"#ff6b35"}'
  data-start="45" data-track-index="2" ...></div>
```

In sub-comp script: `const { title, accent } = window.__hyperframes.getVariables();`

Declare defaults on sub-comp's `<html>` element:
`data-composition-variables='[{"id":"title","type":"string","label":"Title","default":"Follow"}]'`

## Modular vs Monolithic

Modular (sub-compositions): use when video has clear scene cuts, any scene exceeds ~100 lines, or you want per-beat iteration. Audio that spans scene cuts must stay at the root.

Monolithic (single file): use for short one-continuous-scene videos under ~400 lines total.

At 3+ scene cuts in a monolithic file, lift each scene into a sub-comp before adding more.

## Audio Rules

- Background music: root-level `<audio>`, `data-track-index="10"`, `data-volume="0.3"`
- Audio in a sub-comp `<template>` is dropped - always at host root
- `data-media-start="N"` trims the source audio start point
- Multiple audio clips can overlap on different track indexes
