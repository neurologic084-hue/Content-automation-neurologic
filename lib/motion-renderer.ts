import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { transcribeVideo, pollSubmagicJob } from './video-pipeline'
import { tryUploadToStorage, storageFileName } from './storage'
import type { VideoVariant } from './video-pipeline'

const active = new Set<string>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

function run(cmd: string, timeoutMs = 300_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = exec(cmd, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()))
    proc.stderr?.on('data', (d) => process.stdout.write(`[ffmpeg] ${d}`))
  })
}

function runHF(args: string, timeoutMs = 600_000): Promise<void> {
  const hfBin = path.join(process.cwd(), 'node_modules/.bin/hyperframes')
  return new Promise((resolve, reject) => {
    exec(`"${hfBin}" ${args}`, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()))
  })
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`)
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

function detectFont(): string {
  const candidates = [
    '/System/Library/Fonts/Helvetica.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? ''
}

async function markVariant(
  jobId: string,
  variantId: string,
  status: 'ready' | 'failed',
  downloadUrl: string | null,
  error: string | null
) {
  const db = supabaseAdmin()
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  if (!job?.variants) return

  const variants = (job.variants as VideoVariant[]).map((v) =>
    v.id === variantId
      ? { ...v, status, download_url: downloadUrl, preview_url: downloadUrl, error }
      : v
  )

  const allDone = variants.every((v) => v.status === 'ready' || v.status === 'failed')
  await db
    .from('video_jobs')
    .update({ variants, ...(allDone ? { status: 'complete' } : {}) })
    .eq('id', jobId)
}

// Upload to Supabase Storage, fall back to local path, then mark variant ready.
async function finishVariant(
  jobId: string,
  variantId: string,
  localPath: string
) {
  const storageUrl = await tryUploadToStorage(localPath, storageFileName(variantId), jobId)
  const url = storageUrl ?? `/renders/${jobId}/${path.basename(localPath)}`
  await markVariant(jobId, variantId, 'ready', url, null)
}

// ── Background music generation (ElevenLabs Sound Effects API) ───────────────

// Generate a background music MP3 via ElevenLabs Sound Generation and cache it
// locally for the job. Returns null if music is not configured.
async function generateBackgroundMusic(outDir: string, moodTag?: string): Promise<string | null> {
  const prompt = process.env.BACKGROUND_MUSIC_PROMPT
  const fallbackUrl = process.env.BACKGROUND_MUSIC_URL
  const destPath = path.join(outDir, 'background_music.mp3')

  // ElevenLabs Sound Generation — prompt-based music
  if (prompt && process.env.ELEVENLABS_API_KEY) {
    const moodHint = moodTag ? `, ${moodTag} mood` : ''
    const fullPrompt = `${prompt}${moodHint}`
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: fullPrompt,
          duration_seconds: 22,   // max for ElevenLabs, looped by FFmpeg
          prompt_influence: 0.5,
        }),
      })
      if (res.ok) {
        fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()))
        return destPath
      }
    } catch { /* fall through */ }
  }

  // Direct MP3 URL fallback
  if (fallbackUrl) {
    try {
      await downloadFile(fallbackUrl, destPath)
      return destPath
    } catch { /* fall through */ }
  }

  return null
}

// Mix a pre-generated music file into a video file (in-place replacement).
// musicPath: local path to the MP3 (from generateBackgroundMusic).
async function mixMusic(videoPath: string, musicPath: string | null): Promise<void> {
  if (!musicPath || !fs.existsSync(musicPath)) return

  const tmpPath = videoPath.replace(/\.mp4$/, '_music_tmp.mp4')
  try {
    await run(
      `ffmpeg -y -i "${videoPath}" -i "${musicPath}" ` +
      `-filter_complex "[1:a]volume=0.15,aloop=loop=-1:size=2e+09[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]" ` +
      `-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tmpPath}"`
    )
    fs.renameSync(tmpPath, videoPath)
  } catch {
    // music mixing is best-effort
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
  }
}

// ── HyperFrames overlay compositor ───────────────────────────────────────────

async function hfComposite(opts: {
  templateDir: string
  sourceVideo: string
  outputPath: string
  variables: Record<string, unknown>
  resolution?: 'portrait' | 'square' | 'landscape'
}): Promise<void> {
  const { templateDir, sourceVideo, outputPath, variables, resolution = 'portrait' } = opts
  const overlayPath = outputPath.replace(/\.mp4$/, '_hf_overlay.mov')

  const varsJson = JSON.stringify(variables).replace(/'/g, "\\'")

  await runHF(
    `render "${templateDir}" ` +
    `--variables '${varsJson}' ` +
    `--format mov ` +
    `--resolution ${resolution} ` +
    `--quiet ` +
    `-o "${overlayPath}"`
  )

  await run(
    `ffmpeg -y -i "${sourceVideo}" -i "${overlayPath}" ` +
    `-filter_complex "[0:v][1:v]overlay=0:0[v]" ` +
    `-map "[v]" -map 0:a ` +
    `-c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`
  )

  if (fs.existsSync(overlayPath)) fs.unlinkSync(overlayPath)
}

// ── Submagic polling + Drive upload ──────────────────────────────────────────
// Polls each Submagic variant until done, downloads the output, uploads to Drive.

async function pollAndUploadSubmagic(jobId: string, outDir: string) {
  const db = supabaseAdmin()
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  if (!job?.variants) return

  const submagicVariants = (job.variants as VideoVariant[]).filter(
    (v) => v.external_id && (v.status === 'processing' || v.status === 'pending')
  )
  if (!submagicVariants.length) return

  await Promise.allSettled(
    submagicVariants.map(async (v) => {
      const projectId = v.external_id!
      let attempts = 0
      const MAX_ATTEMPTS = 60   // 60 * 20s = 20 min max wait
      const POLL_INTERVAL = 20_000

      while (attempts < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        attempts++

        const result = await pollSubmagicJob(projectId).catch(() => null)
        if (!result) continue

        if (result.status === 'failed') {
          await markVariant(jobId, v.id, 'failed', null, result.error)
          return
        }

        if (result.status === 'ready' && result.downloadUrl) {
          // Download Submagic output locally, then upload to Supabase Storage
          const localPath = path.join(outDir, `${v.id}.mp4`)
          try {
            await downloadFile(result.downloadUrl, localPath)
            await finishVariant(jobId, v.id, localPath)
          } catch {
            // Storage upload failed — use Submagic's CDN URL directly
            await markVariant(jobId, v.id, 'ready', result.downloadUrl, null)
          }
          return
        }
      }

      await markVariant(jobId, v.id, 'failed', null, 'Submagic job timed out after 20 minutes')
    })
  )
}

// ── Variant IDs ───────────────────────────────────────────────────────────────

const HF_VARIANT_IDS = [
  'liquid-glass', 'branded', 'broll-med', 'broll-life', 'cinematic', 'format-916', 'format-11',
]

// ── Public API ────────────────────────────────────────────────────────────────

export async function startMotionRender(
  jobId: string,
  sourceUrl: string,
  brollMed: string[],
  brollLife: string[],
  clinicName: string,
  tagline: string,
  hook?: string,
  cta?: string,
  words?: { text: string; start: number; end: number }[]
) {
  if (active.has(jobId)) return
  active.add(jobId)
  renderAll(jobId, sourceUrl, brollMed, brollLife, clinicName, tagline, hook ?? '', cta ?? '', words ?? [])
    .catch((e) => console.error('[motion-renderer] fatal:', e))
    .finally(() => active.delete(jobId))
}

// ── Core renderer ─────────────────────────────────────────────────────────────

async function renderAll(
  jobId: string,
  sourceUrl: string,
  brollMed: string[],
  brollLife: string[],
  clinicName: string,
  tagline: string,
  hook: string,
  cta: string,
  words: { text: string; start: number; end: number }[]
) {
  const outDir = path.join(process.cwd(), 'public', 'renders', jobId)
  fs.mkdirSync(outDir, { recursive: true })

  const inputPath = path.join(outDir, 'source.mp4')

  try {
    await downloadFile(sourceUrl, inputPath)
  } catch (e) {
    const msg = `Could not download source video: ${(e as Error).message}`
    for (const id of HF_VARIANT_IDS) await markVariant(jobId, id, 'failed', null, msg)
    return
  }

  // Load script mood for music prompt tuning, then generate music + transcribe in parallel
  const db2 = supabaseAdmin()
  const { data: jobRow } = await db2.from('video_jobs').select('script_id').eq('id', jobId).single()
  let moodTag: string | undefined
  if (jobRow?.script_id) {
    const { data: script } = await db2.from('scripts').select('mood_tag').eq('id', jobRow.script_id).single()
    moodTag = script?.mood_tag ?? undefined
  }

  // Generate background music (ElevenLabs) + transcription run concurrently
  const [musicPath, transcriptResult] = await Promise.all([
    generateBackgroundMusic(outDir, moodTag).catch(() => null),
    (async () => {
      if (words.length || !process.env.ELEVENLABS_API_KEY) return null
      try { return await transcribeVideo(sourceUrl) } catch { return null }
    })(),
  ])

  const resolvedWords = transcriptResult?.words ?? words

  // HyperFrames variants + Submagic polling all run concurrently
  await Promise.all([
    // 7 HyperFrames/FFmpeg variants
    renderLiquidGlass(jobId, inputPath, outDir, hook, cta, resolvedWords),
    renderBranded(jobId, inputPath, outDir, clinicName, tagline, hook),
    renderBroll(jobId, inputPath, outDir, brollMed, 'broll-med', musicPath),
    renderBroll(jobId, inputPath, outDir, brollLife, 'broll-life', musicPath),
    renderCinematic(jobId, inputPath, outDir, hook, cta, musicPath),
    renderFormat916(jobId, inputPath, outDir),
    renderFormat11(jobId, inputPath, outDir),
    // 3 Submagic variants — poll until done then upload to Drive
    pollAndUploadSubmagic(jobId, outDir),
  ])
}

// ── Liquid Glass ──────────────────────────────────────────────────────────────

async function renderLiquidGlass(
  jobId: string,
  inputPath: string,
  outDir: string,
  hook: string,
  cta: string,
  words: { text: string; start: number; end: number }[]
) {
  const outputPath = path.join(outDir, 'liquid-glass.mp4')
  const templateDir = path.join(process.cwd(), 'public', 'hf-templates', 'liquid-glass')

  try {
    await hfComposite({
      templateDir,
      sourceVideo: inputPath,
      outputPath,
      variables: { hook, cta, words },
      resolution: 'portrait',
    })
    await finishVariant(jobId, 'liquid-glass', outputPath)
  } catch {
    try {
      const font = detectFont()
      const fa = font ? `:fontfile=${font}` : ''
      const safeHook = hook.replace(/'/g, '').replace(/:/g, '\\:').slice(0, 80)
      const filter = [
        `drawbox=y=ih*3/4:color=#FFFFFF@0.15:width=iw:height=ih/4:t=fill`,
        `drawtext=text='${safeHook || 'Watch till the end'}':x=(w-tw)/2:y=h*3/4+60:fontsize=48:fontcolor=white${fa}`,
      ].join(',')
      await run(`ffmpeg -y -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`)
      await finishVariant(jobId, 'liquid-glass', outputPath)
    } catch (e2) {
      await markVariant(jobId, 'liquid-glass', 'failed', null, (e2 as Error).message)
    }
  }
}

// ── Branded ───────────────────────────────────────────────────────────────────

async function renderBranded(
  jobId: string,
  inputPath: string,
  outDir: string,
  clinicName: string,
  tagline: string,
  hook: string
) {
  const outputPath = path.join(outDir, 'branded.mp4')
  const templateDir = path.join(process.cwd(), 'public', 'hf-templates', 'branded')

  try {
    await hfComposite({
      templateDir,
      sourceVideo: inputPath,
      outputPath,
      variables: { clinicName, tagline, hook },
      resolution: 'portrait',
    })
    await finishVariant(jobId, 'branded', outputPath)
  } catch {
    try {
      const font = detectFont()
      const fa = font ? `:fontfile=${font}` : ''
      const safeName = clinicName.replace(/'/g, '').replace(/:/g, '\\:')
      const safeSub  = tagline.replace(/'/g, '').replace(/:/g, '\\:')
      const filter = [
        `drawbox=y=ih-320:color=#FF4F17@0.92:width=iw:height=320:t=fill`,
        `drawtext=text='${safeName}':x=60:y=h-260:fontsize=56:fontcolor=white${fa}`,
        `drawtext=text='${safeSub}':x=60:y=h-188:fontsize=30:fontcolor=white@0.9${fa}`,
      ].join(',')
      await run(`ffmpeg -y -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`)
      await finishVariant(jobId, 'branded', outputPath)
    } catch (e2) {
      await markVariant(jobId, 'branded', 'failed', null, (e2 as Error).message)
    }
  }
}

// ── B-Roll ────────────────────────────────────────────────────────────────────

async function renderBroll(
  jobId: string,
  inputPath: string,
  outDir: string,
  clips: string[],
  variantId: 'broll-med' | 'broll-life',
  musicPath: string | null
) {
  const outputPath = path.join(outDir, `${variantId}.mp4`)

  try {
    if (!clips.length) {
      fs.copyFileSync(inputPath, outputPath)
      await finishVariant(jobId, variantId, outputPath)
      return
    }

    const clipsToUse = clips.slice(0, 4)
    const listPath = path.join(outDir, `${variantId}_list.txt`)
    const entries: string[] = [`file '${inputPath}'`]

    for (let i = 0; i < clipsToUse.length; i++) {
      const clipPath = path.join(outDir, `${variantId}_clip_${i}.mp4`)
      try {
        await downloadFile(clipsToUse[i], clipPath)
        const normPath = path.join(outDir, `${variantId}_clip_norm_${i}.mp4`)
        await run(
          `ffmpeg -y -i "${clipPath}" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" ` +
          `-r 30 -c:v libx264 -preset fast -crf 23 -an "${normPath}"`
        )
        entries.push(`file '${normPath}'`)
      } catch { /* skip unavailable clip */ }
    }

    fs.writeFileSync(listPath, entries.join('\n'))
    await run(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -preset fast -crf 22 -c:a aac "${outputPath}"`)
    await mixMusic(outputPath, musicPath)
    await finishVariant(jobId, variantId, outputPath)
  } catch (e) {
    await markVariant(jobId, variantId, 'failed', null, (e as Error).message)
  }
}

// ── Cinematic ─────────────────────────────────────────────────────────────────

async function renderCinematic(
  jobId: string,
  inputPath: string,
  outDir: string,
  hook: string,
  cta: string,
  musicPath: string | null
) {
  const outputPath = path.join(outDir, 'cinematic.mp4')
  const templateDir = path.join(process.cwd(), 'public', 'hf-templates', 'cinematic')

  try {
    const gradedPath = path.join(outDir, 'cinematic_graded.mp4')
    await run(
      `ffmpeg -y -i "${inputPath}" ` +
      `-vf "eq=saturation=0.8:contrast=1.05:brightness=-0.02,vignette=PI/5" ` +
      `-c:v libx264 -preset fast -crf 22 -c:a copy "${gradedPath}"`
    )
    await hfComposite({
      templateDir,
      sourceVideo: gradedPath,
      outputPath,
      variables: { hook, cta },
      resolution: 'portrait',
    })
    if (fs.existsSync(gradedPath)) fs.unlinkSync(gradedPath)
    await mixMusic(outputPath, musicPath)
    await finishVariant(jobId, 'cinematic', outputPath)
  } catch {
    try {
      const filter = [
        `eq=saturation=0.82:contrast=1.05`,
        `vignette=PI/5`,
        `drawbox=y=0:color=black:width=iw:height=ih/14:t=fill`,
        `drawbox=y=ih-ih/14:color=black:width=iw:height=ih/14:t=fill`,
      ].join(',')
      await run(`ffmpeg -y -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`)
      await mixMusic(outputPath, musicPath)
      await finishVariant(jobId, 'cinematic', outputPath)
    } catch (e2) {
      await markVariant(jobId, 'cinematic', 'failed', null, (e2 as Error).message)
    }
  }
}

// ── Format: 9:16 Vertical ─────────────────────────────────────────────────────

async function renderFormat916(jobId: string, inputPath: string, outDir: string) {
  const outputPath = path.join(outDir, 'format-916.mp4')
  try {
    await run(
      `ffmpeg -y -i "${inputPath}" ` +
      `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black" ` +
      `-c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`
    )
    await finishVariant(jobId, 'format-916', outputPath)
  } catch (e) {
    await markVariant(jobId, 'format-916', 'failed', null, (e as Error).message)
  }
}

// ── Format: 1:1 Square ────────────────────────────────────────────────────────

async function renderFormat11(jobId: string, inputPath: string, outDir: string) {
  const outputPath = path.join(outDir, 'format-11.mp4')
  try {
    await run(
      `ffmpeg -y -i "${inputPath}" ` +
      `-vf "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:color=black" ` +
      `-c:v libx264 -preset fast -crf 22 -c:a copy "${outputPath}"`
    )
    await finishVariant(jobId, 'format-11', outputPath)
  } catch (e) {
    await markVariant(jobId, 'format-11', 'failed', null, (e as Error).message)
  }
}
