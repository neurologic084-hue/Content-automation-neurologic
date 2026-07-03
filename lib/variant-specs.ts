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
  // and lane resolution entirely.
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
  'our-v1': {
    id: 'our-v1',
    name: 'Calm & Clean',
    captionLane: 'minimal',
    locked: { magicZooms: false, hookTitle: false, basePace: 'natural' },
    adaptive: { brollCeiling: { none: 6, some: 16, rich: 24 } },
    useMusic: false,
  },
  // UGC Aesthetic — modeled on the reference edit ("Multiple Shots, Voice
  // Isolation, No Music, Photo B Roll"): small elegant captions with italic
  // accent words (Umi family) and punch-in zooms standing in for multi-angle
  // cuts. B-roll comes from Submagic's stock magicBrolls (plan-included, no AI
  // credits). Music mixes in post from our library, quiet under the voice.
  'our-v2': {
    id: 'our-v2',
    name: 'UGC Aesthetic',
    captionLane: 'clean',
    templatePool: ['Umi', 'Gstaad', 'Malta', 'Nema'],
    locked: { magicZooms: true, hookTitle: false, basePace: 'fast' },
    adaptive: { brollCeiling: { none: 20, some: 30, rich: 40 } },
    useMusic: true,
  },
  // UGC Reference — the closest Submagic-path match to the V1 reference edit
  // ("Multiple Shots, Voice Isolation, No Music, Photo B Roll"). Captions come
  // from the account's custom "Kelly 3" theme (built in the Submagic editor to
  // match the reference's italic blue/silver style); punch-in zooms stand in
  // for its multi-angle cuts, stock cutaways at the same coverage. Music stays
  // on (deliberate departure from the reference). NOTE: while userThemeId is
  // set the templatePool below is ignored — remove the userThemeId line to fall
  // back to the built-in aesthetic templates.
  'our-v3': {
    id: 'our-v3',
    name: 'UGC Reference',
    captionLane: 'clean',
    userThemeId: '12e601c8-eb43-4af5-937f-9086b0a9da4d', // "Kelly 3" custom theme
    templatePool: ['Gstaad', 'Malta', 'Nema', 'Umi'],
    locked: { magicZooms: true, hookTitle: false, basePace: 'fast' },
    adaptive: { brollCeiling: { none: 20, some: 30, rich: 40 } },
    useMusic: true,
  },
  // v4/v5: the Remotion overlay carries the visual interest, so their Submagic
  // pass stays lighter (lower B-roll ceilings). Zooms follow the A/B split.
  'our-v4': {
    id: 'our-v4',
    name: 'Premium + Motion Graphics A',
    captionLane: 'minimal',
    locked: { magicZooms: false, hookTitle: false, basePace: 'natural' },
    adaptive: { brollCeiling: { none: 8, some: 18, rich: 28 } },
    useMusic: true,
  },
  'our-v5': {
    id: 'our-v5',
    name: 'Premium + Motion Graphics B',
    captionLane: 'bold',
    locked: { magicZooms: true, hookTitle: false, basePace: 'fast' },
    adaptive: { brollCeiling: { none: 12, some: 26, rich: 38 } },
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

// Combine a variant's fixed identity with what the content profile actually
// supports. `templateName` is resolved upstream from the variant's caption lane.
export function resolveSubmagicSettings(
  spec: VariantSpec,
  profile: ContentProfile,
  opts: { templateName?: string } = {},
): ResolvedSubmagicSettings {
  const pace = gatePace(spec.locked.basePace, profile.sensitivity)

  // Guardrail 2: B-roll % = the variant's ceiling for this richness, never more.
  const brollPct = spec.adaptive.brollCeiling[profile.brollableRichness]

  // Guardrail 3: zooms only if the variant wants them AND framing has room —
  // push-ins on an already-tight face read as jitter, not energy.
  const magicZooms = spec.locked.magicZooms && profile.faceFraming !== 'tight'

  // Hook title only when the variant wants one, the hook lands, and we actually
  // have grounded text to show.
  const hookTitle = spec.locked.hookTitle && profile.hookStrength !== 'weak' && profile.suggestedHookTitle
    ? { text: profile.suggestedHookTitle }
    : false

  return {
    // The API rejects templateName + userThemeId together — a custom theme wins.
    templateName: spec.userThemeId ? undefined : opts.templateName,
    userThemeId: spec.userThemeId,
    magicBrolls: brollPct > 0,
    magicBrollsPercentage: brollPct,
    magicZooms,
    hookTitle,
    removeSilencePace: pace,
  }
}
