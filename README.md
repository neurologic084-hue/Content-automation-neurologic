# Olympus — AI Content Engine

Turn one idea into a published short-form video in minutes. Olympus handles scripting, editing, captioning, and cross-platform publishing so creators can focus on showing up.

> Working on this codebase? Read [TODO-JUNE.md](TODO-JUNE.md) first — it is the
> current priority list and records why several things are the way they are.

## What it does

1. **Ideas** — type a rough topic, AI picks the right audience lane and generates a full hook, body, and CTA
2. **Review** — approve or revise scripts; every decision trains your brand voice over time
3. **Film** — approved scripts show a filming guide (shot type, setup, wardrobe) and a teleprompter
4. **Edit** — paste a Google Drive link to the raw recording; the app cleans the audio, cuts retakes, and renders six variants with captions, music, and B-roll
5. **Publish** — post to Instagram, Facebook, TikTok, and YouTube with platform-specific AI captions, instantly or scheduled

## Tech stack

- **Next.js 16** (App Router) — hosted on **Railway**; renders run inside the app container
- **Supabase** — Postgres + Auth (row-level security per account)
- **Cloudflare R2** — footage, intermediates, and finished videos (S3-compatible)
- **Two render engines**
  - **v1–v3: Submagic** — captions and styling on a pre-cut, pre-cleaned source
  - **v4–v6: Motion Lab** — our own Remotion compositions (`remotion/`) + FFmpeg
- **OpenRouter** — every LLM call (scripts, cut planning, captions); Anthropic direct is the backup
- **Auphonic** — audio cleaning, with ElevenLabs isolation as the fallback
- **ElevenLabs** — transcription and sound effects
- **Pexels** (stock B-roll), **Tavily** (script research), **Blotato** (social publishing)

Every external service has a fallback chain — see TODO-JUNE.md §3.

## Local setup

```bash
cd vid-app
# .env.local — get it from Daniel; every .env* file is gitignored
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Environment variables:** the authoritative list — which are required and what
each optional one buys — is in TODO-JUNE.md §8. `RAILWAY.md` covers the
production variables and the build-time `NEXT_PUBLIC_*` trap.

## Checks

```bash
npx tsc --noEmit    # typecheck
npm run lint        # eslint — kept at 0 problems
npm run test:cut    # cut-planning rules (retakes, deliberate repetition, tails)
npm run build       # production build
```

## Deploying

Production is Railway, built from the `Dockerfile` (see `railway.json`). A push
to `main` deploys. **A deploy interrupts any render in progress** (it is marked
retryable), so deploy when nothing is rendering. `/api/health` reports uptime —
it resets to ~0 when the new version is live. Details in [RAILWAY.md](RAILWAY.md).

## Project structure

```
vid-app/
  app/
    (app)/
      dashboard/     # Home — stats, "up next", activity, tour
      ideas/new/     # Idea input + audience lane selection
      review/        # Script review queue + detail (teleprompter)
      edit/          # Footage upload + video studio (the six variants)
      publish/       # Caption generation + social publishing
      library/       # Approved scripts, folders
      settings/      # Brand voice, profiles, storage usage
    api/             # Route handlers — all require a session (see proxy.ts)
  components/        # Shared UI (nav, modals, tour, teleprompter)
  lib/
    video-pipeline.ts    # Variant definitions + job orchestration
    motion-renderer.ts   # Prep + v4–v6 render pipeline
    submagic-start.ts    # v1–v3 submission to Submagic
    edit-plan.ts         # The cut brain shared by all six variants
    stale-sweep.ts       # Detects dead renders; silent self-heal + requeue
    job-lock.ts          # patchVariant — the ONLY way to write `variants`
    blotato.ts           # Social publishing client
  remotion/          # Remotion project for v4–v6 compositions
  supabase/          # Schema + migrations
  tests/             # cut-plan.test.ts
  proxy.ts           # Auth gate (Next 16's middleware)
  instrumentation.ts # Boot hook → instrumentation-node.ts (watchdog, shutdown)
```

## Publishing notes

- **Facebook** posts to a Page, and Blotato's Page id is *not* the account id —
  it comes from `/users/me/accounts/{id}/subaccounts`. `lib/blotato.ts` looks it
  up; if Facebook ever says "Page / subaccount not found", reconnect Facebook in
  Blotato and pick the Page again.
- Each platform's exact caption is saved on `publish_jobs.platform_posts[].caption`
  (the `caption` column only holds the first platform's).

## Customer journey

```
New idea → AI script → Review & approve → Film (guided) → Upload footage → Edit variants → Publish
```

After approving a script, the review page surfaces a "Start filming" banner that links directly to the upload page. After selecting an edited variant, the app auto-redirects to Publish with the video pre-selected.
