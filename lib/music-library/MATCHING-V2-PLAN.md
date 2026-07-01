# Music Matching V2 — Implementation Plan

Status: proposed (not built). Author: research pass, 2026-07-01.

Goal: pick background music that fits the *actual video*, not just the transcript, and stop
picking a **random** track inside a mood folder. Two independent upgrades that compound.

---

## 1. Where we are today

Selection is text-only. At render time `selectTrack()` (`lib/music-library/select.ts`) sends the
hook + `moodTag` + `scriptFormat` to Claude Haiku, which returns **one** of 12 mood-folder names.
Then a track is picked **at random** from that folder.

Two separate weaknesses:

1. **No visual context.** The pixels are never analyzed. If the words are sad but the room is
   bright and upbeat, we still pick "sad".
2. **Random within a mood.** Even once the mood is right, the specific track is a coin flip because
   tracks carry no descriptions. Catalog metadata today is only:
   `id, title, categories[], file, durationSeconds, startOffset` (`lib/music-library/types.ts`).

Both are addressed below. Either upgrade is useful alone; together they give:
video mood profile (visual + transcript) → matched against rich per-track descriptions → best track.

---

## 2. Upgrade A — Analyze the video (visual + audio context)

### Approach: Gemini native video

Gemini `gemini-3.5-flash` (GA May 2026) ingests the mp4 natively, sampling frames at 1 fps **and**
reading the audio track together. One call returns a structured read of what's actually on screen
plus how it relates to what's being said. This directly solves the "transcript says X, video shows
Y" mismatch because both streams are seen at once.

We already have the source mp4 on local disk during the pipeline (same file fed to ElevenLabs
Scribe in `lib/caption-renderer.ts`). No frame extraction needed.

Rejected alternative: ffmpeg keyframes + Claude vision. Keeps everything in the existing OpenRouter
stack (no Google key), but loses audio + motion and is more plumbing. Kept only as a fallback.

### Output: a "mood profile" stored once per script

Analyze **once** when the video is ready (not per render — we render multiple variants per script).
Store the result as JSON on the `scripts` table so every variant reuses it.

Proposed shape:

```jsonc
{
  "visualSetting": "home office, warm daylight",
  "visualEnergy": 4,            // 1-10
  "emotionalTone": "reflective but hopeful",
  "colorTemp": "warm",
  "pace": "slow",              // slow | medium | fast
  "transcriptSentiment": "serious",
  "mismatchNote": "words are heavy, visuals are calm/optimistic — lean warm not sad",
  "suggestedMoods": ["calm", "emotional", "inspiring"],
  "keywords": ["storytelling", "personal", "advice"]
}
```

### Where it plugs in

- New module `lib/music-library/analyze-video.ts` — takes an mp4 path, calls Gemini, returns the
  profile above (validated against a schema).
- Call it at the stage where a script's video first becomes available; persist JSON to a new
  `scripts.mood_profile` column (Supabase migration).
- `start-variant/route.ts` reads `mood_profile` and passes it into selection alongside the existing
  `hook / moodTag / scriptFormat`.
- Config flags mirror the existing `MUSIC_ENABLED` pattern: `VIDEO_ANALYSIS_ENABLED`, plus
  `GEMINI_API_KEY`. If disabled or the call fails, fall back to today's hook-only path.

### Cost

Gemini 3.5 Flash: $1.50 / 1M input, $9 / 1M output. Video ≈ 100 tokens/sec at low res.

- 60s clip ≈ 6k input tokens + small JSON output ≈ **~1-2 cents per video** (~3 cents at full res).
- ~100 videos/month ≈ **$1-3/month**.
- Optional 90% savings via context caching, not worth the complexity at this volume.

---

## 3. Upgrade B — Describe every track, then match instead of randomize

### B1. One-time offline description job

New script `lib/music-library/describe-tracks.ts` (runs like the existing `music:analyze`):

- For each track in the catalog, upload the audio to Gemini and get structured fields.
- Complement with cheap deterministic features we already partly compute via ffmpeg
  (BPM/tempo, loudness/energy from the ebur128 pass in `analyze-sections.ts`).
- Write results back into `catalog.ts` next to existing metadata.

Extend `MusicTrack` (`types.ts`):

```jsonc
{
  // ...existing fields...
  "description": "warm lo-fi pop, soft pads, gentle pluck lead, no drums",
  "genre": "lo-fi pop",
  "instrumentation": ["soft pads", "plucks", "light percussion"],
  "bpm": 82,
  "energy": 3,                 // 1-10
  "moodWords": ["warm", "reflective", "hopeful"],
  "goodFor": ["personal storytelling", "advice", "reflective intros"],
  "avoidWhen": ["high-energy product demo", "comedic"],
  "embedding": [/* text-embedding of the description, computed once */]
}
```

Cost: ~500 tracks × ~$0.008 each ≈ **under $5 one-time**. Re-run only when new tracks are ingested.

### B2. Smarter selection at render time

Replace "random in folder" with an actual match. Two-step:

1. **Shortlist by embedding similarity.** Build a query string from the video mood profile
   (Upgrade A) — or from hook + moodTag if A is off — embed it, cosine-match against track
   `embedding`s, take the top ~8. Cheap, scales to the full library, no per-track LLM call.
2. **Final pick by LLM.** Hand the shortlist's descriptions + the mood profile to Claude Haiku,
   ask for the single best fit. Small prompt, one cheap call.

Fallbacks preserved: if embeddings/descriptions are missing for a track, fall back to
category-filtered random (today's behavior). Neutral fallback (`calm`) unchanged.

This works **with or without** Upgrade A — B alone already replaces the coin flip.

---

## 4. Rollout order

1. **B1 — describe the library. ✅ BUILT + RUN.** All tracks profiled via OpenRouter
   (`google/gemini-2.5-flash`). See below.
2. **B2 — matching. ✅ BUILT.** `select.ts` now picks the best-fit track from a pool using
   the sound profiles (energy/mood/avoid-when) instead of random. Falls back to random if
   profiles are missing or the pick fails. Logs `profile-match` vs `random`.
3. **A — video analysis.** Add the mood profile, feed it into B2's picker. NEXT.

Note: went with a direct profile-based LLM pick over embeddings — the curated library is small
(~112 tracks) so a category-filtered pick over compact profile lines is simpler and accurate
enough; embeddings can come later if the library grows.

Curation outcome (Dr. Wendling): 315 → 112 on-brand tracks. Cut off-brand folders
(energetic/dark/gangster/mysterious), then a sound-based fine pass removed 55 more that were
too hyped (energy 7-9), tonally dark/eerie, or driving pop — even where the folder tag looked
safe. Describe/prune/sync tooling: `music:describe`, `music:prune`, `music:sync`.

### Decisions locked
- Media analysis uses a dedicated `GEMINI_API_KEY` (direct Google API), not OpenRouter —
  OpenRouter doesn't reliably proxy native audio/video file input. OpenRouter still handles the
  existing text calls.
- Model is `gemini-3.5-flash`, overridable via `GEMINI_MODEL`.
- Descriptions are sound-based (Gemini listens to a ~45s snippet cut at each track's `startOffset`).
  Not filename- or web-based — the library is generically-named royalty-free tracks.

### B1 — what shipped
- `lib/gemini.ts` — minimal fetch-based Gemini client (`geminiGenerate` / `geminiJSON`) with inline
  media + structured `responseSchema`.
- `MusicTrack.profile` (`lib/music-library/types.ts`) — new `MusicProfile` object: description,
  genre, instrumentation, tempoFeel, bpm, energy 1-10, moodWords, goodFor, avoidWhen.
- `lib/music-library/describe-tracks.ts` — the job. Resolves each track (local or Supabase), cuts a
  45s mono snippet at the best part, sends it to Gemini, writes profiles back into `catalog.ts`
  (incremental save, skips already-described unless `--force`).
- `npm run music:describe` wired in `package.json`.

To run: put `GEMINI_API_KEY=...` in `.env.local`, then `npm run music:describe`.

Each step ships independently and degrades gracefully to current behavior if flagged off.

---

## 5. Open questions before building

- New Google dependency (`GEMINI_API_KEY`) OK, or route Gemini through the existing OpenRouter
  account to keep one provider/key?
- Store `mood_profile` on the `scripts` table (needs a migration) vs compute-and-cache elsewhere?
- Which embedding model for track/query vectors (Gemini text-embedding vs an OpenAI/Voyage one)?
- Re-describe cadence: fold into `music:ingest`, or a separate `music:describe` step run manually?

---

## 6. Cost summary

| Item | Cost |
|------|------|
| Video analysis per clip (60s, low res) | ~1-2 cents |
| Video analysis monthly (~100 clips) | ~$1-3 |
| Describe full library (~500 tracks) | <$5 one-time |
| Embedding shortlist per render | negligible |
| Final LLM pick per render (Haiku) | negligible |
