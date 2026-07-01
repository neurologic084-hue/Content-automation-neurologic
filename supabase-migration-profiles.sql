-- Run this in your Supabase SQL editor
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_slot INTEGER DEFAULT 1;
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_name TEXT DEFAULT 'Profile 1';
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;

-- Set the existing row as slot 1, active
UPDATE brand_settings
SET profile_slot = 1, profile_name = 'Profile 1', is_active = true
WHERE is_active IS NOT TRUE OR is_active IS NULL;
