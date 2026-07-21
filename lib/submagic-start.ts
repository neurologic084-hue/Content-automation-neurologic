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
import { finalizeSubmagicVariant, getSubmagicSourceUrl, ensureContentProfile, refreshPrecutForRetry, SHARED_CUT_CLEAN_NAME, loadSubmagicBrollPlan } from './motion-renderer'
import {
  deriveSmartSubmagicSettings,
  resolveCaptionTemplate,
  resolvePooledTemplate,
  submitSubmagicJob,
  pollSubmagicJob,
  fetchSubmagicAudioTrack,
  transcribeVideo,
  checkSubmagicMediaReady,
  VARIANT_DEFINITIONS,
  SUBMAGIC_ALWAYS_ON,
} from './video-pipeline'
import { VARIANT_SPECS, resolveSubmagicSettings } from './variant-specs'
import { normalizeBrollSetting, normalizeBrollSource, submagicBrollKnobs } from './broll'
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

async function submitVariant(db: SupabaseClient, jobId: string, variantId: string, force = false): Promise<void> {
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

  // A RETRY means "do this properly with what the app knows now". v4-v6 get
  // that for free — they cut in-render, so every rule change applies on the
  // next run. v1-v3 render from a pre-cut FILE, so without this an old job
  // keeps shipping the cut it was given when it was created, however much the
  // editing rules have improved since. Rebuild it first; the clean, the
  // transcript and the analysis all self-skip, so this is a local re-encode
  // and no paid calls.
  if (force) await refreshPrecutForRetry(jobId, job.source_drive_url as string)

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
  // The custom-B-roll outcome for the card, written with the external_id patch
  // below — null clears a previous run's notice, so a retry that DOES use her
  // clips stops claiming otherwise.
  let brollNotice: string | null = null

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
      const brollKnobs = submagicBrollKnobs(brollSetting, resolved)

      // ── Creator's own B-roll (broll_source: 'both' | 'custom' | 'stock') ──
      // The plan (content-matched placements on the CUT file's timeline, each
      // backed by a Submagic user-media id) was built once in source prep —
      // this path only READS it, so nothing here scales with clip count. The
      // 2026-07-08 version registered clips inline right here and collapsed
      // 'both' to custom-only; both mistakes are structural now, not policed.
      const brollSource = normalizeBrollSource(variant.broll_source)
      const hasCustomClips = !!(job.custom_broll as unknown[] | null)?.length
      let customItems: NonNullable<Parameters<typeof submitSubmagicJob>[1]['items']> = []
      let planCutSeconds = 0
      if (hasCustomClips && brollSource !== 'stock' && brollSetting.mode !== 'none') {
        const plan = await loadSubmagicBrollPlan(jobId)
        // The plan's timings are only valid on the file they were planned
        // against. If the source resolver picked a different file (older cut,
        // prep raced, cut rebuilt), sending them would place cutaways on the
        // wrong moments — or past the end, which fails the whole submission.
        if (!plan) {
          brollNotice = brollSource === 'custom'
            ? 'Your clips could not be prepared in time, so this render has no B-roll cutaways.'
            : 'Your clips could not be prepared in time, so this render uses stock B-roll only.'
          console.warn(`[submagic-start] ${variantId}: no custom B-roll plan — ${brollSource === 'custom' ? 'rendering without B-roll' : 'stock only'}`)
        } else if (!plan.items.length) {
          // The planner ran and matched nothing (or prep wrote an empty plan
          // because the clips could not be used) — a correct answer, not a
          // failure. Daniel's rule: use her clips when they make sense,
          // otherwise it's fine. Checked BEFORE the basis guard: an empty plan
          // carries no timings, so "wrong timeline" would be the wrong message.
          brollNotice = brollSource === 'custom'
            ? 'None of your clips matched what is being said in this video, so it has no B-roll cutaways.'
            : 'None of your clips matched what is being said in this video, so it uses stock B-roll only.'
          console.log(`[submagic-start] ${variantId}: planner placed none of her clips — ${brollSource === 'custom' ? 'no cutaways' : 'stock only'}`)
        } else if (!videoUrlForSubmagic.endsWith(`/${plan.basis}`)) {
          brollNotice = brollSource === 'custom'
            ? 'Your clips were timed against a different cut of this footage, so this render has no B-roll cutaways. Retry the variant to rebuild them.'
            : 'Your clips were timed against a different cut of this footage, so this render uses stock B-roll only. Retry the variant to rebuild them.'
          console.warn(`[submagic-start] ${variantId}: plan basis ${plan.basis} does not match the submitted file — dropping custom items`)
        } else {
          planCutSeconds = plan.cutSeconds
          customItems = plan.items.map(i => ({
            type: 'user-media' as const,
            startTime: Number(i.start.toFixed(2)),
            endTime: Number((i.start + i.duration).toFixed(2)),
            userMediaId: i.userMediaId,
            // 'cover' fills the frame like the Motion Lab cutaways. NOT 'full':
            // Submagic rejects that value and fails the whole submission.
            layout: 'cover',
          }))

          // Last line of defense against the render-stall failure: an item
          // whose media never finished ingesting (or has since been deleted
          // from the library) hangs Submagic's chunk renderer until the WHOLE
          // render aborts. One list call regardless of item count; fails OPEN
          // on null so a flaky list read never strips a healthy render.
          const readiness = await checkSubmagicMediaReady([...new Set(customItems.map(i => i.userMediaId))])
          if (readiness) {
            const before = customItems.length
            customItems = customItems.filter(i => readiness.get(i.userMediaId))
            if (customItems.length < before) {
              console.warn(`[submagic-start] ${variantId}: dropped ${before - customItems.length}/${before} item(s) whose media is not ingested`)
            }
            if (!customItems.length) {
              brollNotice = brollSource === 'custom'
                ? 'Your clips have not finished uploading to the editing engine, so this render has no B-roll cutaways. Retry the variant to use them.'
                : 'Your clips have not finished uploading to the editing engine, so this render uses stock B-roll only. Retry the variant to use them.'
            }
          }
        }
      }

      // Stock knobs, mode-aware. 'both' genuinely mixes: her placed clips go
      // in as items and magicBrolls stays ON, with its percentage scaled DOWN
      // by the share of the timeline her clips already cover — so the mix
      // adapts to how well her folder fits this script instead of a fixed
      // 50/50. 'custom' turns stock off entirely.
      let magicBrolls = brollKnobs.magicBrolls
      let magicBrollsPercentage = brollKnobs.magicBrollsPercentage
      if (customItems.length) {
        if (brollSource === 'custom') {
          magicBrolls = false
          magicBrollsPercentage = undefined
        } else {
          const customSeconds = customItems.reduce((s, i) => s + (i.endTime - i.startTime), 0)
          const coveredPct = planCutSeconds ? Math.round((customSeconds / planCutSeconds) * 100) : 0
          const remaining = Math.max(0, (magicBrollsPercentage ?? 16) - coveredPct)
          // Below ~4% Submagic would be placing one token clip at best — at
          // that point her clips have covered what the video wanted.
          if (!magicBrolls || remaining < 4) {
            magicBrolls = false
            magicBrollsPercentage = undefined
          } else {
            magicBrollsPercentage = Math.min(remaining, 49)
          }
          console.log(`[submagic-start] ${variantId}: 'both' mix — ${customItems.length} of her clip(s) covering ~${coveredPct}%, stock ${magicBrolls ? `${magicBrollsPercentage}%` : 'off'}`)
        }
      }

      const submitOnce = (withItems: boolean) => submitSubmagicJob(videoUrlForSubmagic, {
        title: `${variantId}-${jobId.slice(0, 8)}`,
        ...SUBMAGIC_ALWAYS_ON,
        templateName: resolved.templateName,
        userThemeId: resolved.userThemeId,
        // Without items (the degrade path), stock reverts to the plain knobs —
        // except in 'custom' mode, where she asked for no stock at all.
        magicBrolls: withItems ? magicBrolls : (brollSource === 'custom' && hasCustomClips ? false : brollKnobs.magicBrolls),
        magicBrollsPercentage: withItems ? magicBrollsPercentage : (brollSource === 'custom' && hasCustomClips ? undefined : brollKnobs.magicBrollsPercentage),
        magicZooms: resolved.magicZooms,
        hookTitle: resolved.hookTitle,
        removeSilencePace: resolved.removeSilencePace,
        musicTrackId,
        ...precutOverrides,
        ...(withItems && customItems.length ? { items: customItems } : {}),
      })

      if (customItems.length) {
        // Degrade ladder, never a dead render: a submission with items can fail
        // because a user-media registration is still ingesting on Submagic's
        // side. One short retry covers that; after it, submit WITHOUT items so
        // the variant ships rather than dying over cutaways.
        try {
          projectId = await submitOnce(true)
          console.log(`[submagic-start] ${variantId}: submitted with ${customItems.length} custom B-roll item(s)`)
        } catch (e) {
          console.warn(`[submagic-start] ${variantId}: submit with custom items failed (${(e as Error).message.slice(0, 200)}) — retrying once in 15s`)
          await new Promise(r => setTimeout(r, 15_000))
          try {
            projectId = await submitOnce(true)
            console.log(`[submagic-start] ${variantId}: submitted with ${customItems.length} custom B-roll item(s) on retry`)
          } catch (e2) {
            console.warn(`[submagic-start] ${variantId}: custom items rejected twice — submitting without them: ${(e2 as Error).message.slice(0, 200)}`)
            projectId = await submitOnce(false)
            brollNotice = brollSource === 'custom'
              ? 'The editing engine rejected your clips this time, so this render has no B-roll cutaways.'
              : 'The editing engine rejected your clips this time, so this render uses stock B-roll only.'
          }
        }
      } else {
        projectId = await submitOnce(false)
      }

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

  // Save external_id immediately — one write, nothing between the submit and
  // this patch, so a crash can't orphan a render that was already paid for.
  // The B-roll notice rides along rather than costing its own round trip.
  await patchVariant(db, jobId, variantId, {
    status: 'processing',
    external_id: projectId,
    broll_notice: brollNotice,
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
    // Heartbeat through the submission phase. Everything in submitVariant —
    // source resolution, the retry re-cut, registering + submitting to Submagic
    // — runs under the "Sending your footage" label with no updates, so a slow
    // or wedged step looked frozen for up to the 45-min sweep. A ticking
    // progress.at means the card shows life AND the stale sweep can tell a dead
    // task (beats stop) from a slow one (beats continue) in minutes, not 45.
    const beat = setInterval(() => {
      void patchVariant(db, jobId, variantId, {
        progress: { step: 1, total: 4, label: 'Preparing your footage', at: new Date().toISOString() },
      }).catch(() => {})
    }, 30_000)
    beat.unref?.()
    try {
      await submitVariant(db, jobId, variantId, force)
    } finally {
      clearInterval(beat)
    }
  } catch (e) {
    console.error(`[submagic-start] ${jobId}:${variantId} failed:`, (e as Error).message)
    await patchVariant(db, jobId, variantId, { status: 'failed', error: explainFailure(e), progress: null })
  }
}
