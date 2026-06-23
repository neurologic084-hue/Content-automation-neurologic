-- ─── AI Content Growth System — Schema ───────────────────────────────────────
-- Paste this entire file into Supabase SQL Editor and click Run.
-- Safe to re-run — all statements use IF NOT EXISTS.

create extension if not exists "uuid-ossp";

-- ─── Creator Profile ─────────────────────────────────────────────────────────
-- Your identity, voice, and audience. Powers the AI script engine.
create table if not exists brand_settings (
  id                    uuid        primary key default gen_random_uuid(),

  -- Who you are
  creator_name          text        not null default '',
  tagline               text        not null default '',

  -- Your audience (used to write to the right person)
  audience_description  text        not null default '',

  -- What you help people with (the transformation or outcome you deliver)
  audience_transformation text      not null default '',

  -- Where you create / who you serve (optional — leave blank if not relevant)
  location              text        not null default '',

  -- How you want to sound (e.g. "warm", "direct", "science-backed")
  tone_keywords         text[]      not null default '{}',

  -- What makes you different from others in your space
  unique_angle          text        not null default '',

  -- Your main topics / content pillars (free text, one per line)
  content_pillars       text        not null default '',

  -- Services, offers, or programs you want to promote (optional)
  offerings             text        not null default '',

  -- Social proof — credentials, results, testimonials (used in scripts)
  social_proof          text        not null default '',

  -- Anything else the AI should know about your brand
  extra_context         text        not null default '',

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── Content Ideas ───────────────────────────────────────────────────────────
-- Generated or manually entered ideas waiting to become scripts.
create table if not exists ideas (
  id                  uuid        primary key default gen_random_uuid(),
  raw_idea            text        not null,

  -- Which audience segment this idea speaks to
  ai_suggested_lane   text        check (ai_suggested_lane  in ('adhd_parents', 'sympathetic_overdrive', 'burnout_professionals')),
  ai_lane_reasoning   text,
  confirmed_lane      text        check (confirmed_lane     in ('adhd_parents', 'sympathetic_overdrive', 'burnout_professionals')),

  status              text        not null default 'pending_lane_confirm'
                        check (status in ('pending_lane_confirm', 'generating', 'ready_for_review', 'approved', 'rejected')),
  created_at          timestamptz not null default now()
);

-- ─── Scripts ─────────────────────────────────────────────────────────────────
-- The actual content — hook, body, CTA — ready to film.
create table if not exists scripts (
  id              uuid        primary key default gen_random_uuid(),
  idea_id         uuid        not null references ideas(id) on delete cascade,

  hook            text        not null,
  body            text        not null,
  cta             text        not null,
  full_script     text        not null,

  -- Optional filming guidance (shot list, b-roll notes, etc.)
  filming_plan    jsonb       not null default '{}',

  -- Mood / energy level of the script
  mood_tag        text        check (mood_tag in ('calm', 'energetic', 'empathetic', 'educational', 'bold', 'story-driven')),

  -- Research the AI pulled in when writing this script
  search_context  jsonb,

  -- AI explanation of why this script works for the audience
  why_this_works  text,

  -- Organise into folders in the Library
  folder_id       uuid,
  folder_name     text,

  status          text        not null default 'pending_review'
                    check (status in ('pending_review', 'approved', 'rejected', 'needs_revision')),
  revision_notes  text,
  approved_at     timestamptz,

  -- Mark a script as a few-shot example to improve future AI outputs
  is_few_shot     boolean     not null default false,

  created_at      timestamptz not null default now()
);

-- ─── Video Jobs ──────────────────────────────────────────────────────────────
-- One row per filming session. Holds the state of all 10 rendered variants.
create table if not exists video_jobs (
  id                uuid        primary key default gen_random_uuid(),
  script_id         uuid        not null references scripts(id) on delete cascade,
  source_drive_url  text        not null,
  status            text        not null default 'processing'
                      check (status in ('processing', 'complete', 'failed')),
  variants          jsonb,
  selected_variant  text,
  transcript        text,
  created_at        timestamptz not null default now()
);

-- ─── Performance Snapshots (Phase 2 prep) ────────────────────────────────────
-- Weekly content performance data, ready for AI analysis later.
create table if not exists analytics_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  week_start  date        not null,
  platform    text,
  insights    text,
  raw_data    jsonb,
  created_at  timestamptz not null default now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
create index if not exists ideas_status_idx        on ideas(status);
create index if not exists ideas_created_idx       on ideas(created_at desc);
create index if not exists scripts_idea_idx        on scripts(idea_id);
create index if not exists scripts_status_idx      on scripts(status);
create index if not exists scripts_folder_idx      on scripts(folder_id);
create index if not exists scripts_few_shot_idx    on scripts(is_few_shot) where is_few_shot = true;
create index if not exists scripts_created_idx     on scripts(created_at desc);
create index if not exists video_jobs_script_idx   on video_jobs(script_id);
create index if not exists video_jobs_status_idx   on video_jobs(status);

-- ─── Auto-update updated_at ──────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists brand_settings_updated_at on brand_settings;
create trigger brand_settings_updated_at
  before update on brand_settings
  for each row execute function update_updated_at();

-- ─── RLS (Row Level Security) ────────────────────────────────────────────────
-- Single-user app — lock every table to authenticated users only.

alter table brand_settings      enable row level security;
alter table ideas               enable row level security;
alter table scripts             enable row level security;
alter table video_jobs          enable row level security;
alter table analytics_snapshots enable row level security;

-- Drop existing policies before recreating (safe to re-run)
drop policy if exists "auth_all" on brand_settings;
drop policy if exists "auth_all" on ideas;
drop policy if exists "auth_all" on scripts;
drop policy if exists "auth_all" on video_jobs;
drop policy if exists "auth_all" on analytics_snapshots;

create policy "auth_all" on brand_settings      for all using (auth.role() = 'authenticated');
create policy "auth_all" on ideas               for all using (auth.role() = 'authenticated');
create policy "auth_all" on scripts             for all using (auth.role() = 'authenticated');
create policy "auth_all" on video_jobs          for all using (auth.role() = 'authenticated');
create policy "auth_all" on analytics_snapshots for all using (auth.role() = 'authenticated');
