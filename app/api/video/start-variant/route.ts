import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { startSingleVariant, prepareSubmagicCustomBrollSource, retrieveAndStoreSubmagicResult } from '@/lib/motion-renderer'
import {
  deriveSmartSubmagicSettings,
  pickPremiumTemplates,
  submitSubmagicJob,
  pollSubmagicJob,
  transcribeVideo,
  VARIANT_DEFINITIONS,
  SUBMAGIC_ALWAYS_ON,
} from '@/lib/video-pipeline'
import type { MusicMode, VideoVariant } from '@/lib/video-pipeline'

function supabaseAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const activeSubmagicStarts = new Set<string>()

async function pollSubmagicUntilDone(
  jobId: string,
  variantId: string,
  projectId: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string } | null = null,
) {
  const db = supabaseAdmin()
  const INTERVAL_MS = 8_000
  const MAX_ATTEMPTS = 75  // ~10 minutes

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    const result = await pollSubmagicJob(projectId).catch(() => null)
    if (!result || result.status === 'processing') continue

    const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
    if (!job?.variants) return

    let finalUrl: string | null = result.downloadUrl
    if (result.status === 'ready' && result.downloadUrl) {
      try {
        finalUrl = await retrieveAndStoreSubmagicResult(jobId, variantId, result.downloadUrl, music)
        console.log(`[start-variant] Submagic result retrieved into Olympus storage for ${jobId}:${variantId}`)
      } catch (e) {
        console.warn(`[start-variant] could not retrieve Submagic result, keeping their hosted URL:`, (e as Error).message)
        // Fall back to Submagic's own URL rather than failing the variant —
        // still playable, just not pulled into our own storage this time.
      }
    }

    const variants = (job.variants as VideoVariant[]).map(v => {
      if (v.id !== variantId) return v
      if (result.status === 'ready') {
        return { ...v, status: 'ready', download_url: finalUrl, preview_url: finalUrl, error: null, progress: null }
      }
      return { ...v, status: 'failed', error: result.error ?? 'Submagic failed', progress: null }
    })

    const allDone = variants.every(v => v.status === 'ready' || v.status === 'failed')
    await db.from('video_jobs').update({ variants, ...(allDone ? { status: 'complete' } : {}) }).eq('id', jobId)
    return
  }

  // Timeout
  const { data: job } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
  if (!job?.variants) return
  const variants = (job.variants as VideoVariant[]).map(v =>
    v.id === variantId ? { ...v, status: 'failed', error: 'Submagic timed out after 10 minutes', progress: null } : v
  )
  await db.from('video_jobs').update({ variants }).eq('id', jobId)
}

export async function POST(req: NextRequest) {
  const { jobId, variantId } = await req.json()

  if (!jobId || !variantId) {
    return NextResponse.json({ error: 'Missing jobId or variantId.' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: job, error } = await supabase
    .from('video_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }

  const storedVariant = (job.variants ?? []).find((v: VideoVariant) => v.id === variantId)
  const currentDefinition = VARIANT_DEFINITIONS.find(v => v.id === variantId)
  const variant = storedVariant && currentDefinition
    ? { ...storedVariant, ...currentDefinition }
    : storedVariant
  if (!variant) {
    return NextResponse.json({ error: 'Variant not found.' }, { status: 400 })
  }

  if (variant.tool === 'edit') {
    const variants: VideoVariant[] = (job.variants ?? []).map((v: VideoVariant) =>
      v.id === variantId
        ? { ...v, status: 'processing', external_id: null, preview_url: null, download_url: null, error: null }
        : v
    )
    await supabase.from('video_jobs').update({ variants, status: 'processing' }).eq('id', jobId)

    const { data: scriptRow } = await supabase
      .from('scripts')
      .select('hook, cta, mood_tag, filming_plan')
      .eq('id', job.script_id)
      .single()

    const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

    // our-v4/our-v5 share the same two AI-picked premium (non-Hormozi) templates
    // so they read as a real side-by-side comparison rather than two random picks.
    let submagicTemplateName: string | undefined
    if (variant.submagicCutOnly) {
      const [tplA, tplB] = await pickPremiumTemplates()
      submagicTemplateName = variant.motionGraphicsStyle === 'bold' ? tplB : tplA
    }

    startSingleVariant(jobId, variantId, job.source_drive_url, {
      hook: scriptRow?.hook ?? '',
      cta: scriptRow?.cta ?? '',
      descriptBroll: variant.descriptBroll as boolean | undefined,
      descriptCaptions: variant.descriptCaptions as boolean | undefined,
      brollDriveUrl: variant.brollDriveUrl as string | undefined,
      nativeCaptions: variant.nativeCaptions as boolean | undefined,
      moodTag: scriptRow?.mood_tag ?? null,
      scriptFormat,
      captionTestOnly: variant.captionTestOnly as boolean | undefined,
      motionGraphics: variant.motionGraphics as boolean | undefined,
      motionGraphicsStyle: variant.motionGraphicsStyle as 'minimal' | 'bold' | undefined,
      submagicCutOnly: variant.submagicCutOnly as boolean | undefined,
      submagicTemplateName,
      submagicMagicBrolls: variant.submagicMagicBrolls as boolean | undefined,
      submagicMagicZooms: variant.submagicMagicZooms as boolean | undefined,
      musicMode: variant.music_mode as MusicMode | undefined,
    })

    return NextResponse.json({ ok: true })
  }

  if (variant.tool === 'submagic') {
    const preset = variant.submagicPreset ?? {}
    const lockKey = `${jobId}:${variantId}`

    if (variant.external_id && (variant.status === 'processing' || variant.status === 'ready')) {
      console.log(`[start-variant] Reusing existing Submagic project for ${lockKey}: ${variant.external_id}`)
      return NextResponse.json({ ok: true, reused: true, projectId: variant.external_id })
    }

    if (activeSubmagicStarts.has(lockKey)) {
      console.log(`[start-variant] Suppressed duplicate Submagic start for ${lockKey}`)
      return NextResponse.json({ ok: true, reused: true })
    }

    activeSubmagicStarts.add(lockKey)
    try {
      const processing = (job.variants as VideoVariant[]).map((v: VideoVariant) =>
        v.id === variantId
          ? { ...v, status: 'processing', preview_url: null, download_url: null, error: null, progress: { step: 1, total: 2, label: 'Submitting to Submagic' } }
          : v
      )
      await supabase.from('video_jobs').update({ variants: processing, status: 'processing' }).eq('id', jobId)

      const { data: scriptRow } = await supabase
        .from('scripts')
        .select('hook, cta, mood_tag, filming_plan')
        .eq('id', job.script_id)
        .single()

      const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

      let videoUrlForSubmagic = job.source_drive_url as string
      let projectId: string
      // When set, our own library music is mixed onto the finished Submagic video
      // in post (pollSubmagicUntilDone) — so v2/v3 share the v4/v5 music system.
      let ourMusicCtx: { hook: string; moodTag: string | null; scriptFormat?: string } | null = null

      if (preset.aiEditTemplate) {
        // Fully autonomous mode — Submagic controls everything itself, no
        // profile/settings/transcript analysis applies here.
        projectId = await submitSubmagicJob(videoUrlForSubmagic, {
          title: `${variantId}-${jobId.slice(0, 8)}`,
          aiEditTemplate: preset.aiEditTemplate,
        })
      } else {
        // Profile-driven path (our-v1/v2/v3): get the ACTUAL spoken transcript
        // from the footage, not just the written script — creators sometimes
        // improvise on camera. Cached on the job row so starting a 2nd or 3rd
        // Submagic variant on the same job doesn't re-transcribe.
        let actualTranscript = job.transcript as string | null
        if (!actualTranscript) {
          try {
            const transcribed = await transcribeVideo(videoUrlForSubmagic)
            actualTranscript = transcribed.transcript || null
            if (actualTranscript) {
              await supabase.from('video_jobs').update({ transcript: actualTranscript }).eq('id', jobId)
            }
          } catch (e) {
            console.warn('[start-variant] transcription failed, falling back to script text only:', (e as Error).message)
          }
        }

        const profile = variant.submagicProfile
        const smart = await deriveSmartSubmagicSettings(
          {
            hook: scriptRow?.hook ?? '',
            cta: scriptRow?.cta ?? '',
            mood_tag: scriptRow?.mood_tag ?? null,
            script_format: scriptFormat,
          },
          { profileDirective: profile?.directive, actualTranscript: actualTranscript ?? undefined },
        )

        // Custom B-roll (job-level Drive footage) takes priority over Submagic's
        // own auto-B-roll — insert it ourselves via FFmpeg and disable magicBrolls
        // to avoid stacking two B-roll passes.
        const brollDriveUrl = (variant as { brollDriveUrl?: string }).brollDriveUrl
        let useMagicBrolls = smart.magicBrolls
        if (brollDriveUrl) {
          await supabase.from('video_jobs').update({
            variants: (job.variants as VideoVariant[]).map((v) =>
              v.id === variantId ? { ...v, progress: { step: 1, total: 2, label: 'Inserting custom B-roll' } } : v
            ),
          }).eq('id', jobId)
          videoUrlForSubmagic = await prepareSubmagicCustomBrollSource(
            jobId, videoUrlForSubmagic, brollDriveUrl, scriptRow?.hook ?? '', scriptRow?.cta ?? '',
          )
          useMagicBrolls = false
        }

        // Submagic renders WITHOUT its own music — we add a mood-matched track
        // from our own library in post (pollSubmagicUntilDone), so v2/v3 get the
        // same music system as v4/v5. v1's profile has useMusic:false, so it stays
        // voice-only; 'off' mode disables music everywhere.
        const musicOff = (variant.music_mode as MusicMode | undefined) === 'off'
        if (!musicOff && (profile?.useMusic ?? true)) {
          ourMusicCtx = { hook: scriptRow?.hook ?? '', moodTag: scriptRow?.mood_tag ?? null, scriptFormat }
        }

        projectId = await submitSubmagicJob(videoUrlForSubmagic, {
          title: `${variantId}-${jobId.slice(0, 8)}`,
          templateName: smart.templateName,
          magicBrolls: useMagicBrolls,
          magicBrollsPercentage: smart.magicBrollsPercentage,
          hookTitle: smart.hookTitle,
          removeSilencePace: smart.removeSilencePace,
          ...SUBMAGIC_ALWAYS_ON,
        })
      }

      // Save external_id immediately
      const withExternal = (job.variants as VideoVariant[]).map((v: VideoVariant) =>
        v.id === variantId ? { ...v, status: 'processing', external_id: projectId, progress: { step: 2, total: 2, label: 'Processing in Submagic' } } : v
      )
      await supabase.from('video_jobs').update({ variants: withExternal }).eq('id', jobId)

      // Fire-and-forget poll loop (adds our library music in post when set)
      pollSubmagicUntilDone(jobId, variantId, projectId, ourMusicCtx).catch(e =>
        console.error('[start-variant] Submagic poll error:', e)
      )

      return NextResponse.json({ ok: true })
    } catch (e) {
      const failed = (job.variants as VideoVariant[]).map((v: VideoVariant) =>
        v.id === variantId ? { ...v, status: 'failed', error: (e as Error).message, progress: null } : v
      )
      await supabase.from('video_jobs').update({ variants: failed }).eq('id', jobId)
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    } finally {
      activeSubmagicStarts.delete(lockKey)
    }
  }

  return NextResponse.json({ error: 'Unsupported tool.' }, { status: 400 })
}
