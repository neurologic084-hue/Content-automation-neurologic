# Running on Railway

The whole app runs in one long-lived container: the Next.js server *and* the
heavy pipeline work (source prep, Remotion renders, Submagic submission).
Supabase still holds the data, R2 still holds the files.

## Why the move mattered

On Vercel, `app/api/**/*` was capped at 300s (`vercel.json`). Anything slower
had to be pushed out to an ephemeral Vercel Sandbox VM or a GitHub Actions
runner. When the cap was hit mid-flight the function died with the variant
already marked `processing` and nothing left to write a failure — production job
`ea334d47` lost v1/v2/v3 exactly that way: `processing`, no `external_id`, no
error, until a once-daily cron noticed.

A container has no request ceiling, so `dispatchPipelineTask` can run tasks
in-process — the path this codebase has always had for a long-lived server.

The trade the container makes: a render runs IN the server process, so a
redeploy or crash kills any render in flight (on Vercel those ran on separate
runners and survived). The graceful-shutdown + watchdog story below is what
keeps that from turning into a stuck card.

## Setup

1. New Railway project → deploy from this repo. It picks up `railway.json` and
   builds with the `Dockerfile`.
2. Set the service variables (below).
3. First build is slow (~10 min): two `npm ci` passes plus the Chrome download.
   Later builds are much faster — the Chrome download is now baked into the
   dependency layer, so a code-only push does not re-fetch it (see *Build*).

## Required variables

Copy from the current Vercel project — same names, same values:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENROUTER_API_KEY
GEMINI_MODEL
SUBMAGIC_API_KEY
AUPHONIC_API_TOKEN
ELEVENLABS_API_KEY
PEXELS_API_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_ENDPOINT
R2_PUBLIC_URL
```

`NEXT_PUBLIC_*` are read at **build** time. If one is missing the build still
goes green and fails at runtime as an auth error, so check them before trusting
a successful deploy.

**Do NOT copy `VERCEL`.** It is a Vercel-injected marker; dragged onto Railway
it would try to route every task into a Vercel Sandbox. The image is hardened
against this (`PIPELINE_INPROCESS=1` is baked in and Railway's own `RAILWAY_*`
vars are detected), but don't set it anyway.

No longer needed: `SANDBOX_REPO_URL`, `SANDBOX_GIT_TOKEN`, `CRON_SECRET`.

### Strongly recommended: a graceful-shutdown window

```
RAILWAY_DEPLOYMENT_DRAINING_SECONDS   e.g. 120
```

Railway's **default is `0`** — SIGTERM is followed by an effectively immediate
SIGKILL, which gives the graceful-shutdown code no time to run. Set this to a
non-zero value (≈120s is plenty) so a redeploy can drain cleanly. See below for
what the window buys. Renders take far longer than any sane drain, so this does
**not** let a render finish — it lets the container fail the render *retryably*
and let short Submagic tasks complete.

### Baked into the image (no action needed)

- `NEXT_MANUAL_SIG_HANDLE=1` — stops `next start` from trapping SIGTERM itself
  (it would `process.exit()` the moment the HTTP server closed and truncate the
  drain). `instrumentation.ts` installs the drain handler at boot instead.
- `PIPELINE_INPROCESS=1` — forces the in-process task home.
- `RENDERS_DIR=/tmp/renders`, `REMOTION_CHROME_MODE=headless-shell`.

## Stability: shutdown, crashes, and the watchdog

A render runs in-process, so it dies with the container. Three layers keep a
dead render from sitting `processing` forever:

**1. Graceful redeploy (SIGTERM, with a drain window set).**
`lib/shutdown.ts` owns SIGTERM. It immediately stops accepting new heavy work,
then — from the process that OWNS the running renders — marks each in-flight
render `failed` with a *"interrupted by a server restart, please retry"*
message, so the card flips to a retry in **seconds** rather than waiting for the
watchdog. Short Submagic start/finalize tasks are waited on inside the window so
a finalize writing the permanent R2 URL isn't cut in half. It always exits
before Railway's SIGKILL. With the drain window at `0` (the default) this layer
gets no time to run — that's why setting `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`
matters.

*Why the render is failed by the OLD container and not swept by the NEW one:*
during a redeploy Railway overlaps the two — the new container boots (and runs
`instrumentation.register()`) while the old one is **still rendering**. A
boot-time "fail everything that's processing" sweep in the new container would
kill that live render. Letting the dying owner fail its own renders has no such
ambiguity.

**2. Hard crash (SIGKILL / OOM — no drain ran).**
The watchdog in `instrumentation.ts` sweeps every 5 minutes, plus once ~15s
after boot. `sweepStaleVariants` (`lib/stale-sweep.ts`) fails any variant that
is `processing` past its thresholds: **12 min** if it never reported progress
(worker never came up) or **45 min** otherwise. These are deliberately generous
so they never false-fail a live render during deploy overlap — the cost is that
a crash-killed render that *had* made progress can show `processing` for up to
45 min before the watchdog fails it. Layer 1 is what makes the common case
(redeploys) fast; this is the floor for the uncommon case (a real crash).

**3. In-process safety net.** If a task throws before it wired up its own
failure handling (e.g. `renderEditVariantTask`'s job/script read), the
dispatcher fails that variant on the spot — but only if it is still
`processing`, so a result that just landed is never clobbered.

**Submagic variants (v1–v3) are never touched by any of this on a restart.**
Their render runs on Submagic's servers, tracked by `external_id`, and survives
a redeploy; the status route keeps polling it. Only the in-process Motion Lab
renders (v4–v6, `tool: 'edit'`) die with the container.

## Concurrency and the healthcheck

**The healthcheck (`/api/health`) runs at deploy time only** — Railway uses it
to decide when a new deploy is healthy before routing traffic, and does **not**
poll it for continuous monitoring. So a container busy with a render cannot trip
the healthcheck and get itself restarted mid-render. The 300s
`healthcheckTimeout` in `railway.json` is the deploy-readiness window; boot is
fast, so it's slack, not a constraint.

Renders don't fight the web server for the event loop: the heavy work is in
subprocesses (Chrome, ffmpeg, the Remotion compositor), and `/api/health` does
zero I/O. And they don't pile up: the actual render step is serialized one at a
time through `enqueueRemotionRender`, while planning / B-roll / music still run
in parallel. `renderConcurrency()` sizes the Chrome tab count from the machine
(`cores - 2`, capped by RAM/2.5GB and 6), which reserves two cores for ffmpeg,
the compositor, and the server.

**Keep `numReplicas` at 1.** Two replicas would each run their own watchdog and
their own in-process duplicate-start lock, and neither would see the other's.
The database-level guard in `startSubmagicVariantTask` still prevents a double
Submagic charge, but the rest of the concurrency story assumes one instance.

**Renders need disk.** They write multi-GB intermediates to `RENDERS_DIR`
(`/tmp/renders`). If deploys start failing on disk pressure, attach a volume and
point `RENDERS_DIR` at it.

**Renders need memory.** A small instance renders slowly rather than failing,
but 4GB is a sensible floor for 1080p, and more cores just makes
`renderConcurrency()` go wider on its own.

## Build

- **Two `npm ci` passes** — root and `remotion/` — are inherent (two packages,
  two lockfiles). Both are cached by their lockfile, so a code-only change
  reinstalls neither.
- **The Chrome download is baked into the deps layer** (`remotion browser
  ensure` runs right after the remotion `npm ci`, landing in
  `remotion/node_modules/.remotion`). It rides through to the runtime image and
  is only re-fetched when remotion's lockfile changes — previously it sat in the
  runtime stage behind `COPY --from=build /app`, so it re-downloaded (several
  minutes) on **every** deploy. The runtime stage is now a pure copy.
- **Next.js standalone output was considered and deliberately NOT adopted.** The
  render shells out to `npx remotion` from `remotion/` using `process.cwd()`-
  relative paths, stages assets into `remotion/public`, and reads
  `remotion/node_modules`. Standalone (`.next/standalone` + `server.js`) only
  traces files reachable by `import`/`require`; it would not carry the sibling
  `remotion/` package tree, and running from the standalone dir would break the
  cwd-relative resolution. The size win isn't worth risking the render's disk
  layout — `npm run start` (full `next start`) keeps every path where the code
  expects it.

## Verifying a deploy

1. `GET /api/health` → `{ ok: true, uptime: n }`.
2. Watch the logs for `[watchdog] stale-variant sweep every 5m (+ once at boot)`.
3. Create a job and confirm the prep log reaches
   `[prep] job … ready — source ✓ | pre-cut ✓ | clean audio ✓ | transcript ✓`.
4. Render one Motion Lab variant (v4/v5/v6) end to end — that exercises ffmpeg,
   Chrome and R2 together, which is everything the image has to get right.
5. Graceful shutdown: with `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` set, start a
   render, redeploy, and confirm the log shows `[shutdown] SIGTERM received …`
   then `[shutdown] failing N interrupted render(s)` and that the variant card
   turns into a retryable failure within seconds (not a 45-min spin).

## Not verified without a live deploy

Everything below builds and typechecks locally but was **not** exercised on a
real Railway container, and should be confirmed on the first deploy:

- **The exact SIGTERM→SIGKILL timing.** Railway's documented default drain is
  `0s`; the drain code exits `graceMs` (draining seconds − 5s margin) after
  SIGTERM. If Railway's SIGKILL lands earlier than documented, the drain is
  simply truncated and layer 2 (the watchdog) still covers it — but the seconds-
  fast retry depends on the window actually being honored.
- **That Railway injects one of `RAILWAY_ENVIRONMENT / RAILWAY_SERVICE_ID /
  RAILWAY_PROJECT_ID / RAILWAY_DEPLOYMENT_ID`** into the running container.
  `PIPELINE_INPROCESS=1` is baked in as the real guarantee; the `RAILWAY_*`
  detection is only a secondary belt.
- **The baked-in browser launches** (not just downloads) on the runtime image —
  `browser ensure` only downloads; the first real v4–v6 render is the launch
  test (step 4 above).
- **Instance sizing.** `renderConcurrency()` and the 4GB floor are reasoned from
  the machine, not measured on the chosen Railway plan.
