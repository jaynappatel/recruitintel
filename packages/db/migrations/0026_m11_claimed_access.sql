-- Workers read encrypted resume bytes only through a lease-bound function.  The
-- function derives the subject from the persisted work target; callers cannot
-- substitute another user's id or resume id.
create or replace function public.m11_claimed_resume_object(work_item uuid)
returns table(user_id uuid, resume_version_id uuid, media_type text, content_hash text,
  storage_ciphertext bytea, storage_nonce bytea)
language plpgsql security definer set search_path = public as $$
declare binding public.worker_role_bindings%rowtype;
begin
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found then raise exception 'WORKER_ROLE_NOT_BOUND' using errcode = '42501'; end if;
  return query
    select w.user_id, w.resume_version_id, d.media_type, d.content_hash,
      d.storage_ciphertext, d.storage_nonce
    from public.work_items w
    join public.resume_versions v on v.id = w.resume_version_id and v.user_id = w.user_id
    join public.resume_documents d on d.id = v.document_id and d.user_id = v.user_id
    where w.id = work_item and w.work_class = 'RESUME' and w.work_type = 'RESUME_PARSE'
      and w.status in ('LEASED','RUNNING')
      and w.lease_service_principal_id = binding.service_principal_id
      and d.status <> 'DELETED';
end $$;
revoke all on function public.m11_claimed_resume_object(uuid) from public;
grant execute on function public.m11_claimed_resume_object(uuid) to recruitintel_worker_resume;
revoke select on public.resume_documents, public.resume_versions from recruitintel_worker_resume;
