import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const JESSICA: Record<string, unknown> = {
  profile_slot: 1,
  profile_name: 'Profile 1',
  is_active: true,
  creator_name: 'Dr. Jessica Wendling',
  tagline: 'Rewire your brain. Change your life.',
  location: 'Seattle, WA',
  tone_keywords: ['Warm', 'Empathetic', 'Science-backed', 'Calm', 'Educational', 'Direct'],
  unique_angle:
    'Naturopathic Doctor (ND) licensed in Washington State, educated at Bastyr University. Founder of NeuroLogic Seattle in the Ballard neighborhood. Voted Seattle Top Doctor 2019 and 2020. I use neurofeedback — a non-invasive, drug-free approach — to help the brain rewire itself using its own natural plasticity. Results that last a lifetime, typically achieved in an average of 11 sessions. Also founded Foundation Empowered, a nonprofit bringing neurofeedback to underserved communities.',
  audience_description:
    'People dealing with anxiety, ADHD, trauma, PTSD, depression, chronic pain, TBI, brain fog, and sleep problems. Often high-achievers who have tried medication and want a natural alternative, or people who want to optimize brain performance. All ages — toddlers to elders.',
  audience_transformation:
    'From stuck, exhausted, or overwhelmed to a brain that works for you — lasting improvements in focus, mood stability, energy, sleep, and emotional resilience. Results in an average of 11 sessions that last a lifetime.',
  offerings:
    'Neurofeedback therapy sessions — $180/session, 10–20 sessions for lasting results (out-of-network insurance may cover 60–80% of the first visit, sliding scale available)',
  social_proof:
    'Voted Seattle Top Doctor 2019 and 2020. Over 900 individuals helped since 2017. Results that last a lifetime in an average of 11 sessions. Endorsed by marriage and family therapists as a non-invasive alternative to medication for mental wellness.',
  extra_context: `Never claim to cure or diagnose — use "support", "address", or "help regulate"
Never advise stopping prescribed medication — always say to work with their prescribing doctor
Non-invasive and drug-free approach — lead with this when it is relevant
Keep language accessible and hopeful — avoid heavy clinical jargon unless explaining a mechanism clearly
Always evidence-based — neurofeedback is FDA-cleared for ADHD and backed by decades of research`,
  content_pillars: `Neurofeedback and brain health
ADHD and focus
Anxiety and nervous system regulation
Trauma and PTSD recovery
Performance and brain optimization`,
}

const OVRHAUL: Record<string, unknown> = {
  profile_slot: 2,
  profile_name: 'Profile 2',
  is_active: false,
  creator_name: 'OVRHAUL.ai',
  tagline: 'Deploy the Growth Engine.',
  location: '',
  tone_keywords: ['Confident', 'Direct', 'Bold', 'No-nonsense', 'Educational'],
  unique_angle:
    'Founder of OVRHAUL.ai — a veteran-owned AI automation company that builds and deploys custom growth systems for fast-moving B2B companies. We design AI agents, voice agents, chatbots, custom GPTs, and full automation stacks. Unlike typical SaaS tools, clients own what we build. We guarantee performance and specialize in revenue, sales ops, and follow-up automation for industries like mortgage, insurance, and law.',
  audience_description:
    'Fast-moving B2B companies in mortgage, insurance, law, and adjacent industries. Decision-makers who are frustrated with generic SaaS tools and want a custom system that actually drives revenue. They want ROI they can measure — appointments booked, hours saved, revenue added.',
  audience_transformation:
    'From manual, leaky sales processes to a fully automated growth engine — real appointments booked, hours saved every month, and revenue added without adding headcount.',
  offerings:
    'Custom AI automation system design and deployment. AI agents, voice agents, chatbots, custom GPTs, RAG and embeddings solutions. Client ownership model (no rental lock-in). Performance guarantees included.',
  social_proof:
    'Five-star reviews from verified clients in mortgage, insurance, and legal sectors. Quantified results: revenue added, appointments booked, hours saved monthly, followers gained. Clients report operational transformation and measurable ROI.',
  extra_context: `Never overpromise specific revenue numbers — let the case studies speak
Lead with ownership and customization — not subscription or template approaches
Keep content practical and results-focused — avoid hype and vague AI buzzwords
Always speak to ROI and measurable outcomes
Veteran-owned — mention when relevant`,
  content_pillars: `AI automation for B2B growth
Sales operations and follow-up systems
AI agents and voice agents
Revenue and appointment generation
Custom GPT and chatbot deployment`,
}

export async function GET() {
  const supabase = await createClient()

  // Verify session — RLS requires an authenticated user
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json(
      { success: false, message: 'Not logged in. Open the app, log in, then visit this URL.' },
      { status: 401 },
    )
  }

  const results: Record<string, string> = {}

  for (const profile of [JESSICA, OVRHAUL]) {
    const slot = profile.profile_slot as number

    const { data: existing, error: fetchError } = await supabase
      .from('brand_settings')
      .select('id')
      .eq('profile_slot', slot)
      .maybeSingle()

    if (fetchError) {
      results[`Profile ${slot}`] = `fetch error: ${fetchError.message}`
      continue
    }

    if (existing?.id) {
      const { error } = await supabase
        .from('brand_settings')
        .update({ ...profile, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      results[`Profile ${slot}`] = error ? `update error: ${error.message}` : 'updated'
    } else {
      const { error } = await supabase
        .from('brand_settings')
        .insert({ ...profile, updated_at: new Date().toISOString() })
      results[`Profile ${slot}`] = error ? `insert error: ${error.message}` : 'created'
    }
  }

  const hasError = Object.values(results).some(v => v.includes('error'))

  if (hasError) {
    return NextResponse.json(
      {
        success: false,
        message: 'One or more profiles failed. If you see "column does not exist", run the 3 ALTER TABLE lines from supabase-migration-profiles.sql in your Supabase SQL Editor first, then visit this URL again.',
        results,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    success: true,
    message: 'Both profiles saved. Open Settings to see them.',
    results,
  })
}
