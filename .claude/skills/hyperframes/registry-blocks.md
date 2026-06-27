# HyperFrames Registry Blocks

Install any item: `npx hyperframes add <name>`

Blocks vs Components:
- **Block**: standalone scene with its own size and duration. Install to `compositions/<name>.html`. Wire with `data-composition-src`.
- **Component**: reusable snippet/effect that adapts to the host. Install to `compositions/components/<name>.html`. Paste its HTML/CSS/JS into your composition.

## Caption Components (15 styles)

All caption components have transparent backgrounds - they are pure overlays.

| Name | Description | Best for |
|------|-------------|----------|
| `caption-highlight` | TikTok-style active-word highlight with color pop | Social, high-energy talking-head |
| `caption-pill-karaoke` | Word-by-word karaoke inside a pill container | Music videos, lyric content |
| `caption-editorial-emphasis` | Clean editorial style with emphasis words larger | Documentary, interview, storytelling |
| `caption-glitch-rgb` | RGB-split glitch effect on active words | Tech, gaming, digital content |
| `caption-kinetic-slam` | Full-screen word slam entrance | Hype, announcements, viral clips |
| `caption-neon-glow` | Electric neon glow on text, night-sign aesthetic | Nightlife, club, cyberpunk scenes |
| `caption-neon-accent` | Multi-color neon accent per word | Colorful, playful, social |
| `caption-clip-wipe` | Clip-path wipe reveal per word | Clean, modern, professional |
| `caption-gradient-fill` | Gradient color fill on active words | Vibrant, lifestyle, brand |
| `caption-matrix-decode` | Character scramble decode entrance | Sci-fi, tech reveal, AI content |
| `caption-emoji-pop` | Emoji burst on emphasis keywords | Social, casual, reaction content |
| `caption-parallax-layers` | Depth parallax on caption layers | Cinematic, depth effect |
| `caption-particle-burst` | Particle scatter on impact words | Celebration, high-energy moments |
| `caption-texture` | Lava/bold texture fill on text | Dramatic, bold, statement content |
| `caption-weight-shift` | Font weight animates from thin to heavy | Elegant, typographic, minimal |
| `caption-blend-difference` | Auto-inverts text via `mix-blend-mode: difference` | Busy/unpredictable backgrounds |

List all caption components: `npx hyperframes catalog --tag caption-style`

## Effects Components

| Name | Description | When to use |
|------|-------------|-------------|
| `grain-overlay` | Film grain texture overlay | Cinematic warmth, analog feel |
| `vignette` | Dark vignette around frame edges | Focus attention on center, cinematic |
| `shimmer-sweep` | Horizontal shimmer/sheen sweep | Premium product moments, luxury |
| `motion-blur` | Directional motion blur effect | Fast transitions, speed feel |
| `grid-pixelate-wipe` | Grid pixelate transition wipe | Digital/tech reveals |
| `parallax-zoom` | Slow zoom parallax background | Ambient bg, depth feel |
| `parallax-unzoom` | Slow unzoom parallax background | Reveal, opening moment |
| `texture-mask-text` | Texture image masked into text shape | Bold title treatment, poster feel |
| `morph-text` | Animated text morph between strings | Data reveal, stat transitions |

## Social Overlay Blocks

| Name | Description |
|------|-------------|
| `instagram-follow` | Instagram follow card with profile, animated CTA |
| `tiktok-follow` | TikTok follow card with username, animated CTA |
| `yt-lower-third` | YouTube-style lower third with name/title bar |
| `x-post` | X (Twitter) post card with avatar, text, engagement |
| `reddit-post` | Reddit post card with upvotes, subreddit, text |
| `spotify-card` | Spotify "Now Playing" card with album art, progress |
| `macos-notification` | macOS notification toast with icon, title, body |

## Data Visualization Blocks

| Name | Description |
|------|-------------|
| `data-chart` | Animated bar/line/pie charts (Chart.js based) |
| `flowchart` | Animated flowchart with nodes and edges |
| `flowchart-vertical` | Vertical variant of the flowchart block |
| `us-map` | Animated US choropleth map |
| `us-map-bubble` | US map with animated bubble indicators |
| `us-map-hex` | US map with hex grid cells |
| `us-map-flow` | US map with animated flow arrows |
| `world-map` | Animated world choropleth map |
| `spain-map` | Spain regional map |

## WebGL Shader Transition Blocks

Shader transitions require two adjacent compositions. Each transition has its own timing and duration. Install and place between two scene clips.

| Name | Description |
|------|-------------|
| `whip-pan` | High-speed horizontal whip pan cut |
| `flash-through-white` | Hard flash cut through white |
| `glitch` | Digital glitch/datamosh transition |
| `light-leak` | Organic light leak flare transition |
| `cinematic-zoom` | Crash zoom with motion blur |
| `chromatic-radial-split` | Radial chromatic aberration split |
| `cross-warp-morph` | Warp morph between two images |
| `domain-warp-dissolve` | Domain-warp noise dissolve |
| `ridged-burn` | Ridged noise burn reveal |
| `ripple-waves` | Ripple wave distortion transition |
| `gravitational-lens` | Gravitational lens distortion effect |
| `swirl-vortex` | Swirl vortex warp transition |
| `thermal-distortion` | Heat distortion shimmer transition |
| `sdf-iris` | SDF-based iris open/close transition |

## CSS Transition Packs (no GPU required)

Each pack contains multiple named transitions:

| Name | Transitions included |
|------|---------------------|
| `transitions-3d` | Cube, flip, fold, door |
| `transitions-blur` | Blur in/out, zoom blur |
| `transitions-cover` | Cover slide variants |
| `transitions-destruction` | Shatter, explode variants |
| `transitions-dissolve` | Cross-dissolve, fade variants |
| `transitions-distortion` | Warp, skew distortion |
| `transitions-grid` | Grid reveal patterns |
| `transitions-light` | Flash, strobe, light variants |
| `transitions-mechanical` | Gear, clock, mechanical reveals |
| `transitions-other` | Miscellaneous transitions |
| `transitions-push` | Push slide in all directions |
| `transitions-radial` | Radial wipe, iris variants |
| `transitions-scale` | Scale punch, zoom variants |

## VFX and Liquid Glass Blocks

| Name | Description |
|------|-------------|
| `ios26-liquid-glass` | iOS 26 liquid glass material UI card |
| `macos-tahoe-liquid-glass` | macOS Tahoe liquid glass window effect |
| `liquid-glass-notification` | Liquid glass notification toast |
| `liquid-glass-context-menu` | Liquid glass context menu |
| `liquid-glass-media-controls` | Liquid glass media playback controls |
| `liquid-glass-widgets` | Liquid glass widget cards |
| `vfx-shatter` | Element shatter into fragments |
| `vfx-portal` | Portal/wormhole reveal effect |
| `vfx-magnetic` | Magnetic field particle attraction |
| `vfx-iphone-device` | iPhone device frame with screen content |
| `vfx-liquid-background` | Animated liquid/blob background |
| `vfx-liquid-glass` | Generic liquid glass material |
| `vfx-text-cursor` | Animated text cursor effect |

## Code Animation Blocks

For Jessica's video pipeline these are less relevant but available for tutorial/tech content:

`code-morph`, `code-typing`, `code-diff`, `code-highlight`, `code-scroll`, `code-3d-extrude`, `code-shader-dissolve`, `code-particle-assemble`

24+ `code-snippet-*` themed syntax cards (dark-modern, monokai, solarized, apple-terminal variants, etc.)

## Showcase / Scene Blocks

| Name | Description |
|------|-------------|
| `app-showcase` | App UI showcase with device and screens |
| `apple-money-count` | Apple-style animated number count-up |
| `north-korea-locked-down` | News-style geo-locked content visualization |
| `nyc-paris-flight` | Animated flight path visualization |
| `vpn-youtube-spot` | VPN-style YouTube geo-block visualization |
| `blue-sweater-intro-video` | Styled intro video scene template |
| `ui-3d-reveal` | 3D reveal of a UI screenshot |
| `logo-outro` | Branded logo outro/end card |

## Installing and Wiring a Block

```bash
npx hyperframes add instagram-follow
```

Wire in index.html:
```html
<div
  data-composition-id="instagram-follow"
  data-composition-src="compositions/instagram-follow.html"
  data-start="5"
  data-track-index="2"
  data-width="1920"
  data-height="1080"
></div>
```

No `data-duration` needed on sub-composition hosts - duration comes from the internal GSAP timeline.

## Installing and Wiring a Component

```bash
npx hyperframes add grain-overlay
```

Paste the HTML fragment into your composition's markup, CSS into your style block, and any JS initialization into your script block. Then integrate the component's GSAP calls into your master timeline.
