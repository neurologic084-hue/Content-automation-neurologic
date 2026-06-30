# Background music system

Mood-matched background music from a curated, local library of the creator's own
tracks. Self-contained in `lib/music-library/`; it hooks into the render pipeline
at a few well-defined points (below) and otherwise stays out of the way.

## How it works

1. **Library** — `catalog.ts` is the track index (id, title, mood `categories`,
   relative `file` path, and a `startOffset` = where the best part / chorus
   begins). The audio files live under `music-library-files/` (gitignored, never
   committed). `MUSIC_LIBRARY_DIR` overrides the location for other environments.
2. **Select** (`select.ts`) — matches the video's mood (`moodTag` / hook) to a
   category, then picks a track from it. Falls back to a neutral category so it
   always returns something when the library is non-empty.
3. **Resolve** (`resolve.ts`) — turns the catalog entry into a local file path.
4. **Mix** (`mixBackgroundMusic` in `motion-renderer.ts`) — starts the track at
   its `startOffset`, EQ-carves the vocal band, lightly ducks under the voice,
   and masters the whole video to **-13 LUFS / -1.5 dBTP** (short-form target).

Entry point for the pipeline: `getLibraryMusic(ctx)` (`index.ts`) → select + resolve.

## Where it hooks into the render pipeline

| Variant(s) | Where music is added | Notes |
|---|---|---|
| **v4 / v5** (edit) | `renderSmartCinematic` → `mixBackgroundMusic` | in-render, after motion graphics |
| **v2 / v3** (submagic) | `retrieveAndStoreSubmagicResult(..., music)` | mixed in **post**, after Submagic finishes (Submagic's API can't take our audio) |
| **v1** (submagic) | — | voice-only by design (`submagicProfile.useMusic: false`) |
| **our-v6** (motion-graphics test) | `renderMotionGraphicsTestOnly` | the credit-free way to test music (skips Submagic) |

The per-render choice is a `music_mode` field on each variant (`'smart' | 'off'`,
in `video-pipeline.ts`), set by the picker in the video studio and threaded through
the routes into `RenderVariantOptions.musicMode`. `'off'` disables music everywhere.

## Setup / maintenance (dev scripts)

```
npm run music:ingest    # build catalog.ts from a mood-organized source folder (dedupes, copies into music-library-files/)
npm run music:analyze   # detect each track's best-part offset (energy-envelope peak + filename drop hints)
npm run music:preview    # show what gets picked for sample videos (no render)
npm run music:test-mix -- <video.mp4>   # hear the full mix on any clip (no Submagic)
```

Audio files are not in git — share the `music-library-files/` folder out of band
(e.g. shared Drive) so other environments have the tracks the catalog references.
`ffmpeg`/`ffprobe` resolve via the bundled `ffmpeg-static` (`lib/ffmpeg-env.ts`),
so renders work without a system ffmpeg install.
