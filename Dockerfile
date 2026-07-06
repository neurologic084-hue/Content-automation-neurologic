# ── Olympus content engine — Railway/any-Docker-host image ───────────────────
# One container runs everything: the Next.js app (UI + API) and the render
# pipeline (Remotion headless Chrome + ffmpeg). Designed for a SINGLE replica —
# the render/audio queues and duplicate-start locks are in-process.

FROM node:22-bookworm-slim

# ffmpeg for the entire audio/video pipeline, plus the shared libraries
# Remotion's Chrome Headless Shell needs on Debian. fonts-liberation and the
# emoji font keep any system-font fallback text from rendering as tofu.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libexpat1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2 \
    libx11-6 libx11-xcb1 libxcb1 \
    fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies for BOTH package trees (the app and the Remotion
# project) before copying source, so Docker layer caching survives code edits.
COPY package.json package-lock.json ./
RUN npm ci
COPY remotion/package.json remotion/package-lock.json ./remotion/
RUN cd remotion && npm ci

COPY . .

# Bake Remotion's Chrome Headless Shell into the image so the first render
# doesn't spend minutes downloading a browser (or fail without network).
RUN cd remotion && npx remotion browser ensure

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# next start honors Railway's injected PORT.
CMD ["npm", "start"]
