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
  clinic_name: string
  tagline: string | null
  tone_keywords: string[]
  what_makes_different: string
  patient_transformation: string
  target_location: string
  additional_context: string | null
  positioning: string | null
  core_offerings: string | null
  icp_definition: string | null
  social_proof: string | null
  created_at: string
  updated_at: string
}

export interface FilmingPlan {
  shot_type: string
  wardrobe: string
  setup?: string
  body_labels?: string[]
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
  adhd_parents: 'Founders Building Brand',
  sympathetic_overdrive: 'Marketing Teams Scaling',
  burnout_professionals: 'LinkedIn Creators',
}

export const LANE_DESCRIPTIONS: Record<AudienceLane, string> = {
  adhd_parents: 'Startup founders and solopreneurs growing a personal brand with AI',
  sympathetic_overdrive: 'Marketing teams scaling content output and workflow with AI tools',
  burnout_professionals: 'Consultants and creators trying to stand out on LinkedIn',
}

export const LANE_COLORS: Record<AudienceLane, string> = {
  adhd_parents: 'bg-indigo-light text-indigo',
  sympathetic_overdrive: 'bg-orange-light text-orange',
  burnout_professionals: 'bg-surface-raised text-text-muted',
}

export const STATUS_COLORS: Record<ScriptStatus, string> = {
  pending_review: 'bg-warning-light text-warning',
  approved: 'bg-success-light text-success',
  rejected: 'bg-destructive-light text-destructive',
  needs_revision: 'bg-indigo-light text-indigo',
}
