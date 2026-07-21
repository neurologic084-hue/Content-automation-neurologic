// ── Variant specs + Submagic resolver (V2) ────────────────────────────────────
// The V2 model splits every editing lever into two tiers (see
// lib/VARIANTS-V2-PLAN.md):
//   - LOCKED   — a variant's fixed creative identity (caption lane, zooms, intended
//                pace). This is the diversity Daniel picks from; it never drifts.
//   - ADAPTIVE — knobs the content profile is allowed to move, but only toward
//                "safe" (B-roll % ceilings, pace caps, zoom gating).
//
// resolveSubmagicSettings() combines a spec + a ContentProfile into concrete
// Submagic knobs. It is near-deterministic — the only non-lookup input is the
// caption templateName, which the caller resolves from the variant's lane (see
// the caption-lane classifier, built separately).
//
// This replaces the blind, text-only deriveSmartSubmagicSettings once wired in.

import type { ContentProfile } from './video-analysis'

export type Pace = 'natural' | 'fast' | 'extra-fast'
export type CaptionLane = 'minimal' | 'clean' | 'bold'

export interface VariantSpec {
  id: string
  name: string
  // The variant's fixed caption family. Resolved against the discovered Submagic
  // template pool, nudged by the profile's captionMood.
  captionLane: CaptionLane
  // When set, these exact Submagic template names are tried first (in order,
  // first one that exists on the account wins) before falling back to the
  // caption-lane classifier. Lets a variant pin a specific visual identity
  // (e.g. the aesthetic Umi/Gstaad family) instead of a fuzzy lane.
  templatePool?: string[]
  // A CUSTOM Submagic theme (built in their editor, PRO plan) — the only way to
  // get an exact caption style the built-in templates don't offer. Mutually
  // exclusive with templates on the API, so when set it wins over templatePool
  // and lane resolution entirely. Usually left unset here and supplied by env
  // instead (see submagicUserThemeId) so the client can retune the theme
  // without a deploy.
  userThemeId?: string
  locked: {
    magicZooms: boolean
    hookTitle: boolean
    basePace: Pace
  }
  adaptive: {
    // B-roll CEILING per richness. The profile can only pick DOWN this ladder —
    // never invent coverage the footage doesn't support.
    brollCeiling: { none: number; some: number; rich: number }
  }
  useMusic: boolean
}

// The Submagic-facing settings the resolver decides. Merges with SUBMAGIC_ALWAYS_ON
// (removeBadTakes / cleanAudio) at the call site; title / videoUrl / music are the
// caller's concern.
export interface ResolvedSubmagicSettings {
  templateName?: string
  userThemeId?: string
  magicBrolls: boolean
  magicBrollsPercentage: number
  magicZooms: boolean
  hookTitle: boolean | { text: string }
  removeSilencePace: Pace
}

// v1-v5. v6 skips Submagic entirely, so it has no spec. v4/v5 reuse the same
// resolver for their Submagic pass (their motion-graphics layer is separate).
export const VARIANT_SPECS: Record<string, VariantSpec> = {
  // Calm & Clean — Umi's small elegant captions (user-picked). All three
  // Submagic variants run extra-fast silence cutting by request; the
  // sensitivity gate still softens the pace on medical/emotional or
  // personal footage. B-roll maxed by request on all three Submagic
  // variants: 46-49% on every footage tier, always under 50.
  'our-v1': {
    id: 'our-v1',
    name: 'Calm & Clean',
    captionLane: 'clean',
    // Caption pool swapped (was Umi/Gstaad/Malta/Nema) after "the captions
    // cover her face" on v1. The API exposes no caption-position control, so
    // the template IS the only lever over how the text sits — and the owner's
    // call was to keep the zooms and change the font. Jack leads by the
    // owner's latest pick (they also tried "Kelly 3", which does not exist on the
    // account — Kelly 2 is the only Kelly). Kelly 2/Iman/Ali stay as the clean
    // backups, validated against the account's template list at submit time
    // like every pool. If the band still bothers her, the one
    // remaining lever is a custom theme made in the Submagic dashboard
    // (userThemeId) — captions can be dragged anywhere there.
    templatePool: ['Jack', 'Kelly 2', 'Iman', 'Ali'],
    locked: { magicZooms: true, hookTitle: false, basePace: 'extra-fast' },
    adaptive: { brollCeiling: { none: 46, some: 48, rich: 49 } },
    useMusic: true,
  },
  // UGC Aesthetic — Luke captions (user-picked; Beast/Ella as backup) with
  // punch-in zooms standing in for multi-angle cuts. B-roll comes from
  // Submagic's stock magicBrolls (plan-included, no AI credits). The plain-
  // footage tier is removed by request: 38% floor even on static footage.
  'our-v2': {
    id: 'our-v2',
    name: 'UGC Aesthetic',
    captionLane: 'bold',
    templatePool: ['Luke', 'Beast', 'Ella'],
    locked: { magicZooms: true, hookTitle: false, basePace: 'extra-fast' },
    adaptive: { brollCeiling: { none: 46, some: 48, rich: 49 } },
    useMusic: true,
  },
  // Creator Bold — Hormozi 3 captions (user-picked, other Hormozis as
  // backup), punchy pacing. B-roll ceilings run high on request — every tier
  // generous, never ≥50%.
  'our-v3': {
    id: 'our-v3',
    name: 'Creator Bold',
    captionLane: 'bold',
    templatePool: ['Hormozi 3', 'Hormozi 1', 'Hormozi 2', 'Hormozi 4', 'Hormozi 5'],
    locked: { magicZooms: true, hookTitle: false, basePace: 'extra-fast' },
    adaptive: { brollCeiling: { none: 46, some: 48, rich: 49 } },
    useMusic: true,
  },
  // v4/v5: the Remotion overlay carries the visual interest, so their Submagic
  // pass stays lighter (lower B-roll ceilings). Zooms follow the A/B split.
  'our-v4': {
    id: 'our-v4',
    name: 'Premium + Motion Graphics A',
    captionLane: 'minimal',
    locked: { magicZooms: true, hookTitle: false, basePace: 'natural' },
    adaptive: { brollCeiling: { none: 12, some: 24, rich: 34 } },
    useMusic: true,
  },
  'our-v5': {
    id: 'our-v5',
    name: 'Premium + Motion Graphics B',
    captionLane: 'bold',
    locked: { magicZooms: true, hookTitle: false, basePace: 'fast' },
    adaptive: { brollCeiling: { none: 16, some: 32, rich: 44 } },
    useMusic: true,
  },
}

// Guardrail 1: sensitivity caps how aggressive the pace is allowed to get, no
// matter what personality the variant wants.
function gatePace(base: Pace, sensitivity: ContentProfile['sensitivity']): Pace {
  if (sensitivity === 'medical_emotional') return 'natural'
  if (sensitivity === 'personal' && base === 'extra-fast') return 'fast'
  return base
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The custom Submagic theme to render this variant with, if one is configured.
 *
 *  WHY env and not a code constant: caption VERTICAL POSITION is not on the
 *  Submagic API. POST/PUT /v1/projects expose templateName, userThemeId,
 *  magicZooms, hookTitle{top,size}, disableCaptions — `top` there is the hook
 *  title only, and the caption layout is documented as rebuilt automatically.
 *  So the single supported way to move the caption band is a theme saved in
 *  Submagic's own editor, referenced by UUID. That UUID is account data the
 *  client owns and will re-cut by eye, so it belongs in config, not in a commit.
 *
 *  Client runbook for producing one (Submagic dashboard, PRO plan):
 *    1. Open any finished project → STYLE section.
 *    2. Pick the theme whose animation she wants (v1 currently renders Umi).
 *    3. Click EDIT, rename it (e.g. "Jessica v1 low"), and drag the
 *       "Position Y" slider DOWN until the captions clear her face on the
 *       tightest punch-in. Horizontal movement is not offered.
 *    4. CREATE THEME to save it to the account.
 *    5. Copy the theme's UUID and set SUBMAGIC_USER_THEME_ID_OUR_V1 to it
 *       (or SUBMAGIC_USER_THEME_ID to apply one theme to every variant).
 *
 *  A theme replaces the template outright — the API rejects both together — so
 *  setting this discards v1's Umi/Gstaad/Malta/Nema pool. That is the trade, and
 *  it is why this stays unset by default: with v1's zooms off the captions
 *  already clear her, and the theme is the escalation if she still wants them
 *  lower. A malformed value is ignored rather than sent, because Submagic
 *  rejects the whole submission on a bad UUID and the variant is lost.
 */
export function submagicUserThemeId(spec: VariantSpec): string | undefined {
  if (spec.userThemeId) return spec.userThemeId
  const perVariant = `SUBMAGIC_USER_THEME_ID_${spec.id.replace(/-/g, '_').toUpperCase()}`
  const raw = (process.env[perVariant] ?? process.env.SUBMAGIC_USER_THEME_ID ?? '').trim()
  if (!raw) return undefined
  if (!UUID_RE.test(raw)) {
    console.warn(`[variant-specs] ignoring non-UUID Submagic theme id for ${spec.id}: ${raw.slice(0, 16)}…`)
    return undefined
  }
  return raw
}

// Combine a variant's fixed identity with what the content profile actually
// supports. `templateName` is resolved upstream from the variant's caption lane.
export function resolveSubmagicSettings(
  spec: VariantSpec,
  profile: ContentProfile,
  opts: { templateName?: string } = {},
): ResolvedSubmagicSettings {
  const pace = gatePace(spec.locked.basePace, profile.sensitivity)

  // Guardrail 2: B-roll % = the variant's ceiling for this richness, never
  // more — and NEVER 50 or above, no matter what a future spec edit says.
  // The voice and the speaker's face stay the anchor of every edit.
  const brollPct = Math.min(spec.adaptive.brollCeiling[profile.brollableRichness], 49)

  // Guardrail 3: zooms only if the variant wants them AND framing has room —
  // push-ins on an already-tight face read as jitter, not energy, and a face
  // already sitting in the lower band gets pushed straight into the caption
  // band (fixed at ~60% down frame, unmovable from the API) when Submagic
  // scales and re-centres it. Both are the "captions cover her face" failure.
  const magicZooms = spec.locked.magicZooms
    && profile.faceFraming !== 'tight'
    && profile.faceArea !== 'lower'

  // Hook title only when the variant wants one, the hook lands, and we actually
  // have grounded text to show.
  const hookTitle = spec.locked.hookTitle && profile.hookStrength !== 'weak' && profile.suggestedHookTitle
    ? { text: profile.suggestedHookTitle }
    : false

  const userThemeId = submagicUserThemeId(spec)

  return {
    // The API rejects templateName + userThemeId together — a custom theme wins.
    templateName: userThemeId ? undefined : opts.templateName,
    userThemeId,
    magicBrolls: brollPct > 0,
    magicBrollsPercentage: brollPct,
    magicZooms,
    hookTitle,
    removeSilencePace: pace,
  }
}
