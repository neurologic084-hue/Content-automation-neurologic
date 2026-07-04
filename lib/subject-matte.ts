// ── Subject matte for the text-behind-speaker hook (v5 viral) ─────────────────
// The reference edit opens with the caption sitting BEHIND the speaker's head.
// To replicate it we need a foreground cutout of the speaker for the first ~3
// seconds: Replicate's robust-video-matting produces an alpha mask, ffmpeg
// merges it into a transparent VP9 webm, and the ShortEdit composition stacks
// that webm above the caption (base video → caption → foreground cutout).
//
// Strictly best-effort: no REPLICATE_API_TOKEN, a model failure, or a timeout
// all return null — the hook caption then simply renders in front, and the
// render never blocks. Cost per run is a few cents; only the hook seconds are
// matted, never the full video.

import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'

const RVM_MODEL = 'arielreplicate/robust_video_matting:73d2128a371922d5d1abf0712a1d974be0e4e2358cc1218e4e34714767232bac'
const OVERALL_TIMEOUT_MS = 4 * 60_000

function run(cmd: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(String(stderr).slice(-500) || err.message))
      else resolve()
    })
  })
}

export interface SubjectMatte {
  file: string          // path relative to remotion/public/
  durationSec: number
}

export async function buildSubjectMatte(opts: {
  sourcePath: string    // local footage the segment plays from (already isolated)
  srcStart: number      // first segment's source start, in seconds
  durationSec: number   // how many seconds of matte to build (hook only)
  stageDir: string      // absolute dir inside remotion/public to write into
  publicPrefix: string  // stageDir expressed relative to remotion/public
  name?: string
}): Promise<SubjectMatte | null> {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) {
    console.log('[subject-matte] REPLICATE_API_TOKEN not set — hook caption will render in front')
    return null
  }
  const durationSec = Math.min(Math.max(opts.durationSec, 0.8), 4)
  if (durationSec < 0.8) return null

  const name = opts.name ?? 'matte'
  const tmpClip = path.join(opts.stageDir, `${name}-clip.mp4`)
  const tmpMask = path.join(opts.stageDir, `${name}-mask.mp4`)
  const outWebm = path.join(opts.stageDir, `${name}.webm`)

  try {
    fs.mkdirSync(opts.stageDir, { recursive: true })

    // Small, cheap clip for the model — the mask gets rescaled onto the full-res
    // clip afterwards, so 576px is plenty for a clean edge at phone sizes.
    await run(
      `ffmpeg -y -ss ${opts.srcStart.toFixed(3)} -t ${durationSec.toFixed(3)} -i "${opts.sourcePath}" ` +
      `-vf "scale=576:-2,fps=30" -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p -an "${tmpClip}"`,
    )

    // Lazy import so the app never pays for the SDK unless the feature is on.
    const { default: Replicate } = await import('replicate')
    const replicate = new Replicate({ auth: token })

    const output = await Promise.race([
      replicate.run(RVM_MODEL as `${string}/${string}:${string}`, {
        input: { input_video: fs.readFileSync(tmpClip), output_type: 'alpha-mask' },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`robust-video-matting timed out after ${OVERALL_TIMEOUT_MS / 1000}s`)), OVERALL_TIMEOUT_MS),
      ),
    ])

    // The client returns a FileOutput (or a bare URL string on older versions).
    const asAny = output as { url?: () => URL | string } | string
    const maskUrl = typeof asAny === 'string' ? asAny : String(asAny?.url?.() ?? asAny)
    if (!/^https?:\/\//.test(maskUrl)) throw new Error(`unexpected model output: ${maskUrl.slice(0, 120)}`)

    const res = await fetch(maskUrl, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`mask download failed: HTTP ${res.status}`)
    fs.writeFileSync(tmpMask, Buffer.from(await res.arrayBuffer()))

    // Merge mask + clip into a transparent VP9 webm (alpha needs auto-alt-ref 0).
    await run(
      `ffmpeg -y -i "${tmpClip}" -i "${tmpMask}" ` +
      `-filter_complex "[1:v]scale=576:-2,fps=30,format=gray[m];[0:v][m]alphamerge,format=yuva420p[out]" ` +
      `-map "[out]" -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 1.5M -an "${outWebm}"`,
      180_000,
    )
    if (!fs.existsSync(outWebm) || fs.statSync(outWebm).size < 10_000) throw new Error('alpha webm came out empty')

    console.log(`[subject-matte] hook matte ready (${durationSec.toFixed(1)}s)`)
    return { file: `${opts.publicPrefix}/${name}.webm`, durationSec }
  } catch (e) {
    console.warn('[subject-matte] matte failed, hook caption renders in front:', (e as Error).message)
    return null
  } finally {
    for (const f of [tmpClip, tmpMask]) { try { if (fs.existsSync(f)) fs.unlinkSync(f) } catch { /* best-effort */ } }
  }
}
