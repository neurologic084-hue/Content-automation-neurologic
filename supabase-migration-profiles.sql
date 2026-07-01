-- ─── Profile Migration ────────────────────────────────────────────────────────
-- Run this once in your Supabase SQL Editor.
-- Profile 1 = Dr. Jessica Wendling (NeuroLogic Seattle) — active
-- Profile 2 = OVRHAUL.ai (Ryan Montoya)
-- Profile 3 = empty slot

-- Step 1: Add profile columns (safe to re-run)
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_slot  INTEGER DEFAULT 1;
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS profile_name  TEXT    DEFAULT 'Profile 1';
ALTER TABLE brand_settings ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT false;

-- Step 2: Move any existing row(s) to Profile 2 (Ryan Montoya / OVRHAUL.ai)
UPDATE brand_settings
SET profile_slot = 2,
    profile_name = 'Profile 2',
    is_active    = false;

-- Step 3: Insert Profile 1 — Dr. Jessica Wendling (NeuroLogic Seattle) — active
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
  'Profile 1',
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

-- Step 4: Insert Profile 2 — OVRHAUL.ai (Ryan Montoya)
-- Only inserts if Profile 2 doesn''t already have data (i.e. no existing row was moved there)
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
)
SELECT
  2,
  'Profile 2',
  false,
  'OVRHAUL.ai',
  'Deploy the Growth Engine.',
  '',
  ARRAY['Confident', 'Direct', 'Bold', 'No-nonsense', 'Educational'],
  'Founder of OVRHAUL.ai — a veteran-owned AI automation company that builds and deploys custom growth systems for fast-moving B2B companies. We design AI agents, voice agents, chatbots, custom GPTs, and full automation stacks. Unlike typical SaaS tools, clients own what we build. We guarantee performance and specialize in revenue, sales ops, and follow-up automation for industries like mortgage, insurance, and law.',
  'Fast-moving B2B companies in mortgage, insurance, law, and adjacent industries. Decision-makers who are frustrated with generic SaaS tools and want a custom system that actually drives revenue. They want ROI they can measure — appointments booked, hours saved, revenue added.',
  'From manual, leaky sales processes to a fully automated growth engine — real appointments booked, hours saved every month, and revenue added without adding headcount.',
  'Custom AI automation system design and deployment. AI agents, voice agents, chatbots, custom GPTs, RAG and embeddings solutions. Client ownership model (no rental lock-in). Performance guarantees included.',
  'Five-star reviews from verified clients in mortgage, insurance, and legal sectors. Quantified results: revenue added, appointments booked, hours saved monthly, followers gained. Clients report operational transformation and measurable ROI.',
  'Never overpromise specific revenue numbers — let the case studies speak
Lead with ownership and customization — not subscription/template approaches
Keep content practical and results-focused — avoid hype and vague AI buzzwords
Always speak to ROI and measurable outcomes
Veteran-owned — mention when relevant',
  'AI automation for B2B growth
Sales operations and follow-up systems
AI agents and voice agents
Revenue and appointment generation
Custom GPT and chatbot deployment',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM brand_settings WHERE profile_slot = 2 AND creator_name != ''
);
