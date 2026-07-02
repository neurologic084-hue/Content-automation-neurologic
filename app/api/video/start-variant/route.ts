import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { startSingleVariant, retrieveAndStoreSubmagicResult, getSubmagicSourceUrl, ensureContentProfile } from '@/lib/motion-renderer'
import {
  deriveSmartSubmagicSettings,
  pickPremiumTemplates,
  resolveCaptionTemplate,
  resolvePooledTemplate,
  submitSubmagicJob,
  pollSubmagicJob,
  transcribeVideo,
  VARIANT_DEFINITIONS,
  SUBMAGIC_ALWAYS_ON,
} from '@/lib/video-pipeline'
import { VARIANT_SPECS, resolveSubmagicSettings } from '@/lib/variant-specs'
import { patchVariant } from '@/lib/job-lock'
import type { ContentProfile } from '@/lib/video-analysis'
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
  music: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null,
) {
  const db = supabaseAdmin()
  const INTERVAL_MS = 8_000
  const MAX_ATTEMPTS = 75  // ~10 minutes

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, INTERVAL_MS))

    const result = await pollSubmagicJob(projectId).catch(() => null)
    if (!result || result.status === 'processing') continue

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

    await patchVariant(
      db,
      jobId,
      variantId,
      result.status === 'ready'
        ? { status: 'ready', download_url: finalUrl, preview_url: finalUrl, error: null, progress: null }
        : { status: 'failed', error: result.error ?? 'Submagic failed', progress: null },
      { completeWhenAllDone: true },
    )
    return
  }

  // Timeout
  await patchVariant(db, jobId, variantId, { status: 'failed', error: 'Submagic timed out after 10 minutes', progress: null })
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
    // Guard against double-starts: if the variant is already actively running
    // (processing), bail out immediately -- the in-process active Set in
    // motion-renderer is also checked, but that resets on server restart while
    // this DB-level check survives restarts.
    if (variant.status === 'processing') {
      console.log(`[start-variant] ${variantId} already processing, skipping duplicate start`)
      return NextResponse.json({ ok: true, reused: true })
    }

    await patchVariant(
      supabase,
      jobId,
      variantId,
      { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null },
      { jobStatus: 'processing' },
    )

    const { data: scriptRow } = await supabase
      .from('scripts')
      .select('hook, cta, mood_tag, filming_plan')
      .eq('id', job.script_id)
      .single()

    const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

    // our-v4/our-v5 share the same two AI-picked premium (non-Hormozi) templates
    // so they read as a real side-by-side comparison rather than two random picks.
    // our-v6 never touches Submagic (Remotion-only edit), so it needs no template.
    let submagicTemplateName: string | undefined
    if (!variant.motionGraphicsTestOnly && !variant.remotionEdit) {
      const [tplA, tplB] = await pickPremiumTemplates()
      submagicTemplateName = variant.motionGraphicsStyle === 'bold' ? tplB : tplA
    }

    startSingleVariant(jobId, variantId, job.source_drive_url, {
      hook: scriptRow?.hook ?? '',
      cta: scriptRow?.cta ?? '',
      nativeCaptions: variant.nativeCaptions as boolean | undefined,
      moodTag: scriptRow?.mood_tag ?? null,
      scriptFormat,
      motionGraphicsTestOnly: variant.motionGraphicsTestOnly as boolean | undefined,
      remotionEdit: variant.remotionEdit as boolean | undefined,
      captionTestOnly: variant.captionTestOnly as boolean | undefined,
      motionGraphics: variant.motionGraphics as boolean | undefined,
      motionGraphicsStyle: variant.motionGraphicsStyle as 'minimal' | 'bold' | undefined,
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
      await patchVariant(
        supabase,
        jobId,
        variantId,
        { status: 'processing', preview_url: null, download_url: null, error: null, progress: { step: 1, total: 2, label: 'Submitting to Submagic' } },
        { jobStatus: 'processing' },
      )

      const { data: scriptRow } = await supabase
        .from('scripts')
        .select('hook, cta, mood_tag, filming_plan')
        .eq('id', job.script_id)
        .single()

      const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

      // Submagic always gets the compressed, normalized copy -- never the raw
      // Drive file. Cached per job, so every Submagic variant on this job
      // shares one compression + upload pass.
      const videoUrlForSubmagic = await getSubmagicSourceUrl(jobId, job.source_drive_url as string)
      let projectId: string
      // When set, our own library music is mixed onto the finished Submagic video
      // in post (pollSubmagicUntilDone) — so v2/v3 share the v4/v5 music system.
      let ourMusicCtx: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null

      if (preset.aiEditTemplate) {
        // Fully autonomous mode — Submagic controls everything itself, no
        // profile/settings/transcript analysis applies here.
        projectId = await submitSubmagicJob(videoUrlForSubmagic, {
          title: `${variantId}-${jobId.slice(0, 8)}`,
          aiEditTemplate: preset.aiEditTemplate,
        })
      } else {
        // V2 content-aware path (our-v1/v2/v3). The variant's fixed spec (caption
        // lane, zooms, pace) is combined with one Gemini read of the footage
        // (shared across variants, cached on the job) via resolveSubmagicSettings.
        // Falls back to the older text-only smart-settings path for any variant
        // without a V2 spec.
        const spec = VARIANT_SPECS[variantId]

        // Submagic renders WITHOUT its own music — we mix a mood-matched library
        // track in post (pollSubmagicUntilDone), same system as v4/v5. Music is
        // locked per variant (spec.useMusic); 'off' mode disables it everywhere.
        const musicOff = (variant.music_mode as MusicMode | undefined) === 'off'
        const wantsMusic = spec ? spec.useMusic : (variant.submagicProfile?.useMusic ?? true)
        if (!musicOff && wantsMusic) {
          ourMusicCtx = { hook: scriptRow?.hook ?? '', moodTag: scriptRow?.mood_tag ?? null, scriptFormat }
        }

        if (spec) {
          const profile = await ensureContentProfile(jobId, job.source_drive_url as string)
          // Give the post-Submagic music mix the same video understanding, so the
          // track is matched to what the footage actually is, not just the mood tag.
          if (ourMusicCtx) {
            ourMusicCtx.profile = profile
            ourMusicCtx.transcript = job.transcript as string | null
          }
          // A custom theme (exact caption style) needs no template resolution at
          // all. Otherwise a pinned template pool (e.g. the UGC Aesthetic Umi
          // family) wins over the fuzzy caption-lane classifier, with lane
          // resolution as the fallback.
          const templateName = spec.userThemeId
            ? undefined
            : (spec.templatePool ? await resolvePooledTemplate(spec.templatePool) : undefined)
              ?? await resolveCaptionTemplate(spec.captionLane, profile.captionMood)
          const resolved = resolveSubmagicSettings(spec, profile, { templateName })

          // ALWAYS_ON first, then the resolved knobs — so resolved.magicZooms
          // (a per-variant/guardrail decision now) wins over the baseline's
          // magicZooms:true instead of being forced back on.
          projectId = await submitSubmagicJob(videoUrlForSubmagic, {
            title: `${variantId}-${jobId.slice(0, 8)}`,
            ...SUBMAGIC_ALWAYS_ON,
            templateName: resolved.templateName,
            userThemeId: resolved.userThemeId,
            magicBrolls: resolved.magicBrolls,
            magicBrollsPercentage: resolved.magicBrollsPercentage,
            magicZooms: resolved.magicZooms,
            hookTitle: resolved.hookTitle,
            removeSilencePace: resolved.removeSilencePace,
          })
        } else {
          // Legacy fallback: written script + directive, no video understanding.
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

          const smart = await deriveSmartSubmagicSettings(
            {
              hook: scriptRow?.hook ?? '',
              cta: scriptRow?.cta ?? '',
              mood_tag: scriptRow?.mood_tag ?? null,
              script_format: scriptFormat,
            },
            { profileDirective: variant.submagicProfile?.directive, actualTranscript: actualTranscript ?? undefined },
          )

          projectId = await submitSubmagicJob(videoUrlForSubmagic, {
            title: `${variantId}-${jobId.slice(0, 8)}`,
            ...SUBMAGIC_ALWAYS_ON,
            templateName: smart.templateName,
            magicBrolls: smart.magicBrolls,
            magicBrollsPercentage: smart.magicBrollsPercentage,
            hookTitle: smart.hookTitle,
            removeSilencePace: smart.removeSilencePace,
          })
        }
      }

      // Save external_id immediately
      await patchVariant(supabase, jobId, variantId, {
        status: 'processing',
        external_id: projectId,
        progress: { step: 2, total: 2, label: 'Processing in Submagic' },
      })

      // Fire-and-forget poll loop (adds our library music in post when set)
      pollSubmagicUntilDone(jobId, variantId, projectId, ourMusicCtx).catch(e =>
        console.error('[start-variant] Submagic poll error:', e)
      )

      return NextResponse.json({ ok: true })
    } catch (e) {
      await patchVariant(supabase, jobId, variantId, { status: 'failed', error: (e as Error).message, progress: null })
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    } finally {
      activeSubmagicStarts.delete(lockKey)
    }
  }

  return NextResponse.json({ error: 'Unsupported tool.' }, { status: 400 })
}
