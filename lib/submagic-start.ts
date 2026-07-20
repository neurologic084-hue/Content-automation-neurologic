// ── Submagic variant launch (v1-v3) ───────────────────────────────────────────
// Everything between "the user pressed start" and "Submagic owns the project":
// source resolution (Drive download → compress → R2 upload), the footage
// profile and the submission itself.
//
// This used to run inline inside the start-variant POST handler. On real client
// footage it takes longer than the 300s cap vercel.json puts on app/api/**, so
// Vercel killed the function mid-flight — and because the handler had already
// flipped the variant to 'processing', nothing was left to write a failure.
// Production job ea334d47 lost v1/v2/v3 that way: 'processing', no external_id,
// no error, until the once-daily sweep noticed. It's a pipeline task now, the
// same shape v4-v6 have always used.

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { finalizeSubmagicVariant, getSubmagicSourceUrl, ensureContentProfile, SHARED_CUT_CLEAN_NAME } from './motion-renderer'
import {
  deriveSmartSubmagicSettings,
  resolveCaptionTemplate,
  resolvePooledTemplate,
  submitSubmagicJob,
  pollSubmagicJob,
  fetchSubmagicAudioTrack,
  transcribeVideo,
  VARIANT_DEFINITIONS,
  SUBMAGIC_ALWAYS_ON,
} from './video-pipeline'
import { VARIANT_SPECS, resolveSubmagicSettings } from './variant-specs'
import { normalizeBrollSetting, submagicBrollKnobs } from './broll'
import { explainFailure } from './error-explain'
import { patchVariant } from './job-lock'
import { STALE_MS } from './stale-sweep'
import type { ContentProfile } from './video-analysis'
import type { MusicMode, VideoVariant } from './video-pipeline'

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

async function pollSubmagicUntilDone(
  db: SupabaseClient,
  jobId: string,
  variantId: string,
  projectId: string,
  music: { hook: string; moodTag: string | null; scriptFormat?: string; profile?: ContentProfile | null; transcript?: string | null } | null = null,
) {
  const INTERVAL_MS = 8_000
  // Poll for as long as the render could legitimately still be alive. The old
  // ~10-minute cap predates this loop running to completion: on Vercel it died
  // with the lambda, so the cap never fired. On a long-lived host (Railway, any
  // VPS) this is now the in-process finisher and DOES run its full length — and
  // real client footage (clean-audio + magic B-roll + zooms on a 60-90s cut)
  // routinely renders past 10 minutes. Failing those at 10 min is exactly the
  // "submagic always fails" the client reports. Match the window to the system's
  // own definition of a definitively-dead render (STALE_MS) so a job Submagic is
  // still working on is never marked failed here.
  const MAX_ATTEMPTS = Math.ceil(STALE_MS / INTERVAL_MS)

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

    // Submagic itself reported a hard failure (not a transient poll blip —
    // pollSubmagicJob already absorbs those as 'processing'). Surface its REAL
    // reason on the card rather than a generic one.
    await patchVariant(
      db,
      jobId,
      variantId,
      { status: 'failed', error: explainFailure(result.error ?? 'The editing engine hit an error. Please retry this variant.'), progress: null },
      { completeWhenAllDone: true },
    )
    return
  }

  // Gave up polling before Submagic resolved. Deliberately do NOT mark this
  // 'failed': the render may still complete, and external_id is set — so the
  // status-route poll (or a reopened tab) can still finalize it, and the stale
  // sweep stays the single authority that declares a genuinely-dead render dead.
  // Writing 'failed' here instead both throws away a render that finishes late
  // and mislabels a live render as broken (the two bugs this whole path fights).
  console.warn(`[submagic-start] ${jobId}:${variantId} still rendering after ${Math.round(STALE_MS / 60000)}m of polling — leaving finalisation to the status poll / stale sweep`)
}

async function submitVariant(db: SupabaseClient, jobId: string, variantId: string): Promise<void> {
  const { data: job } = await db.from('video_jobs').select('*').eq('id', jobId).single()
  if (!job) throw new Error(`job ${jobId} not found`)

  const stored = ((job.variants ?? []) as VideoVariant[]).find(v => v.id === variantId)
  const currentDefinition = VARIANT_DEFINITIONS.find(v => v.id === variantId)
  const variant = (stored && currentDefinition ? { ...stored, ...currentDefinition } : stored) as VideoVariant | undefined
  if (!variant) throw new Error(`variant ${variantId} not found on job ${jobId}`)

  const preset = variant.submagicPreset ?? {}

  const { data: scriptRow } = await db
    .from('scripts')
    .select('hook, cta, mood_tag, filming_plan')
    .eq('id', job.script_id)
    .single()

  const scriptFormat = (scriptRow?.filming_plan as { script_format?: string } | null)?.script_format

  // Submagic always gets the compressed, normalized copy -- never the raw
  // Drive file. Cached per job, so every Submagic variant on this job
  // shares one compression + upload pass.
  const videoUrlForSubmagic = await getSubmagicSourceUrl(jobId, job.source_drive_url as string)
  // WHAT HAS PREP ALREADY DONE? Submagic must only be asked for the work that
  // is still outstanding — anything else is either wasted spend or a second
  // pass over audio/cuts that were already handled, which degrades them.
  // The filename carries the answer, so this survives a restart and needs no
  // extra database round trip:
  //   source-cut-clean.mp4 → trimmed AND cleaned by us
  //   source-cut.mp4       → trimmed by us, audio still raw
  //   anything else        → untouched compressed source
  const isPrecutClean = videoUrlForSubmagic.endsWith(`/${SHARED_CUT_CLEAN_NAME}`)
  const isPrecut = isPrecutClean || videoUrlForSubmagic.endsWith('/source-cut.mp4')
  const precutOverrides = {
    // Trimmed already: dial Submagic's silence removal to its gentlest and turn
    // off bad-take removal so it only styles. Cutting an already-cut file
    // double-cuts it.
    ...(isPrecut ? { removeSilencePace: 'natural' as const, removeBadTakes: false } : {}),
    // Cleaned already (Auphonic, measured ~14 dB below the raw noise floor):
    // Submagic's Clean Audio would run aggressive denoise over aggressive
    // denoise. When we have NOT cleaned it, leave Submagic's cleaner ON — that
    // is the whole point of checking rather than assuming.
    ...(isPrecutClean ? { cleanAudio: false } : {}),
  }
  console.log(
    `[submagic-start] ${variantId} checklist — trimmed ${isPrecut ? '✓ by us' : '✗ Submagic will cut'} | ` +
    `audio ${isPrecutClean ? '✓ cleaned by us (Submagic clean OFF)' : '✗ raw (Submagic clean ON)'}`,
  )
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
      console.warn('[submagic-start] no Submagic audio track available — rendering without music')
    }

    // The studio's per-job B-roll AMOUNT governs v1-v3 too, matching the
    // Remotion variants: 'smart' keeps the footage-adaptive amount below,
    // 'manual' forces the exact percent onto Submagic's stock B-roll, and
    // 'none' turns every cutaway off.
    const brollSetting = normalizeBrollSetting(variant.broll_mode, variant.broll_percent)
    if (brollSetting.mode !== 'smart') {
      console.log(`[submagic-start] B-roll mode for ${variantId}: ${brollSetting.mode}${brollSetting.percent !== null ? ` (${brollSetting.percent}%)` : ''}`)
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
      //
      // variant.broll_source ('both' | 'custom' | 'stock') is read NOWHERE on
      // this path, on purpose: v1-v3 always use Submagic's own stock B-roll.
      // The creator's clips had to be timed against the pre-cut source
      // Submagic receives, and any mismatch made Submagic reject the whole
      // submission — losing the variant outright — while hosting and
      // registering each clip pushed this task toward the 300s cap. The
      // source picker still steers the Motion Lab variants (v4-v6); don't
      // wire it back in here.
      const brollKnobs = submagicBrollKnobs(brollSetting, resolved)
      projectId = await submitSubmagicJob(videoUrlForSubmagic, {
        title: `${variantId}-${jobId.slice(0, 8)}`,
        ...SUBMAGIC_ALWAYS_ON,
        templateName: resolved.templateName,
        userThemeId: resolved.userThemeId,
        magicBrolls: brollKnobs.magicBrolls,
        magicBrollsPercentage: brollKnobs.magicBrollsPercentage,
        magicZooms: resolved.magicZooms,
        hookTitle: resolved.hookTitle,
        removeSilencePace: resolved.removeSilencePace,
        musicTrackId,
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
            await db.from('video_jobs').update({ transcript: actualTranscript }).eq('id', jobId)
          }
        } catch (e) {
          console.warn('[submagic-start] transcription failed, falling back to script text only:', (e as Error).message)
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
  await patchVariant(db, jobId, variantId, {
    status: 'processing',
    external_id: projectId,
    // v1-v3 are already cut by our own planner before this point, so the
    // engine here only adds captions + styling — say exactly that.
    progress: { step: 2, total: 4, label: 'Adding captions & styling' },
  })

  // Fire-and-forget poll loop, unchanged from when this lived in the route: it
  // only ever completes on a host that outlives the caller (local dev / VPS).
  // On Vercel it died with the lambda then and dies with the worker VM now —
  // the status route's own Submagic poll is the canonical finisher there, and
  // awaiting this instead would let its 10-minute cap fail a variant the engine
  // is still legitimately rendering.
  // For v1-v3 the post step also mixes our library music onto the finished file
  // (postMusic); the aiEditTemplate/legacy paths pass null and keep Submagic's
  // own audio.
  pollSubmagicUntilDone(db, jobId, variantId, projectId, postMusic).catch(e =>
    console.error('[submagic-start] Submagic poll error:', e)
  )
}

/** Prepares the footage and hands one Submagic variant (v1-v3) to the engine.
 *  Runs in a worker with no user session, so it re-reads the job/variant itself
 *  through the admin client. Never throws: anything that goes wrong lands on the
 *  variant as a failure, because a task that dies silently is exactly the bug
 *  this function exists to fix. */
export async function startSubmagicVariantTask(jobId: string, variantId: string, force = false): Promise<void> {
  let db: ReturnType<typeof supabaseAdmin>
  try {
    db = supabaseAdmin()
  } catch (e) {
    // Nothing else can run without a client, and there is no way to record the
    // failure on the variant either — so at least make it loud in the task log
    // rather than exiting silently and leaving the card spinning until the sweep.
    console.error(`[submagic-start] ${jobId}:${variantId} could not reach Supabase:`, (e as Error).message)
    throw e
  }
  console.log(`[submagic-start] starting ${jobId}:${variantId}${force ? ' (forced)' : ''}`)
  try {
    // Idempotency guard, and the only one that actually holds: the route's
    // in-process lock lives in a different process from this task and expires on
    // a timer, so two clicks far enough apart both arrive here. Submitting twice
    // bills two Submagic renders for one variant, and the second projectId
    // overwrites the first — orphaning a render that was already paid for.
    // Re-read immediately before submitting; `force` is the studio's explicit
    // "render it again" and is the one case allowed through.
    if (!force) {
      const { data: row } = await db.from('video_jobs').select('variants').eq('id', jobId).single()
      const existing = ((row?.variants ?? []) as VideoVariant[]).find(v => v.id === variantId)
      if (existing?.external_id) {
        console.log(`[submagic-start] ${jobId}:${variantId} already has project ${existing.external_id} — not submitting again`)
        return
      }
    }
    await submitVariant(db, jobId, variantId)
  } catch (e) {
    console.error(`[submagic-start] ${jobId}:${variantId} failed:`, (e as Error).message)
    await patchVariant(db, jobId, variantId, { status: 'failed', error: explainFailure(e), progress: null })
  }
}
