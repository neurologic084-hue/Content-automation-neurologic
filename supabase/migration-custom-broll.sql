-- Custom B-roll: the creator's own clips (Drive links) attached to a video
-- job. When present, the v4-v6 pipeline uses THESE clips as B-roll — matched
-- to transcript moments by content — and skips stock footage entirely.
-- Each entry: { "url": string, "description": string | null } — description
-- is filled in by the pipeline (Gemini watches each clip once) and cached.
-- Run once in Supabase SQL Editor. Safe to re-run.

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS custom_broll jsonb;
