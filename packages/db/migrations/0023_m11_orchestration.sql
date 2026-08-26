alter type public.work_type add value if not exists 'RESUME_PARSE';
alter type public.work_type add value if not exists 'MATCH_MATERIALIZE';
alter type public.work_class add value if not exists 'RESUME';

alter table public.work_items add column if not exists resume_version_id uuid;
alter table public.work_items add column if not exists opportunity_id uuid;
alter table public.work_items add column if not exists parser_version smallint;
alter table public.work_items add column if not exists algorithm_version text;
alter table public.work_items add constraint work_items_m11_resume_owner_fkey
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete cascade;
alter table public.work_items add constraint work_items_m11_opportunity_fkey
  foreign key (opportunity_id) references public.job_opportunities(id) on delete restrict;
alter table public.work_items drop constraint if exists work_items_typed_subject_check;
alter table public.work_items add constraint work_items_typed_subject_check check (
  (work_type::text in ('RESUME_PARSE','MATCH_MATERIALIZE') and user_id is not null and resume_version_id is not null
    and source_id is null and github_sync_request_id is null and public_web_work_request_id is null
    and calendar_sync_request_id is null and recruiting_observation_id is null
    and alert_evaluation_request_id is null and fanout_after_user_id is null)
  or (work_type::text in ('ALERT_FANOUT') and source_id is null and github_sync_request_id is null and public_web_work_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and user_id is null)
  or (work_type::text = 'ALERT_EVALUATE' and source_id is null and github_sync_request_id is null and public_web_work_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is not null and user_id is not null)
  or (work_type::text = 'CALENDAR_SYNC' and calendar_sync_request_id is not null and user_id is not null and github_sync_request_id is null and public_web_work_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and source_id is null)
  or (work_type::text in ('PRIVACY_RETENTION_CLEANUP','SOURCE_HEALTH_ROLLUP') and source_id is null and github_sync_request_id is null and public_web_work_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and user_id is null)
  or (work_type::text = 'ATS_COLLECT' and source_id is not null and github_sync_request_id is null and public_web_work_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and user_id is null)
  or (work_type::text = 'GITHUB_SYNC' and source_id is not null and github_sync_request_id is not null and public_web_work_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and user_id is null)
  or (work_type::text in ('PUBLIC_WEB_SEARCH','PUBLIC_WEB_FETCH','PUBLIC_WEB_PROCESS') and source_id is not null and public_web_work_request_id is not null and github_sync_request_id is null and calendar_sync_request_id is null and recruiting_observation_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and user_id is null)
  or (work_type::text = 'RECRUITER_CAMPUS_PROJECT' and recruiting_observation_id is not null and github_sync_request_id is null and public_web_work_request_id is null and calendar_sync_request_id is null and alert_evaluation_request_id is null and fanout_after_user_id is null and user_id is null)
);
create index if not exists work_items_m11_target_idx on public.work_items (user_id, resume_version_id, opportunity_id)
  where resume_version_id is not null or opportunity_id is not null;
