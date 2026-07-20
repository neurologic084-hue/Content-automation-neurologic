import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deliberately NOT `output: 'standalone'`. The render shells out to
  // `npx remotion` from remotion/ using process.cwd()-relative paths, stages
  // assets into remotion/public and reads remotion/node_modules — none of which
  // standalone's import/require tracing would carry, and running from
  // .next/standalone would break the cwd-relative resolution. The Dockerfile
  // ships the full tree and runs `next start` so every path stays put. See
  // RAILWAY.md before reconsidering.
};

export default nextConfig;
