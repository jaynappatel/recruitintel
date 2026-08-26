create or replace function public.m11_claimed_match_inputs(work_item uuid)
returns table(user_id uuid, resume_version_id uuid, opportunity_id uuid, requirement_set_id uuid,
  evidence_id uuid, evidence_hash text, review_version integer)
language sql security definer set search_path = public as $$
  select w.user_id, w.resume_version_id, w.opportunity_id, q.id,
    e.id, e.evidence_hash, e.review_version
  from work_items w
  join resume_versions v on v.id=w.resume_version_id and v.user_id=w.user_id
  join job_requirement_sets q on q.opportunity_id=w.opportunity_id
  left join candidate_evidence e on e.user_id=w.user_id and e.resume_version_id=w.resume_version_id
    and e.superseded_at is null and e.review_status <> 'REJECTED'
  join worker_role_bindings b on b.database_role=session_user
    and b.service_principal_id=w.lease_service_principal_id
  where w.id=work_item and w.work_class='RESUME' and w.work_type='MATCH_MATERIALIZE'
    and w.status in ('LEASED','RUNNING')
  order by q.version desc;
$$;
revoke all on function public.m11_claimed_match_inputs(uuid) from public;
grant execute on function public.m11_claimed_match_inputs(uuid) to recruitintel_worker_resume;
revoke select on public.resume_versions, public.job_requirement_sets, public.candidate_evidence
  from recruitintel_worker_resume;
