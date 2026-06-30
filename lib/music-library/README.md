# Background music system

Mood-matched background music from a curated, local library of the creator's own
tracks. Self-contained in `lib/music-library/`; it hooks into the render pipeline
at a few well-defined points (below) and otherwise stays out of the way.

## How it works

1. **Library** — `catalog.ts` is the track index (id, title, mood `categories`,
   relative `file` path, `startOffset`). The audio itself is **hosted in the
   Supabase Storage `music` bucket** (public read) and also cached locally under
   `music-library-files/` (gitignored). The files are ~75s snippets trimmed to
   start at each track's best part, so `startOffset` is 0.
2. **Select** (`select.ts`) — matches the video's mood (`moodTag` / hook) to a
   category, then picks a track from it. Falls back to a neutral category so it
   always returns something when the library is non-empty.
3. **Resolve** (`resolve.ts`) — LOCAL-FIRST: uses `music-library-files/` if the
   track is on disk; otherwise downloads it from the Supabase `music` bucket once
   and caches it. So pulling the branch is enough — no need to ship audio around.
   (`MUSIC_LIBRARY_DIR` overrides the local dir.)
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
npm run music:ingest    # build catalog.ts from a mood-organized source folder (dedupes)
npm run music:analyze   # detect each track's best-part offset (energy-envelope peak + filename drop hints)
npm run music:trim      # trim every track to a ~75s best-part snippet (shrinks the library to fit storage)
npm run music:upload    # create/refresh the Supabase "music" bucket and upload the snippets
npm run music:preview    # show what gets picked for sample videos (no render)
npm run music:test-mix -- <video.mp4>   # hear the full mix on any clip (no Submagic)
```

The audio lives in the Supabase `music` Storage bucket (not in git — it's large
and copyrighted). The resolver pulls from there automatically, so **just pulling
this branch is enough for music to work** — no zip to pass around. Full pipeline
to refresh the library: `ingest` → `analyze` → `trim` → `upload`.

`ffmpeg`/`ffprobe` resolve via the bundled `ffmpeg-static` (`lib/ffmpeg-env.ts`),
so renders work without a system ffmpeg install.
