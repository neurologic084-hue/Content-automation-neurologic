-- Seed Profile 1 (Jessica Wendling) and Profile 2 (OVRHAUL.ai)
-- Run AFTER supabase-migration-profile-columns.sql
-- Safe to re-run — uses UPDATE if slot exists, INSERT if it doesn't

DO $$
BEGIN

  -- ─── Profile 1 — Dr. Jessica Wendling (NeuroLogic Seattle) ─────────────────
  IF EXISTS (SELECT 1 FROM brand_settings WHERE profile_slot = 1) THEN
    UPDATE brand_settings SET
      profile_name            = 'Profile 1',
      is_active               = true,
      creator_name            = 'Dr. Jessica Wendling',
      tagline                 = 'Rewire your brain. Change your life.',
      location                = 'Seattle, WA',
      tone_keywords           = ARRAY['Warm', 'Empathetic', 'Science-backed', 'Calm', 'Educational', 'Direct'],
      unique_angle            = 'Naturopathic Doctor (ND) licensed in Washington State, educated at Bastyr University. Founder of NeuroLogic Seattle in the Ballard neighborhood. Voted Seattle Top Doctor 2019 and 2020. I use neurofeedback — a non-invasive, drug-free approach — to help the brain rewire itself using its own natural plasticity. Results that last a lifetime, typically achieved in an average of 11 sessions. Also founded Foundation Empowered, a nonprofit bringing neurofeedback to underserved communities.',
      audience_description    = 'People dealing with anxiety, ADHD, trauma, PTSD, depression, chronic pain, TBI, brain fog, and sleep problems. Often high-achievers who have tried medication and want a natural alternative, or people who want to optimize brain performance. All ages — toddlers to elders.',
      audience_transformation = 'From stuck, exhausted, or overwhelmed to a brain that works for you — lasting improvements in focus, mood stability, energy, sleep, and emotional resilience. Results in an average of 11 sessions that last a lifetime.',
      offerings               = 'Neurofeedback therapy sessions — $180/session, 10–20 sessions for lasting results (out-of-network insurance may cover 60–80% of the first visit, sliding scale available)',
      social_proof            = 'Voted Seattle Top Doctor 2019 and 2020. Over 900 individuals helped since 2017. Results that last a lifetime in an average of 11 sessions. Endorsed by marriage and family therapists as a non-invasive alternative to medication for mental wellness.',
      extra_context           = E'Never claim to cure or diagnose — use "support", "address", or "help regulate"\nNever advise stopping prescribed medication — always say to work with their prescribing doctor\nNon-invasive and drug-free approach — lead with this when it is relevant\nKeep language accessible and hopeful — avoid heavy clinical jargon unless explaining a mechanism clearly\nAlways evidence-based — neurofeedback is FDA-cleared for ADHD and backed by decades of research',
      content_pillars         = E'Neurofeedback and brain health\nADHD and focus\nAnxiety and nervous system regulation\nTrauma and PTSD recovery\nPerformance and brain optimization',
      updated_at              = now()
    WHERE profile_slot = 1;
  ELSE
    INSERT INTO brand_settings (
      profile_slot, profile_name, is_active,
      creator_name, tagline, location, tone_keywords,
      unique_angle, audience_description, audience_transformation,
      offerings, social_proof, extra_context, content_pillars,
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
      E'Never claim to cure or diagnose — use "support", "address", or "help regulate"\nNever advise stopping prescribed medication — always say to work with their prescribing doctor\nNon-invasive and drug-free approach — lead with this when it is relevant\nKeep language accessible and hopeful — avoid heavy clinical jargon unless explaining a mechanism clearly\nAlways evidence-based — neurofeedback is FDA-cleared for ADHD and backed by decades of research',
      E'Neurofeedback and brain health\nADHD and focus\nAnxiety and nervous system regulation\nTrauma and PTSD recovery\nPerformance and brain optimization',
      now()
    );
  END IF;

  -- ─── Profile 2 — OVRHAUL.ai (Ryan Montoya) ──────────────────────────────────
  IF EXISTS (SELECT 1 FROM brand_settings WHERE profile_slot = 2) THEN
    UPDATE brand_settings SET
      profile_name            = 'Profile 2',
      is_active               = false,
      creator_name            = 'OVRHAUL.ai',
      tagline                 = 'Deploy the Growth Engine.',
      location                = '',
      tone_keywords           = ARRAY['Confident', 'Direct', 'Bold', 'No-nonsense', 'Educational'],
      unique_angle            = 'Founder of OVRHAUL.ai — a veteran-owned AI automation company that builds and deploys custom growth systems for fast-moving B2B companies. We design AI agents, voice agents, chatbots, custom GPTs, and full automation stacks. Unlike typical SaaS tools, clients own what we build. We guarantee performance and specialize in revenue, sales ops, and follow-up automation for industries like mortgage, insurance, and law.',
      audience_description    = 'Fast-moving B2B companies in mortgage, insurance, law, and adjacent industries. Decision-makers who are frustrated with generic SaaS tools and want a custom system that actually drives revenue. They want ROI they can measure — appointments booked, hours saved, revenue added.',
      audience_transformation = 'From manual, leaky sales processes to a fully automated growth engine — real appointments booked, hours saved every month, and revenue added without adding headcount.',
      offerings               = 'Custom AI automation system design and deployment. AI agents, voice agents, chatbots, custom GPTs, RAG and embeddings solutions. Client ownership model (no rental lock-in). Performance guarantees included.',
      social_proof            = 'Five-star reviews from verified clients in mortgage, insurance, and legal sectors. Quantified results: revenue added, appointments booked, hours saved monthly, followers gained. Clients report operational transformation and measurable ROI.',
      extra_context           = E'Never overpromise specific revenue numbers — let the case studies speak\nLead with ownership and customization — not subscription or template approaches\nKeep content practical and results-focused — avoid hype and vague AI buzzwords\nAlways speak to ROI and measurable outcomes\nVeteran-owned — mention when relevant',
      content_pillars         = E'AI automation for B2B growth\nSales operations and follow-up systems\nAI agents and voice agents\nRevenue and appointment generation\nCustom GPT and chatbot deployment',
      updated_at              = now()
    WHERE profile_slot = 2;
  ELSE
    INSERT INTO brand_settings (
      profile_slot, profile_name, is_active,
      creator_name, tagline, location, tone_keywords,
      unique_angle, audience_description, audience_transformation,
      offerings, social_proof, extra_context, content_pillars,
      updated_at
    ) VALUES (
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
      E'Never overpromise specific revenue numbers — let the case studies speak\nLead with ownership and customization — not subscription or template approaches\nKeep content practical and results-focused — avoid hype and vague AI buzzwords\nAlways speak to ROI and measurable outcomes\nVeteran-owned — mention when relevant',
      E'AI automation for B2B growth\nSales operations and follow-up systems\nAI agents and voice agents\nRevenue and appointment generation\nCustom GPT and chatbot deployment',
      now()
    );
  END IF;

END $$;
