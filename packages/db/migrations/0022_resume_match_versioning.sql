-- M11 Gate A.2: immutable evidence inputs for match materialization.
alter table public.candidate_evidence
  add column if not exists review_version integer not null default 0 check (review_version >= 0);

alter table public.resume_job_matches
  add column if not exists evidence_fingerprint text not null default 'legacy';

alter table public.resume_job_matches
  drop constraint if exists resume_job_matches_user_id_resume_version_id_opportunity_id_requirement_set_id_algorithm_version_key;
create unique index if not exists resume_job_matches_input_unique_idx
  on public.resume_job_matches (user_id, resume_version_id, opportunity_id, requirement_set_id, algorithm_version, evidence_fingerprint);
create index if not exists resume_job_matches_current_idx
  on public.resume_job_matches (user_id, opportunity_id, generated_at desc, id desc);
