-- Add profile columns to brand_settings
-- Run this once in Supabase SQL Editor before using the multi-profile settings.

ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_slot  INTEGER DEFAULT 1;
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_name  TEXT    DEFAULT 'Profile 1';
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT false;

-- Mark any existing row as slot 1, active (so the app still works immediately)
UPDATE brand_settings
SET profile_slot = 1, profile_name = 'Profile 1', is_active = true
WHERE is_active IS NOT TRUE OR is_active IS NULL;
