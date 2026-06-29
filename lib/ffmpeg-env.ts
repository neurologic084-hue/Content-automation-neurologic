import path from 'path'
import os from 'os'
import fs from 'fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

// ── ffmpeg PATH fallback ──────────────────────────────────────────────────────
// The render pipeline (motion-renderer.ts, smart-cut.ts) invokes bare `ffmpeg`
// and `ffprobe` via exec, assuming they're on the system PATH. That holds in
// production / on machines with a system install, but not on a dev machine that
// never installed ffmpeg. Since the project bundles ffmpeg-static +
// ffprobe-static, we APPEND their directories to PATH as a fallback (system
// ffmpeg, if present, still wins).
//
// IMPORTANT: ffmpeg-static / ffprobe-static export an absolute path derived from
// their own __dirname, but Next/Turbopack rewrites that to a bogus "/ROOT/..."
// placeholder inside the bundled server. So we can't trust those exports — we
// resolve the real binary from the project's node_modules and verify it exists
// before adding it, falling back to the package export only if that's valid.

const exe = os.platform() === 'win32' ? '.exe' : ''

function firstExisting(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return null
}

function resolveBinary(pkgExportPath: string | null, ...relFromCwd: string[][]): string | null {
  const cwd = process.cwd()
  const cwdCandidates = relFromCwd.map(rel => path.join(cwd, 'node_modules', ...rel))
  // Prefer a real cwd-resolved path; only trust the package export if it exists
  // on disk (it won't under Turbopack's /ROOT rewrite).
  return firstExisting(...cwdCandidates, pkgExportPath)
}

let patched = false

export function ensureFfmpegOnPath(): void {
  if (patched) return
  patched = true

  const ffmpegBin = resolveBinary(
    ffmpegStatic as unknown as string | null,
    ['ffmpeg-static', `ffmpeg${exe}`],
  )
  const ffprobeBin = resolveBinary(
    ffprobeStatic?.path ?? null,
    ['ffprobe-static', 'bin', os.platform(), os.arch(), `ffprobe${exe}`],
  )

  const dirs: string[] = []
  if (ffmpegBin) dirs.push(path.dirname(ffmpegBin))
  if (ffprobeBin) dirs.push(path.dirname(ffprobeBin))

  if (!dirs.length) {
    console.warn('[ffmpeg-env] could not locate bundled ffmpeg/ffprobe binaries — relying on system PATH')
    return
  }

  const parts = (process.env.PATH ?? '').split(path.delimiter)
  let added = false
  for (const dir of dirs) {
    if (dir && !parts.includes(dir)) { parts.push(dir); added = true } // append → system ffmpeg wins if present
  }
  process.env.PATH = parts.filter(Boolean).join(path.delimiter)
  if (added) console.log(`[ffmpeg-env] added bundled ffmpeg/ffprobe to PATH (${dirs.join(', ')})`)
}

ensureFfmpegOnPath()
