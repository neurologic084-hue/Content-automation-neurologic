# Deploying to Railway

One Railway service runs everything — the web app AND the render pipeline.
The public URL Railway assigns IS the app; there is no separate frontend.

## Ownership plan (client-owned)

The goal is that the client owns and pays for her own infrastructure:

1. **Railway account** — created with the client's email. Her card on billing.
   Add the developer as a workspace member for maintenance.
2. **GitHub** — the repo already lives under the client's GitHub account
   (`neurologic084-hue/Content-automation-neurologic`). Railway deploys from it.
3. **Third-party keys** (Supabase, Cloudflare R2, Submagic, ElevenLabs,
   Blotato, OpenRouter, Auphonic, Pexels, Tavily) — move each account to the
   client's email over time; until then the existing keys keep working.

## One-time setup (~30 minutes)

1. Sign in to Railway (client account) → **New Project → Deploy from GitHub repo**
   → pick `Content-automation-neurologic`. Railway detects the `Dockerfile`
   automatically (`railway.json` pins it).
2. **Before the first deploy finishes**, open the service → **Variables** and
   paste every variable from the list below (values come from `.env.local` on
   the dev machine — never commit that file).
3. **Volume**: service → right-click / Settings → **Attach Volume**, mount path:

       /app/public/renders

   This keeps rendered videos across restarts and deploys. 5–10 GB is plenty
   (finished videos also live in Cloudflare R2 permanently).
4. **Sizing**: Settings → Resources → give it **8 GB RAM / 8 vCPU** limits.
   Remotion drives a headless Chrome; small boxes fail renders.
   Keep **replicas at 1** — the render queues are in-process by design.
5. **Domain**: Settings → Networking → Generate Domain. That URL is the app.
   Optionally add a custom domain (e.g. app.neurologicseattle.com) and set the
   DNS CNAME it shows.
6. After the first successful deploy, update `NEXT_PUBLIC_APP_URL` to the real
   URL and redeploy (one click).

## Environment variables

Copy values from `.env.local`:

    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    OPENROUTER_API_KEY
    GEMINI_API_KEY            (optional but strongly recommended — content-aware editing)
    TAVILY_API_KEY
    SUBMAGIC_API_KEY
    ELEVENLABS_API_KEY
    PEXELS_API_KEY
    AUPHONIC_API_TOKEN
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET
    R2_ENDPOINT
    R2_PUBLIC_URL
    BLOTATO_API_KEY
    NEXT_PUBLIC_APP_URL       (set to the Railway/custom domain URL)

## Day-2 notes

- **Deploys**: every push to `main` redeploys automatically. A deploy that
  lands mid-render kills that render — the variant shows failed; hit Retry.
- **Logs**: Railway → service → Logs shows the same `[motion-renderer]` /
  `[storage]` lines as the local terminal.
- **Cost**: with 8 GB / 8 vCPU limits and light usage this lands around
  $20–30/month (Railway bills actual usage, not the limits).
- **Renders feel slower than the M-series laptop** — cloud vCPUs are weaker
  cores; expect v4–v6 to take roughly 1.5–2× the local time.
