-- Profile scoping: every content row belongs to one profile slot.
-- When Profile 1 is active, the app only shows (and learns from) Profile 1's
-- ideas, scripts, videos, and publishes. Run once in Supabase SQL Editor.

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE ideas        ADD COLUMN IF NOT EXISTS profile_slot INTEGER NOT NULL DEFAULT 1;
ALTER TABLE scripts      ADD COLUMN IF NOT EXISTS profile_slot INTEGER NOT NULL DEFAULT 1;
ALTER TABLE video_jobs   ADD COLUMN IF NOT EXISTS profile_slot INTEGER NOT NULL DEFAULT 1;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS profile_slot INTEGER NOT NULL DEFAULT 1;

-- Existing rows belong to Profile 1 (the original profile) via the DEFAULT.

-- ─── 2. Auto-stamp trigger ───────────────────────────────────────────────────
-- Any insert that doesn't explicitly set profile_slot gets the ACTIVE profile's
-- slot. This covers every write path — including client-side inserts — so no
-- row can land in the wrong profile.
CREATE OR REPLACE FUNCTION stamp_profile_slot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  active_slot INTEGER;
BEGIN
  SELECT profile_slot INTO active_slot FROM brand_settings WHERE is_active = true LIMIT 1;
  IF active_slot IS NOT NULL THEN
    NEW.profile_slot := active_slot;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ideas_stamp_profile        ON ideas;
DROP TRIGGER IF EXISTS scripts_stamp_profile      ON scripts;
DROP TRIGGER IF EXISTS video_jobs_stamp_profile   ON video_jobs;
DROP TRIGGER IF EXISTS publish_jobs_stamp_profile ON publish_jobs;

CREATE TRIGGER ideas_stamp_profile        BEFORE INSERT ON ideas        FOR EACH ROW EXECUTE FUNCTION stamp_profile_slot();
CREATE TRIGGER scripts_stamp_profile      BEFORE INSERT ON scripts      FOR EACH ROW EXECUTE FUNCTION stamp_profile_slot();
CREATE TRIGGER video_jobs_stamp_profile   BEFORE INSERT ON video_jobs   FOR EACH ROW EXECUTE FUNCTION stamp_profile_slot();
CREATE TRIGGER publish_jobs_stamp_profile BEFORE INSERT ON publish_jobs FOR EACH ROW EXECUTE FUNCTION stamp_profile_slot();

-- ─── 3. Indexes for the per-profile queries the app now runs ────────────────
CREATE INDEX IF NOT EXISTS ideas_profile_idx        ON ideas(profile_slot, status);
CREATE INDEX IF NOT EXISTS scripts_profile_idx      ON scripts(profile_slot, status);
CREATE INDEX IF NOT EXISTS video_jobs_profile_idx   ON video_jobs(profile_slot, status);
CREATE INDEX IF NOT EXISTS publish_jobs_profile_idx ON publish_jobs(profile_slot, status);
