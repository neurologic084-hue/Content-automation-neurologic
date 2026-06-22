-- Content Engine — Phase 1 Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension (usually already enabled)
create extension if not exists "uuid-ossp";

-- ─── Brand Settings ─────────────────────────────────────────────────────────
-- One row per account (single-user app for now)
create table if not exists brand_settings (
  id          uuid primary key default gen_random_uuid(),
  clinic_name text not null default 'Your Clinic',
  tagline     text,
  tone_keywords   text[]   not null default '{}',
  what_makes_different  text not null default '',
  patient_transformation text not null default '',
  target_location text not null default 'Seattle',
  additional_context text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── Ideas ───────────────────────────────────────────────────────────────────
create table if not exists ideas (
  id                  uuid primary key default gen_random_uuid(),
  raw_idea            text not null,
  ai_suggested_lane   text check (ai_suggested_lane in ('adhd_parents', 'sympathetic_overdrive', 'burnout_professionals')),
  ai_lane_reasoning   text,
  confirmed_lane      text check (confirmed_lane in ('adhd_parents', 'sympathetic_overdrive', 'burnout_professionals')),
  status              text not null default 'pending_lane_confirm'
                        check (status in ('pending_lane_confirm', 'generating', 'ready_for_review', 'approved', 'rejected')),
  created_at          timestamptz not null default now()
);

-- ─── Scripts ──────────────────────────────────────────────────────────────────
create table if not exists scripts (
  id              uuid primary key default gen_random_uuid(),
  idea_id         uuid not null references ideas(id) on delete cascade,
  hook            text not null,
  body            text not null,
  cta             text not null,
  full_script     text not null,
  filming_plan    jsonb not null,
  mood_tag        text check (mood_tag in ('calm', 'energetic', 'empathetic', 'educational', 'bold', 'story-driven')),
  search_context  jsonb,
  why_this_works  text,
  status          text not null default 'pending_review'
                    check (status in ('pending_review', 'approved', 'rejected', 'needs_revision')),
  revision_notes  text,
  approved_at     timestamptz,
  is_few_shot     boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ─── Analytics Snapshots (Phase 2 prep) ──────────────────────────────────────
create table if not exists analytics_snapshots (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null,
  platform    text,
  insights    text,
  raw_data    jsonb,
  created_at  timestamptz not null default now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists ideas_status_idx     on ideas(status);
create index if not exists ideas_created_idx    on ideas(created_at desc);
create index if not exists scripts_idea_idx     on scripts(idea_id);
create index if not exists scripts_status_idx   on scripts(status);
create index if not exists scripts_few_shot_idx on scripts(is_few_shot) where is_few_shot = true;
create index if not exists scripts_created_idx  on scripts(created_at desc);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger brand_settings_updated_at
  before update on brand_settings
  for each row execute function update_updated_at();

-- ─── v2 — Expanded brand settings ───────────────────────────────────────────
-- Run this block if upgrading from v1 (safe to re-run — uses IF NOT EXISTS)
alter table brand_settings
  add column if not exists positioning       text,
  add column if not exists core_offerings    text,
  add column if not exists icp_definition    text,
  add column if not exists social_proof      text,

-- ─── RLS (Row Level Security) ────────────────────────────────────────────────
-- For single-user app: disable RLS for simplicity, or enable with open policies.
-- If you want to lock it to authenticated users only, uncomment below:

-- alter table brand_settings enable row level security;
-- alter table ideas enable row level security;
-- alter table scripts enable row level security;

-- create policy "Authenticated users can do everything" on brand_settings
--   for all using (auth.role() = 'authenticated');
-- create policy "Authenticated users can do everything" on ideas
--   for all using (auth.role() = 'authenticated');
-- create policy "Authenticated users can do everything" on scripts
--   for all using (auth.role() = 'authenticated');
