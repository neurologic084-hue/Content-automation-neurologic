-- Shared prep artifacts: the word timings produced ONCE per job by source prep
-- and reused by every Motion Lab variant.
--
-- They lived only as a JSON file in R2. That works, but it is a fetch that can
-- miss — and a miss is expensive here: each variant then re-runs the whole paid
-- audio chain (a Submagic clean, an Auphonic production, a transcription) for
-- byte-identical output. The job row is the durable place for them: the render
-- already reads it, so this costs no extra round trip and cannot expire.
--
-- Safe to re-run. Until it IS run, the code writes/reads the R2 JSON exactly as
-- before, so nothing breaks by deferring it.
alter table video_jobs add column if not exists prep_artifacts jsonb;

comment on column video_jobs.prep_artifacts is
  'Shared output of source prep: { words: [{text,start,end}], cleanUrl, builtAt }. Consumed by every v4-v6 render so the paid audio chain runs once per job.';
