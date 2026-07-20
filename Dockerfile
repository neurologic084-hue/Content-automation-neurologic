# Railway image for the whole app: the Next.js server AND the heavy pipeline
# work (source prep, Remotion renders, Submagic submission) in one long-lived
# container.
#
# That co-location is the point of moving off Vercel. There, app/api/**/* was
# capped at 300s, so anything slow had to be shipped out to an ephemeral VM or
# a GitHub Actions runner — and when the cap was hit mid-flight the request died
# with the variant already marked 'processing' and nothing left to write a
# failure. A container has no request ceiling, so dispatchPipelineTask can run
# tasks in-process, which is the path this codebase has always had for a
# long-lived server.
#
# Remotion needs a real browser, so this cannot be a slim Node image: headless
# Chrome will download fine but refuses to LAUNCH without the system graphics,
# font and audio libraries below. Debian is used deliberately over Alpine —
# Remotion's compositor is glibc-linked.

FROM node:22-bookworm-slim AS base

# ffmpeg: every stage of the pipeline shells out to it (compression, the 4K
# downscale, window cuts, the audio chain, the final mux).
# fonts-liberation + noto-color-emoji: captions render emoji and fall back to
# Liberation; without them glyphs come out as blank boxes in the video.
# The rest are Chrome's runtime dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 libx11-6 \
      libxcb1 libexpat1 libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── deps ─────────────────────────────────────────────────────────────────────
# Copied separately from the source so a code-only change does not reinstall.
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
# remotion/ is its own package with its own lockfile — the render bundle
# resolves from there, not from the root node_modules.
COPY remotion/package.json remotion/package-lock.json* ./remotion/
RUN cd remotion && npm ci --no-audit --no-fund

# Download headless Chrome HERE, in the deps layer, not in the runtime stage.
# It lands in remotion/node_modules/.remotion and rides along with the remotion
# node_modules through build → runtime, so it is only re-fetched when remotion's
# lockfile changes — NOT on every code push. Done in the runtime stage before,
# it sat behind `COPY --from=build /app` and so re-downloaded (multi-minute) on
# every deploy. `browser ensure` defaults to chrome-headless-shell, matching the
# runtime's REMOTION_CHROME_MODE.
RUN cd remotion && npx remotion browser ensure

# ── build ────────────────────────────────────────────────────────────────────
FROM base AS build
# NEXT_PUBLIC_* values are BAKED INTO THE CLIENT BUNDLE at build time, and a
# Dockerfile build receives Railway's service variables ONLY through declared
# build args — nothing is injected implicitly. Without these ARGs the image
# builds green, the server half works (runtime env exists), and every
# browser-side Supabase call silently has no URL: login and every data page
# spin forever. That exact failure shipped on 2026-07-20; these lines are why
# it can't again.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/remotion/node_modules ./remotion/node_modules
COPY . .
# Loud, not fatal: a local no-args build is legitimate for smoke tests, but a
# deploy built without the URL is guaranteed-broken in the browser.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" || echo "!!!!! NEXT_PUBLIC_SUPABASE_URL is EMPTY — the client bundle will not work. On Railway, set the service variables BEFORE building. !!!!!"
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
# Renders write multi-GB intermediates; keep them on the container disk rather
# than anywhere the app tree is watched.
ENV RENDERS_DIR=/tmp/renders
# Chrome cannot use its sandbox without extra kernel privileges Railway does not
# grant. Remotion reads this to launch accordingly.
ENV REMOTION_CHROME_MODE=headless-shell

# Take over SIGTERM. `next start` otherwise installs its own handler that
# process.exit()s the moment the HTTP server closes, which truncates the async
# drain in lib/shutdown.ts. With this set, no one traps the signal until
# instrumentation.ts installs the drain handler at boot. See RAILWAY.md.
ENV NEXT_MANUAL_SIG_HANDLE=1

# Force the in-process pipeline home regardless of any stray VERCEL var copied
# over with the rest of the service config. dispatchPipelineTask also detects
# Railway's own RAILWAY_* vars, but baking this into the image removes all doubt.
ENV PIPELINE_INPROCESS=1

# The finished image already carries the browser (baked into the remotion
# node_modules in the deps stage) so the first render pays no download, and this
# is a pure copy — no per-deploy work in the runtime stage.
COPY --from=build /app ./

EXPOSE 3000
CMD ["npm", "run", "start"]
