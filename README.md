# Olympus — AI Content Engine

Turn one idea into a published short-form video in minutes. Olympus handles scripting, editing, captioning, and cross-platform publishing so creators can focus on showing up.

## What it does

1. **Ideas** — type a rough topic, AI picks the right audience lane and generates a full hook, body, and CTA
2. **Review** — approve or revise scripts; every decision trains your brand voice over time
3. **Film** — approved scripts show a filming guide (shot type, setup, wardrobe) before you record
4. **Edit** — paste a Google Drive link to your raw recording; AI cuts, adds captions, music, and optional B-roll automatically
5. **Publish** — post to Instagram, Facebook, TikTok, and YouTube with platform-specific AI captions, instantly or scheduled

## Tech stack

- **Next.js 15** (App Router, Server Components)
- **Supabase** — Postgres + Auth + Storage
- **Remotion** — video rendering
- **FFmpeg** — trim, overlay, silencedetect
- **ZapCap** — auto-captions
- **Blotato** — social publishing

## Local setup

```bash
cd vid-app
cp .env.local.example .env.local   # fill in keys
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Required env vars

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access |
| `OPENAI_API_KEY` | Script generation + B-roll clip selection |
| `ZAPCAP_API_KEY` | Auto-caption rendering |
| `BLOTATO_API_KEY` | Social publishing |
| `GOOGLE_DRIVE_API_KEY` | B-roll folder listing (optional) |

## Project structure

```
vid-app/
  app/
    (app)/
      dashboard/     # Home — stats, getting-started guide, tour
      ideas/new/     # Idea input + audience lane selection
      review/        # Script review queue + detail
      edit/          # Upload footage + video studio
      publish/       # Caption generation + social publishing
      library/       # Approved scripts vault
      settings/      # Brand voice configuration
  components/        # Shared UI (tour modal, nav, etc.)
  lib/
    motion-renderer.ts   # Core video pipeline (trim, B-roll, captions)
    video-pipeline.ts    # Job orchestration
    blotato.ts           # Social publish client
  supabase/
    schema.sql       # Full DB schema
```

## Customer journey

```
New idea → AI script → Review & approve → Film (guided) → Upload footage → Edit variants → Publish
```

After approving a script, the review page surfaces a "Start filming" banner that links directly to the upload page. After selecting an edited variant, the app auto-redirects to Publish with the video pre-selected.
