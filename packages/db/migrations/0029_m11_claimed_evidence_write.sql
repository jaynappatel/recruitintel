-- Idempotent evidence writes run through a claimed-target definer function so
-- the capability role does not need broad SELECT on private evidence.
create or replace function public.m11_record_claimed_evidence(
  work_item uuid, skill text, source_span text, evidence_hash text
) returns void
language plpgsql security definer set search_path = public as $$
declare w public.work_items%rowtype;
begin
  select * into w from public.work_items
  where id = work_item and work_class = 'RESUME' and work_type = 'RESUME_PARSE'
    and status in ('LEASED','RUNNING');
  if not found then raise exception 'WORK_NOT_CLAIMED' using errcode = '42501'; end if;
  insert into public.candidate_evidence
    (user_id,resume_version_id,evidence_type,normalized_value,source,review_status,section,source_span,evidence_hash)
  values (w.user_id,w.resume_version_id,'SKILL',jsonb_build_object('skill',skill),
    'DETERMINISTIC_PARSE','EXTRACTED','skills',left(source_span,500),evidence_hash)
  on conflict (user_id,evidence_hash) do nothing;
end $$;
revoke all on function public.m11_record_claimed_evidence(uuid,text,text,text) from public;
grant execute on function public.m11_record_claimed_evidence(uuid,text,text,text) to recruitintel_worker_resume;
