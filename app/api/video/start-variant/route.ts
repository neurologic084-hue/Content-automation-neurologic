import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchPipelineTask } from '@/lib/sandbox-tasks'
import { VARIANT_DEFINITIONS } from '@/lib/video-pipeline'
import { explainFailure } from '@/lib/error-explain'
import { patchVariant } from '@/lib/job-lock'
import { rendersDir } from '@/lib/paths'
import { normalizeBrollSource, normalizeBrollSetting } from '@/lib/broll'
import { SUBMAGIC_BROLL_PLAN_NAME } from '@/lib/motion-renderer'
import fs from 'fs'
import path from 'path'
import type { VideoVariant, CustomBrollEntry } from '@/lib/video-pipeline'

// In-process suppression of a duplicate start for the same variant. It used to
// be held for the whole inline Submagic submission and released in a `finally`;
// now that this handler only dispatches, releasing on exit would hold it for a
// millisecond and suppress nothing. So the key is kept for a short window after
// dispatch — long enough to swallow a double-click or a duplicate "Generate
// all" fan-out, which is all it ever caught — and dropped immediately if the
// dispatch itself threw, so the retry that follows is never blocked. It stays
// best-effort by nature (on Vercel two requests can land on different
// instances); the DB-level reuse check below is the part that survives
// restarts. Deliberately NOT a bail-on-'processing' check like the edit path
// uses: a variant left 'processing' with no external_id is exactly the failure
// mode being fixed here, and the user must be able to retry out of it.
const DUPLICATE_START_WINDOW_MS = 60_000
const activeSubmagicStarts = new Map<string, number>()

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

    // Custom B-roll is analysed AFTER the compressed source exists, so the
    // check above can pass while the creator's clips are still being described.
    // Starting inside that window used to render a perfectly good video that
    // silently contained NONE of her B-roll — the worst kind of failure,
    // because nothing looks broken. Every variant that will use her clips has
    // to wait: v4-v6 need the analysed windows, and v1-v3 (unless the picker
    // says stock-only) need the Submagic plan built from them, which lands
    // moments later in the same prep task.
    const usesCustomBroll = variant.tool !== 'submagic'
      || (normalizeBrollSource(variant.broll_source) !== 'stock'
        && normalizeBrollSetting(variant.broll_mode, variant.broll_percent).mode !== 'none')
    const pendingBroll = usesCustomBroll
      ? (job.custom_broll ?? null) as CustomBrollEntry[] | null
      : null
    if (pendingBroll?.length) {
      const prepared = pendingBroll.some(e => !!e.windows?.length)
      if (!prepared) {
        return NextResponse.json(
          { error: 'Your B-roll clips are still being prepared — give it a moment and try again.' },
          { status: 409 },
        )
      }
      if (variant.tool === 'submagic' && process.env.R2_PUBLIC_URL) {
        const planReady = await fetch(`${process.env.R2_PUBLIC_URL}/${jobId}/${SUBMAGIC_BROLL_PLAN_NAME}`, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5_000),
        }).then(r => r.ok).catch(() => false)
        if (!planReady) {
          return NextResponse.json(
            { error: 'Your B-roll clips are still being prepared — give it a moment and try again.' },
            { status: 409 },
          )
        }
      }
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
      { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null, auto_retries: 0, retry_at: null },
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

    const now = Date.now()
    const startedAt = activeSubmagicStarts.get(lockKey)
    if (startedAt !== undefined && now - startedAt < DUPLICATE_START_WINDOW_MS) {
      console.log(`[start-variant] Suppressed duplicate Submagic start for ${lockKey}`)
      return NextResponse.json({ ok: true, reused: true })
    }
    for (const [key, at] of activeSubmagicStarts) {
      if (now - at >= DUPLICATE_START_WINDOW_MS) activeSubmagicStarts.delete(key)
    }
    activeSubmagicStarts.set(lockKey, now)

    // Instant UI feedback, and the 'processing' stamp the stale sweep ages
    // from. external_id cleared so the status poller never polls a stale
    // Submagic project between this reset and the new projectId write.
    await patchVariant(
      supabase,
      jobId,
      variantId,
      { status: 'processing', external_id: null, preview_url: null, download_url: null, error: null, auto_retries: 0, retry_at: null, progress: { step: 1, total: 4, label: 'Sending your footage' } },
      { jobStatus: 'processing' },
    )

    // Preparing the footage and submitting it takes longer than the 300s cap on
    // this function for real client footage, so it runs as a pipeline task the
    // way v4-v6 renders do. Everything above is cheap and has to stay here: it
    // decides whether a start happens at all.
    try {
      await dispatchPipelineTask({ task: 'start-submagic', jobId, variantId, force: force === true })
    } catch (e) {
      activeSubmagicStarts.delete(lockKey)
      const detail = (e as Error).message || 'unknown error'
      console.error(`[start-variant] could not launch Submagic start for ${lockKey}:`, detail)
      await patchVariant(supabase, jobId, variantId, { status: 'failed', error: explainFailure(detail), progress: null })
      // Generic to the caller, matching the edit path above: the studio renders
      // this string verbatim, and a raw sandbox/dispatch error means nothing to
      // the creator. The explained version is already on the variant card.
      return NextResponse.json({ error: 'Could not start the render.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported tool.' }, { status: 400 })
}
