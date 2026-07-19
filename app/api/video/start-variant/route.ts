import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { finalizeSubmagicVariant, getSubmagicSourceUrl, ensureContentProfile } from '@/lib/motion-renderer'
import { dispatchPipelineTask } from '@/lib/sandbox-tasks'
import {
  deriveSmartSubmagicSettings,
  pickPremiumTemplates,
  resolveCaptionTemplate,
  resolvePooledTemplate,
  submitSubmagicJob,
  pollSubmagicJob,
  fetchSubmagicAudioTrack,
  transcribeVideo,
  VARIANT_DEFINITIONS,
  SUBMAGIC_ALWAYS_ON,
} from '@/lib/video-pipeline'
import { VARIANT_SPECS, resolveSubmagicSettings } from '@/lib/variant-specs'
import { normalizeBrollSetting, submagicBrollKnobs } from '@/lib/broll'
import { explainFailure } from '@/lib/error-explain'
import { patchVariant } from '@/lib/job-lock'
import { rendersDir } from '@/lib/paths'
import fs from 'fs'
import path from 'path'
import type { ContentProfile } from '@/lib/video-analysis'
import type { MusicMode, VideoVariant, CustomBrollEntry } from '@/lib/video-pipeline'

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

    if (result.status === 'ready' && result.downloadUrl) {
      // Single canonical finisher (shared with the status route): retrieval,
      // SFX/frame post-steps, R2 upload, and the ready write all live there.
      await finalizeSubmagicVariant(jobId, variantId, result.downloadUrl, music)
      return
    }

    await patchVariant(
      db,
      jobId,
      variantId,
      { status: 'failed', error: explainFailure(result.error ?? 'The editing engine hit an error. Please retry this variant.'), progress: null },
      { completeWhenAllDone: true },
    )
    return
  }

  // Timeout
  await patchVariant(db, jobId, variantId, { status: 'failed', error: 'The edit took too long and timed out. Please retry this variant.', progress: null })
}

export async function POST(req: NextRequest) {
  const { jobId, variantId, force } = await req.json()

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

  // Source-prep guard: starting a variant while prepare-source is still running
  // spawns a second prep of the same footage (observed under test: duplicate
  // transcription spend + a tmp-rename crash surfacing a raw ENOENT to the
  // user). Within the prep window, only allow a start once the compressed
  // source exists locally (in-process mode) or in R2 (cross-process). After the
  // grace window, let it through — the render task self-heals from R2/Drive,
  // and blocking forever on a failed best-effort R2 backup would be worse than
  // the race. A prep that already failed terminally skips the guard so its
  // retry isn't told to keep waiting.
  const SOURCE_PREP_GRACE_MS = 12 * 60 * 1000
  const prepFailed = variant.status === 'failed' && (variant.error ?? '').startsWith('Could not prepare the footage')
  if (!prepFailed && Date.now() - new Date(job.created_at).getTime() < SOURCE_PREP_GRACE_MS) {
    let sourceReady = fs.existsSync(path.join(rendersDir(jobId), 'source-compressed.mp4'))
    if (!sourceReady && process.env.R2_PUBLIC_URL) {
      sourceReady = await fetch(`${process.env.R2_PUBLIC_URL}/${jobId}/source-compressed.mp4`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      }).then(r => r.ok).catch(() => false)
    }
    if (!sourceReady) {
      return NextResponse.json(
        { error: 'The footage is still being prepared — give it a moment and try again.' },
        { status: 409 },
      )
    }
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

    // Instant UI feedback; the task patches again on start (harmless repeat).
    await patchVariant(
      supabase,
      jobId,
      variantId,
      { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null },
      { jobStatus: 'processing' },
    )

    // The whole render (option building included) is a pipeline task —
    // in-process here on a long-lived server, in a Sandbox VM on Vercel. If the
    // launch itself fails (sandbox quota, git clone, missing env), surface it as
    // a failed variant immediately — otherwise it sits 'processing' with no
    // progress until the 45-min sweep, with no Retry available meanwhile.
    try {
      await dispatchPipelineTask({ task: 'render-variant', jobId, variantId })
    } catch (e) {
      const detail = (e as Error).message || 'unknown error'
      console.error(`[start-variant] could not launch render for ${jobId}:${variantId}:`, detail)
      // explainFailure turns the raw launch error into a clear cause (e.g. Vercel
      // billing cap, GitHub dispatch/token issue). Full detail stays in the logs.
      await patchVariant(supabase, jobId, variantId, {
        status: 'failed',
        error: explainFailure(detail),
        progress: null,
      })
      return NextResponse.json({ error: 'Could not start the render.' }, { status: 500 })
    }

    // The VM launched. Stamp a progress marker NOW so (a) the card shows movement
    // during the multi-minute bootstrap (npm ci ×2 + Chrome deps + browser
    // download, which emit no progress of their own) and (b) the fast
    // "never reported in" sweep can't false-fail a slow-but-alive bootstrap — it
    // only ever catches a variant that never got this far. The render task
    // overrides this with real steps as soon as it runs.
    await patchVariant(supabase, jobId, variantId, {
      progress: { step: 1, total: 6, label: 'Setting up render environment' },
    })

    return NextResponse.json({ ok: true })
  }

  if (variant.tool === 'submagic') {
    const preset = variant.submagicPreset ?? {}
    const lockKey = `${jobId}:${variantId}`

    // A finished variant normally reuses its Submagic project (no double
    // spend on accidental re-clicks). force=true (the studio's retry button
    // on a ready variant) skips the reuse and submits a fresh render —
    // a variant that's actively processing is never force-restarted.
    const forceRegenerate = force === true && variant.status === 'ready'
    if (!forceRegenerate && variant.external_id && (variant.status === 'processing' || variant.status === 'ready')) {
      console.log(`[start-variant] Reusing existing Submagic project for ${lockKey}: ${variant.external_id}`)
      return NextResponse.json({ ok: true, reused: true, projectId: variant.external_id })
    }
    if (forceRegenerate) console.log(`[start-variant] force regeneration for ${lockKey}`)

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
        // external_id cleared so the status poller never polls a stale
        // Submagic project between this reset and the new projectId write.
        { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null, progress: { step: 1, total: 4, label: 'Sending your footage' } },
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
      // When the source was pre-cut by our own planner (source-cut.mp4), Submagic
      // must NOT cut again: dial silence removal to its gentlest and turn off
      // bad-take removal so it only adds captions + zoom styling. If the pre-cut
      // step didn't run, Submagic cuts on its own exactly as before.
      const isPrecut = videoUrlForSubmagic.endsWith('/source-cut.mp4')
      const precutOverrides = isPrecut
        ? { removeSilencePace: 'natural' as const, removeBadTakes: false }
        : {}
      if (isPrecut) console.log(`[start-variant] ${variantId}: using pre-cut source — Submagic styles only`)
      let projectId: string
      // Local-library music to mix on top AFTER Submagic finishes (v1-v3). Stays
      // null for the autonomous aiEditTemplate + legacy paths, which keep
      // Submagic's own in-render audio.
      let postMusic:
        | { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null }
        | null = null

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

        // v1-v3 (the spec path) now get their music from OUR local library,
        // mixed on top of the FINISHED Submagic video — the exact same system
        // v4/v5 use (mood match, best-part offset, voice ducking, -13 LUFS).
        // Submagic itself renders silent for them: no music track is sent, and
        // mixBackgroundMusic runs in the post step (retrieveAndStoreSubmagicResult).
        // The legacy fallback (no spec) has no ContentProfile to match a track
        // against, so it keeps Submagic's own in-render library as before.
        // Music is locked per variant (spec.useMusic); 'off' mode disables it.
        const musicOff = (variant.music_mode as MusicMode | undefined) === 'off'
        const wantsMusic = spec ? spec.useMusic : (variant.submagicProfile?.useMusic ?? true)
        const useLibraryMusic = !!spec && !musicOff && wantsMusic

        // Only the legacy (no-spec) path still pulls a Submagic-hosted track.
        const musicTrackId = !musicOff && wantsMusic && !useLibraryMusic
          ? await fetchSubmagicAudioTrack(scriptRow?.mood_tag ?? null) ?? undefined
          : undefined
        if (!musicOff && wantsMusic && !useLibraryMusic && !musicTrackId) {
          console.warn('[start-variant] no Submagic audio track available — rendering without music')
        }

        // The studio's per-job B-roll setting governs v1-v3 too, matching the
        // Remotion variants: 'smart' keeps the footage-adaptive amount below,
        // 'manual' forces the exact percent onto Submagic's stock B-roll, and
        // 'none' turns every cutaway off — creator-supplied clips included.
        const brollSetting = normalizeBrollSetting(variant.broll_mode, variant.broll_percent)
        if (brollSetting.mode !== 'smart') {
          console.log(`[start-variant] B-roll mode for ${variantId}: ${brollSetting.mode}${brollSetting.percent !== null ? ` (${brollSetting.percent}%)` : ''}`)
        }

        if (spec) {
          const profile = await ensureContentProfile(jobId, job.source_drive_url as string)
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
          // Creator-supplied B-roll: the prepare-source task uploaded each
          // clip to Submagic user-media and planned transcript-matched
          // placements. Turn those into timed items and turn STOCK B-roll
          // off — the creator's clips fully replace generated footage.
          const customEntries = brollSetting.mode === 'none'
            ? null
            : (job.custom_broll ?? null) as CustomBrollEntry[] | null
          // Placements are only valid for the timeline they were measured on.
          // We send source-cut.mp4 when it exists, and it is materially shorter
          // than the compressed source, so items timed on the wrong one land on
          // the wrong words — or run past the end, which makes Submagic reject
          // the whole submission (observed: every v1-v3 failed with no project
          // ever created). On a mismatch, drop the items and render without
          // them rather than fail the variant.
          const wantBasis: 'cut' | 'full' = isPrecut ? 'cut' : 'full'
          const usableEntries = (customEntries ?? []).filter(
            e => (e.placementBasis ?? 'full') === wantBasis,
          )
          if ((customEntries?.length ?? 0) > 0 && usableEntries.length === 0) {
            console.warn(
              `[start-variant] custom B-roll placements were timed on the '${customEntries![0]?.placementBasis ?? 'full'}' source but this render sends the '${wantBasis}' one — skipping them (re-run source prep to re-time)`,
            )
          }
          const customItems = usableEntries
            .filter(e => e.submagicMediaId && e.placements?.length)
            .flatMap(e => e.placements!.map(p => ({
              type: 'user-media' as const,
              startTime: p.start,
              endTime: p.end,
              userMediaId: e.submagicMediaId!,
              layout: 'full',
            })))
            .sort((a, b) => a.startTime - b.startTime)
          if (customItems.length) {
            console.log(`[start-variant] using ${customItems.length} custom B-roll item(s), stock B-roll off`)
          }

          projectId = await submitSubmagicJob(videoUrlForSubmagic, {
            title: `${variantId}-${jobId.slice(0, 8)}`,
            ...SUBMAGIC_ALWAYS_ON,
            templateName: resolved.templateName,
            userThemeId: resolved.userThemeId,
            magicBrolls: customItems.length ? false : submagicBrollKnobs(brollSetting, resolved).magicBrolls,
            magicBrollsPercentage: customItems.length ? undefined : submagicBrollKnobs(brollSetting, resolved).magicBrollsPercentage,
            magicZooms: resolved.magicZooms,
            hookTitle: resolved.hookTitle,
            removeSilencePace: resolved.removeSilencePace,
            musicTrackId,
            ...(customItems.length ? { items: customItems } : {}),
            ...precutOverrides,
          })

          // Music comes from our library AFTER Submagic returns — same matcher
          // inputs as v4/v5: Gemini's footage profile + null transcript, with a
          // per-variant shortlist pick. Runs in retrieveAndStoreSubmagicResult.
          if (useLibraryMusic) {
            postMusic = {
              hook: scriptRow?.hook ?? '',
              moodTag: scriptRow?.mood_tag ?? null,
              scriptFormat,
              profile,
              transcript: null,
            }
          }
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
            magicBrolls: submagicBrollKnobs(brollSetting, smart).magicBrolls,
            magicBrollsPercentage: submagicBrollKnobs(brollSetting, smart).magicBrollsPercentage,
            hookTitle: smart.hookTitle,
            removeSilencePace: smart.removeSilencePace,
            musicTrackId,
            ...precutOverrides,
          })
        }
      }

      // Save external_id immediately
      await patchVariant(supabase, jobId, variantId, {
        status: 'processing',
        external_id: projectId,
        // v1-v3 are already cut by our own planner before this point, so the
        // engine here only adds captions + styling — say exactly that.
        progress: { step: 2, total: 4, label: 'Adding captions & styling' },
      })

      // Fire-and-forget poll loop. For v1-v3 the post step also mixes our library
      // music onto the finished file (postMusic); the aiEditTemplate/legacy paths
      // pass null and keep Submagic's own audio.
      pollSubmagicUntilDone(jobId, variantId, projectId, postMusic).catch(e =>
        console.error('[start-variant] Submagic poll error:', e)
      )

      return NextResponse.json({ ok: true })
    } catch (e) {
      await patchVariant(supabase, jobId, variantId, { status: 'failed', error: explainFailure(e), progress: null })
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    } finally {
      activeSubmagicStarts.delete(lockKey)
    }
  }

  return NextResponse.json({ error: 'Unsupported tool.' }, { status: 400 })
}
