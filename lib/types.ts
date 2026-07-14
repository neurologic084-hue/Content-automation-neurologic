export type AudienceLane =
  | 'adhd_parents'
  | 'sympathetic_overdrive'
  | 'burnout_professionals'

export type IdeaStatus =
  | 'pending_lane_confirm'
  | 'generating'
  | 'ready_for_review'
  | 'approved'
  | 'rejected'

export type ScriptStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'needs_revision'

export type MoodTag =
  | 'calm'
  | 'energetic'
  | 'empathetic'
  | 'educational'
  | 'bold'
  | 'story-driven'

export interface BrandSettings {
  id: string
  profile_slot: number
  profile_name: string
  is_active: boolean
  creator_name: string
  tagline: string
  tone_keywords: string[]
  unique_angle: string
  audience_transformation: string
  location: string
  extra_context: string
  content_pillars: string
  offerings: string
  audience_description: string
  social_proof: string
  // Per-brand audience lane descriptions. When set, these override the
  // default LANE_SYSTEM_DESCRIPTIONS constants so the tool works for any niche
  // without code changes. Configure via brand settings UI.
  lane_descriptions?: Record<string, string>
  created_at: string
  updated_at: string
}

export interface FilmingPlan {
  shot_type: string
  wardrobe: string
  setup?: string
  body_labels?: string[]
  re_hook?: string
  // Alternate hooks the creator can swap in from the review page
  alt_hooks?: string[]
  // Per-script on-camera coaching notes (pauses, emphasis, tone shifts)
  delivery_cues?: string[]
  // Script-specific B-roll shot ideas, ordered to match the script's flow
  b_roll?: string[]
  // legacy fields (older scripts)
  location?: string
  props?: string[]
  setup_notes?: string
  estimated_filming_time?: string
}

export interface Idea {
  id: string
  raw_idea: string
  ai_suggested_lane: AudienceLane | null
  ai_lane_reasoning: string | null
  confirmed_lane: AudienceLane | null
  status: IdeaStatus
  created_at: string
}

export interface Script {
  id: string
  idea_id: string
  hook: string
  body: string
  cta: string
  full_script: string
  filming_plan: FilmingPlan
  mood_tag: MoodTag | null
  search_context: SearchContext | null
  why_this_works: string | null
  status: ScriptStatus
  revision_notes: string | null
  approved_at: string | null
  is_few_shot: boolean
  created_at: string
  idea?: Idea
}

export interface SearchContext {
  query: string
  results: Array<{
    title: string
    url: string
    snippet: string
  }>
  answer?: string
}

export interface LaneSuggestion {
  suggested_lane: AudienceLane
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}

export interface GeneratedScript {
  hook: string
  body: string
  cta: string
  full_script: string
  filming_plan: FilmingPlan
  mood_tag: MoodTag
  why_this_works: string
}

export const LANE_LABELS: Record<AudienceLane, string> = {
  adhd_parents: 'ADHD Parents',
  sympathetic_overdrive: 'Sympathetic Overdrive',
  burnout_professionals: 'Burned-Out Professionals',
}

export const LANE_DESCRIPTIONS: Record<AudienceLane, string> = {
  adhd_parents: 'Parents seeking root-cause, functional approaches for their child\'s ADHD brain',
  sympathetic_overdrive: 'Adults stuck in chronic stress or anxiety — mental health is physiologic',
  burnout_professionals: 'High-performing Seattle professionals dealing with brain fog and cognitive decline',
}

export const LANE_COLORS: Record<AudienceLane, string> = {
  adhd_parents: '#6366F1',
  sympathetic_overdrive: '#FF4F17',
  burnout_professionals: '#18181B',
}

export type PublishStatus = 'pending' | 'publishing' | 'published' | 'partial' | 'scheduled' | 'failed'

export interface PlatformPost {
  accountId: string
  platform: string
  postId: string | null
  status: 'published' | 'scheduled' | 'failed'
  error: string | null
}

export interface PublishJob {
  id: string
  script_id: string | null
  video_job_id: string | null
  variant_id: string | null
  download_url: string
  caption: string
  account_ids: string[]
  platform_posts: PlatformPost[]
  status: PublishStatus
  scheduled_at: string | null
  published_at: string | null
  created_at: string
}

export const STATUS_COLORS: Record<ScriptStatus, string> = {
  pending_review: 'bg-warning-light text-warning',
  approved: 'bg-success-light text-success',
  rejected: 'bg-destructive-light text-destructive',
  needs_revision: 'bg-indigo-light text-indigo',
}
