# Deploying to Vercel (free/Hobby to start)

The app runs in two pieces on Vercel, both from this one repo:

- **Web app + API** — normal Vercel functions (the UI, publishing, Submagic
  submissions, status polling).
- **Heavy work** — every render/finishing job runs in a **Vercel Sandbox**:
  an ephemeral Linux VM that clones this repo, installs deps, runs ONE task
  (`worker/run-task.ts`), and dies. Tasks: source prep, v4-v6 Remotion
  renders, v1-v3 Submagic finishing (music/SFX).

Local dev is unchanged: without the `VERCEL` env var, all tasks run
in-process on your machine exactly as before.

## One-time setup

1. **Vercel account** (client's email eventually) → **Add New Project →
   Import** the GitHub repo `neurologic084-hue/Content-automation-neurologic`.
   Framework: Next.js (auto-detected). `vercel.json` already pins function
   duration (300s) and region (iad1, where Sandbox lives).
2. **GitHub token for the Sandbox** (repo is private): GitHub → Settings →
   Developer settings → Fine-grained tokens → new token with **read-only
   Contents** access to this repo. This becomes `SANDBOX_GIT_TOKEN`.
3. **Environment Variables** (Project → Settings → Environment Variables) —
   everything from `.env.local` plus the two sandbox ones:

       NEXT_PUBLIC_SUPABASE_URL
       NEXT_PUBLIC_SUPABASE_ANON_KEY
       SUPABASE_SERVICE_ROLE_KEY
       OPENROUTER_API_KEY
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
       NEXT_PUBLIC_APP_URL        ← the Vercel URL once known
       SANDBOX_REPO_URL           ← https://github.com/neurologic084-hue/Content-automation-neurologic.git
       SANDBOX_GIT_TOKEN          ← the fine-grained token from step 2

4. Deploy. The assigned `*.vercel.app` URL is the app — Jessica logs in there.

## Free-tier (Hobby) limits that matter

- **Sandbox: 5 active-CPU hours/month free.** A v4-v6 render uses roughly
  10-20 CPU-minutes, so expect **~15-25 renders/month** before Sandbox
  creation pauses until the next cycle. Fine for testing; upgrade to Pro
  ($20/mo, usage-billed with $20 credit included) for real client use.
- **Functions: 300s max.** All long work is in Sandboxes, so this only
  matters if a Submagic submission is unusually slow.
- **No disk.** Finished videos live in R2 only (already true); local
  `/renders/...` preview fallbacks don't exist on Vercel.

## How the pieces behave on Vercel

- Start a variant → the API responds instantly; a Sandbox boots (~2-4 min of
  npm install before rendering starts — slower first-feedback than local),
  renders, uploads to R2, updates Supabase, dies.
- v1-v3 → Submagic renders in their cloud as always; when the studio page
  polls status and sees it finished, a finishing Sandbox is dispatched
  (music + transition SFX + R2 upload). Keep the studio page open until
  variants flip to ready — polling is what drives the handoff.
- Every render is its own VM, so three variants at once genuinely run in
  parallel — no shared-machine starvation.

## Known first-deploy shakedown items

Built and typechecked, but the Sandbox path can't be exercised without a real
Vercel project, so expect to verify on the first deploy:

1. Sandbox git clone auth (token scope).
2. `npx remotion browser ensure` inside the VM (Chrome download).
3. End-to-end: one v4 render + one v1 finishing pass.
