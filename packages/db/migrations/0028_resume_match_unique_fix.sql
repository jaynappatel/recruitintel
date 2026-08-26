-- 0022 introduced the versioned evidence fingerprint but did not remove the
-- original non-versioned unique index on all upgrade paths. Remove it forward
-- so corrected evidence can materialize a distinct historical match.
alter table public.resume_job_matches
  drop constraint if exists resume_job_matches_user_id_resume_version_id_opportunity_id_key;
drop index if exists public.resume_job_matches_user_id_resume_version_id_opportunity_id_key;
