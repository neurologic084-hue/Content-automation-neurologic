-- Account scoping: every row belongs to one login account.
-- Before this, the "auth_all" policies let ANY authenticated user see every
-- row — fine when the app had a single login, wrong now that the client has
-- their own account. Run once in Supabase SQL Editor. Safe to re-run.
--
-- Accounts:
--   internal  neurologic@gmail.com     334f9400-1560-4271-88f2-671c34bf0d6e
--   client    neurologic084@gmail.com  31f14852-6ef1-4bad-9a73-53d6d3c57dcd

-- ─── 1. Ownership columns ────────────────────────────────────────────────────
-- DEFAULT auth.uid() stamps every future insert with the logged-in account.
-- Service-role writes (background renderers) bypass RLS and only UPDATE
-- existing rows, so they are unaffected.
ALTER TABLE brand_settings      ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE ideas               ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE scripts             ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE video_jobs          ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE publish_jobs        ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();
ALTER TABLE analytics_snapshots ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid();

-- ─── 2. Backfill ─────────────────────────────────────────────────────────────
-- Everything that exists today was made on the internal account — keep it there.
UPDATE brand_settings      SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;
UPDATE ideas               SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;
UPDATE scripts             SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;
UPDATE video_jobs          SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;
UPDATE publish_jobs        SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;
UPDATE analytics_snapshots SET user_id = '334f9400-1560-4271-88f2-671c34bf0d6e' WHERE user_id IS NULL;

-- ─── 3. Client starter profile ───────────────────────────────────────────────
-- Copy Jessica's creator profile (Profile 1) to the client account so script
-- generation works there from day one — content stays empty.
INSERT INTO brand_settings (
  profile_slot, profile_name, is_active,
  creator_name, tagline, audience_description, audience_transformation,
  location, tone_keywords, unique_angle, content_pillars,
  offerings, social_proof, extra_context, user_id
)
SELECT
  profile_slot, profile_name, true,
  creator_name, tagline, audience_description, audience_transformation,
  location, tone_keywords, unique_angle, content_pillars,
  offerings, social_proof, extra_context,
  '31f14852-6ef1-4bad-9a73-53d6d3c57dcd'
FROM brand_settings
WHERE user_id = '334f9400-1560-4271-88f2-671c34bf0d6e'
  AND profile_slot = 1
  AND NOT EXISTS (
    SELECT 1 FROM brand_settings
    WHERE user_id = '31f14852-6ef1-4bad-9a73-53d6d3c57dcd'
  )
LIMIT 1;

-- ─── 4. Per-account policies ─────────────────────────────────────────────────
-- Replace "any authenticated user" with "only the owning account".
-- The stamp_profile_slot trigger keeps working per-account: it runs with the
-- inserting user's permissions, so its SELECT on brand_settings is RLS-filtered
-- to that user's own active profile.
DROP POLICY IF EXISTS "auth_all"  ON brand_settings;
DROP POLICY IF EXISTS "auth_all"  ON ideas;
DROP POLICY IF EXISTS "auth_all"  ON scripts;
DROP POLICY IF EXISTS "auth_all"  ON video_jobs;
DROP POLICY IF EXISTS "auth_all"  ON analytics_snapshots;
DROP POLICY IF EXISTS "auth_all"  ON publish_jobs;

DROP POLICY IF EXISTS "own_rows"  ON brand_settings;
DROP POLICY IF EXISTS "own_rows"  ON ideas;
DROP POLICY IF EXISTS "own_rows"  ON scripts;
DROP POLICY IF EXISTS "own_rows"  ON video_jobs;
DROP POLICY IF EXISTS "own_rows"  ON analytics_snapshots;
DROP POLICY IF EXISTS "own_rows"  ON publish_jobs;

CREATE POLICY "own_rows" ON brand_settings      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows" ON ideas               FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows" ON scripts             FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows" ON video_jobs          FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows" ON analytics_snapshots FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_rows" ON publish_jobs        FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 5. Indexes for the per-account filtering the policies now do ────────────
CREATE INDEX IF NOT EXISTS brand_settings_user_idx      ON brand_settings(user_id);
CREATE INDEX IF NOT EXISTS ideas_user_idx               ON ideas(user_id);
CREATE INDEX IF NOT EXISTS scripts_user_idx             ON scripts(user_id);
CREATE INDEX IF NOT EXISTS video_jobs_user_idx          ON video_jobs(user_id);
CREATE INDEX IF NOT EXISTS publish_jobs_user_idx        ON publish_jobs(user_id);
CREATE INDEX IF NOT EXISTS analytics_snapshots_user_idx ON analytics_snapshots(user_id);
