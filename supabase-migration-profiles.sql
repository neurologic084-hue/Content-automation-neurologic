-- ─── Profile Migration ────────────────────────────────────────────────────────
-- Run this once in your Supabase SQL Editor.
-- Sets up Profile 1 (Dr. Jessica Wendling, active) and Profile 2 (Ryan Montoya).
-- Safe to re-run — ALTER TABLE uses IF NOT EXISTS.

-- Step 1: Add profile columns
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_slot  INTEGER DEFAULT 1;
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_name  TEXT    DEFAULT 'Profile 1';
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT false;

-- Step 2: Re-assign whatever is already in the table to Profile 2 (Ryan Montoya)
-- This moves your existing brand data to slot 2 so Jessica goes in slot 1.
UPDATE brand_settings
SET profile_slot = 2,
    profile_name = 'Ryan Montoya',
    is_active    = false;

-- Step 3: Insert Profile 1 — Dr. Jessica Wendling (active)
-- All data scraped from public sources (psychologytoday.com, Instagram, search results).
INSERT INTO brand_settings (
  profile_slot,
  profile_name,
  is_active,
  creator_name,
  tagline,
  location,
  tone_keywords,
  unique_angle,
  audience_description,
  audience_transformation,
  offerings,
  social_proof,
  extra_context,
  content_pillars,
  updated_at
) VALUES (
  1,
  'Dr. Jessica Wendling',
  true,
  'Dr. Jessica Wendling',
  'Rewire your brain. Change your life.',
  'Seattle, WA',
  ARRAY['Warm', 'Empathetic', 'Science-backed', 'Calm', 'Educational', 'Direct'],
  'Naturopathic Doctor (ND) licensed in Washington State, educated at Bastyr University. Founder of NeuroLogic Seattle in the Ballard neighborhood. Voted Seattle Top Doctor 2019 and 2020. I use neurofeedback — a non-invasive, drug-free approach — to help the brain rewire itself using its own natural plasticity. Results that last a lifetime, typically achieved in an average of 11 sessions. Also founded Foundation Empowered, a nonprofit bringing neurofeedback to underserved communities.',
  'People dealing with anxiety, ADHD, trauma, PTSD, depression, chronic pain, TBI, brain fog, and sleep problems. Often high-achievers who have tried medication and want a natural alternative, or people who want to optimize brain performance. All ages — toddlers to elders.',
  'From stuck, exhausted, or overwhelmed to a brain that works for you — lasting improvements in focus, mood stability, energy, sleep, and emotional resilience. Results in an average of 11 sessions that last a lifetime.',
  'Neurofeedback therapy sessions — $180/session, 10–20 sessions for lasting results (out-of-network insurance may cover 60–80% of the first visit, sliding scale available)',
  'Voted Seattle Top Doctor 2019 and 2020. Over 900 individuals helped since 2017. Results that last a lifetime in an average of 11 sessions. Endorsed by marriage and family therapists as a non-invasive alternative to medication for mental wellness.',
  'Never claim to cure or diagnose — use "support", "address", or "help regulate"
Never advise stopping prescribed medication — always say to work with their prescribing doctor
Non-invasive and drug-free approach — lead with this when it is relevant
Keep language accessible and hopeful — avoid heavy clinical jargon unless explaining a mechanism clearly
Always evidence-based — neurofeedback is FDA-cleared for ADHD and backed by decades of research',
  'Neurofeedback and brain health
ADHD and focus
Anxiety and nervous system regulation
Trauma and PTSD recovery
Performance and brain optimization',
  now()
);
