-- M11 runtime attribution links.  All links are owner-compound and nullable:
-- a match may be computed outside a recommendation or application context.
alter table public.resume_job_matches
  add column if not exists ranking_decision_id uuid,
  add column if not exists recommendation_impression_id uuid;
alter table public.resume_job_matches
  add constraint resume_job_matches_ranking_owner_fkey
    foreign key (ranking_decision_id, user_id)
    references public.ranking_decisions(id, user_id) on delete set null;
alter table public.resume_job_matches
  add constraint resume_job_matches_impression_owner_fkey
    foreign key (recommendation_impression_id, user_id)
    references public.recommendation_impressions(id, user_id) on delete set null;
create index if not exists resume_job_matches_recommendation_idx
  on public.resume_job_matches (user_id, ranking_decision_id, recommendation_impression_id)
  where ranking_decision_id is not null or recommendation_impression_id is not null;

alter table public.applications add column if not exists match_id uuid;
alter table public.applications
  add constraint applications_match_owner_fkey
    foreign key (match_id, user_id)
    references public.resume_job_matches(id, user_id) on delete set null;
create index if not exists applications_match_idx on public.applications (user_id, match_id)
  where match_id is not null;
