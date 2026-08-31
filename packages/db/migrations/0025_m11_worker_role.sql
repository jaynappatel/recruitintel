-- Dedicated capability role for private M11 work. It is intentionally separate from
-- Calendar/global lanes; deployment binds a login role through bind-worker-role.mjs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_worker_resume') then
    create role recruitintel_worker_resume nologin;
  end if;
end $$;
grant usage on schema public to recruitintel_worker_resume;
grant execute on function public.claim_work_items(text, public.work_class[], integer, integer),
  public.start_work_attempt(uuid, uuid),
  public.finish_work_attempt(uuid, uuid, boolean, public.work_failure_classification, text, jsonb,
    public.coverage_status, integer, integer, integer, integer)
  to recruitintel_worker_resume;
grant select, insert, update on public.resume_documents, public.resume_versions,
  public.resume_parse_runs, public.candidate_evidence, public.evidence_confirmations,
  public.job_requirement_sets, public.resume_job_matches, public.match_evidence,
  public.work_items, public.work_attempts, public.job_opportunities to recruitintel_worker_resume;
revoke select on public.calendar_connections, public.user_sessions, public.application_events
  from recruitintel_worker_resume;
