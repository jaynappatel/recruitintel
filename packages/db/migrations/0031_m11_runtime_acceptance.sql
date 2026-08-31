-- Milestone 11 runtime acceptance: immutable input versions, lease-fenced domain
-- writes, and a function-only capability boundary for the private resume worker.

alter type public.job_requirement_type add value if not exists 'SKILL';

alter table public.job_requirement_sets
  add column input_fingerprint text not null default 'legacy';
create unique index job_requirement_sets_input_unique_idx
  on public.job_requirement_sets (opportunity_id, algorithm_version, input_fingerprint)
  where input_fingerprint <> 'legacy';

create or replace function public.reject_m11_requirement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'job requirement sets are append-only' using errcode = '55000';
end;
$$;
create trigger job_requirement_sets_append_only
before update on public.job_requirement_sets
for each row execute function public.reject_m11_requirement_mutation();

create or replace function public.reject_m11_match_input_mutation()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id
    or new.resume_version_id is distinct from old.resume_version_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.requirement_set_id is distinct from old.requirement_set_id
    or new.eligibility is distinct from old.eligibility
    or new.score is distinct from old.score
    or new.reason_codes is distinct from old.reason_codes
    or new.algorithm_version is distinct from old.algorithm_version
    or new.generated_at is distinct from old.generated_at
    or new.idempotency_key is distinct from old.idempotency_key
    or new.evidence_fingerprint is distinct from old.evidence_fingerprint then
    raise exception 'resume match inputs are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger resume_job_matches_immutable_inputs
before update on public.resume_job_matches
for each row execute function public.reject_m11_match_input_mutation();

create or replace function public.m11_assert_claimed_work(
  p_work_item uuid,
  p_lease_token uuid,
  p_work_type public.work_type,
  p_require_running boolean default true
) returns public.work_items
language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  work public.work_items;
begin
  select * into binding from public.worker_role_bindings
  where database_role = session_user;
  if not found then
    raise exception 'WORKER_ROLE_NOT_BOUND' using errcode = '42501';
  end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id
    and kind = 'WORKER'
    and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
    and 'ORCHESTRATION_MUTATE' = any(scopes);
  if not found or not ('RESUME' = any(binding.allowed_work_classes)) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  select * into work from public.work_items
  where id = p_work_item
    and work_class = 'RESUME'
    and work_type = p_work_type
    and lease_token = p_lease_token
    and lease_service_principal_id = binding.service_principal_id
    and lease_expires_at > now()
    and (
      (p_require_running and status = 'RUNNING')
      or (not p_require_running and status in ('LEASED', 'RUNNING'))
    );
  if not found then
    raise exception 'STALE_OR_INVALID_LEASE' using errcode = 'P0001';
  end if;
  return work;
end;
$$;
revoke all on function public.m11_assert_claimed_work(uuid,uuid,public.work_type,boolean)
  from public;

create or replace function public.m11_claimed_attempt_id(
  p_work_item uuid, p_lease_token uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  work public.work_items;
  attempt_id uuid;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token,
    (select work_type from public.work_items where id = p_work_item), false
  );
  select id into attempt_id from public.work_attempts
  where work_item_id = work.id and lease_token = p_lease_token;
  if attempt_id is null then
    raise exception 'CLAIMED_ATTEMPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  return attempt_id;
end;
$$;
revoke all on function public.m11_claimed_attempt_id(uuid,uuid) from public;
grant execute on function public.m11_claimed_attempt_id(uuid,uuid)
  to recruitintel_worker_resume;

drop function if exists public.m11_claimed_resume_object(uuid);
create function public.m11_claimed_resume_object(
  p_work_item uuid, p_lease_token uuid
) returns table(
  user_id uuid,
  resume_version_id uuid,
  media_type text,
  content_hash text,
  storage_ciphertext bytea,
  storage_nonce bytea
)
language plpgsql security definer set search_path = public as $$
declare work public.work_items;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token, 'RESUME_PARSE', true
  );
  return query
  select work.user_id, work.resume_version_id, document.media_type,
    document.content_hash, document.storage_ciphertext, document.storage_nonce
  from public.resume_versions version
  join public.resume_documents document
    on document.id = version.document_id and document.user_id = version.user_id
  join public.users owner on owner.id = version.user_id and owner.status = 'ACTIVE'
  where version.id = work.resume_version_id
    and version.user_id = work.user_id
    and document.status = 'READY'
    and document.deleted_at is null;
end;
$$;
revoke all on function public.m11_claimed_resume_object(uuid,uuid) from public;
grant execute on function public.m11_claimed_resume_object(uuid,uuid)
  to recruitintel_worker_resume;

drop function if exists public.m11_record_claimed_evidence(uuid,text,text,text);
create or replace function public.m11_complete_claimed_parse(
  p_work_item uuid,
  p_lease_token uuid,
  p_parser_version smallint,
  p_input_hash text,
  p_evidence jsonb,
  p_source_span text,
  p_diagnostics jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  work public.work_items;
  item jsonb;
  inserted_count integer := 0;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token, 'RESUME_PARSE', true
  );
  if p_parser_version < 1
    or p_input_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_evidence) <> 'array'
    or jsonb_array_length(p_evidence) > 100
    or jsonb_typeof(p_diagnostics) <> 'object'
    or p_diagnostics ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
    ] then
    raise exception 'INVALID_M11_PARSE_RESULT' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.resume_versions version
    join public.resume_documents document
      on document.id = version.document_id and document.user_id = version.user_id
    join public.users owner on owner.id = version.user_id and owner.status = 'ACTIVE'
    where version.id = work.resume_version_id and version.user_id = work.user_id
      and document.status = 'READY' and document.deleted_at is null
  ) then
    raise exception 'RESUME_TARGET_UNAVAILABLE' using errcode = 'P0001';
  end if;
  for item in select value from jsonb_array_elements(p_evidence)
  loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'skill','') !~ '^[a-z0-9.+#-]{1,60}$'
      or coalesce(item->>'evidenceHash','') !~ '^[0-9a-f]{64}$' then
      raise exception 'INVALID_M11_EVIDENCE' using errcode = '22023';
    end if;
    insert into public.candidate_evidence (
      user_id, resume_version_id, evidence_type, normalized_value, source,
      review_status, section, source_span, parser_version, evidence_hash
    ) values (
      work.user_id, work.resume_version_id, 'SKILL',
      jsonb_build_object('skill', item->>'skill'), 'DETERMINISTIC_PARSE',
      'EXTRACTED', 'skills', left(p_source_span, 500), p_parser_version,
      item->>'evidenceHash'
    ) on conflict (user_id, evidence_hash) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  insert into public.resume_parse_runs (
    user_id, resume_version_id, status, parser_version, input_hash,
    diagnostics, error_code, idempotency_key, started_at, completed_at
  ) values (
    work.user_id, work.resume_version_id, 'SUCCEEDED', p_parser_version,
    p_input_hash, p_diagnostics, null,
    'api:' || work.resume_version_id::text || ':' || p_parser_version::text,
    now(), now()
  ) on conflict (user_id, resume_version_id, idempotency_key) do update set
    status = 'SUCCEEDED', parser_version = excluded.parser_version,
    input_hash = excluded.input_hash, diagnostics = excluded.diagnostics,
    error_code = null, started_at = coalesce(resume_parse_runs.started_at, now()),
    completed_at = now();
  return inserted_count;
end;
$$;
revoke all on function public.m11_complete_claimed_parse(
  uuid,uuid,smallint,text,jsonb,text,jsonb
) from public;
grant execute on function public.m11_complete_claimed_parse(
  uuid,uuid,smallint,text,jsonb,text,jsonb
) to recruitintel_worker_resume;

create or replace function public.m11_mark_claimed_parse_failure(
  p_work_item uuid,
  p_lease_token uuid,
  p_error_code text,
  p_terminal boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare work public.work_items;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token, 'RESUME_PARSE', true
  );
  if p_error_code !~ '^[A-Z][A-Z0-9_]{0,99}$' then
    raise exception 'INVALID_M11_ERROR_CODE' using errcode = '22023';
  end if;
  insert into public.resume_parse_runs (
    user_id, resume_version_id, status, parser_version, input_hash,
    diagnostics, error_code, idempotency_key, started_at, completed_at
  ) select work.user_id, work.resume_version_id,
      case when p_terminal then 'FAILED'::public.resume_parse_status
        else 'QUEUED'::public.resume_parse_status end,
      coalesce(work.parser_version, 1), version.text_hash,
      jsonb_build_object('failureClass','bounded'), p_error_code,
      'api:' || work.resume_version_id::text || ':' || coalesce(work.parser_version,1)::text,
      now(), case when p_terminal then now() else null end
    from public.resume_versions version
    where version.id = work.resume_version_id and version.user_id = work.user_id
  on conflict (user_id, resume_version_id, idempotency_key) do update set
    status = excluded.status, diagnostics = excluded.diagnostics,
    error_code = excluded.error_code,
    started_at = coalesce(resume_parse_runs.started_at, now()),
    completed_at = excluded.completed_at;
end;
$$;
revoke all on function public.m11_mark_claimed_parse_failure(uuid,uuid,text,boolean)
  from public;
grant execute on function public.m11_mark_claimed_parse_failure(uuid,uuid,text,boolean)
  to recruitintel_worker_resume;

drop function if exists public.m11_claimed_match_inputs(uuid);
create function public.m11_claimed_match_inputs(
  p_work_item uuid, p_lease_token uuid
) returns table(
  user_id uuid,
  resume_version_id uuid,
  opportunity_id uuid,
  requirement_set_id uuid,
  requirements jsonb,
  evidence_fingerprint text
)
language plpgsql security definer set search_path = public as $$
declare work public.work_items;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token, 'MATCH_MATERIALIZE', true
  );
  return query
  select work.user_id, work.resume_version_id, work.opportunity_id,
    requirement.id, requirement.requirements,
    encode(digest(coalesce((
      select string_agg(
        evidence.id::text || ':' || evidence.evidence_hash || ':' ||
          evidence.review_version::text || ':' || evidence.review_status::text,
        '|' order by evidence.id
      )
      from public.candidate_evidence evidence
      where evidence.user_id = work.user_id
        and evidence.resume_version_id = work.resume_version_id
        and evidence.superseded_at is null
        and evidence.review_status <> 'REJECTED'
    ), 'none'), 'sha256'), 'hex')
  from public.job_requirement_sets requirement
  join public.resume_versions version
    on version.id = work.resume_version_id and version.user_id = work.user_id
  join public.users owner on owner.id = version.user_id and owner.status = 'ACTIVE'
  where requirement.opportunity_id = work.opportunity_id
  order by requirement.version desc
  limit 1;
end;
$$;
revoke all on function public.m11_claimed_match_inputs(uuid,uuid) from public;
grant execute on function public.m11_claimed_match_inputs(uuid,uuid)
  to recruitintel_worker_resume;

create or replace function public.m11_materialize_claimed_match(
  p_work_item uuid, p_lease_token uuid
) returns table(
  match_id uuid,
  eligibility public.match_eligibility,
  score numeric,
  requirement_set_id uuid,
  evidence_fingerprint text,
  inserted boolean
)
language plpgsql security definer set search_path = public as $$
declare
  work public.work_items;
  requirement public.job_requirement_sets%rowtype;
  opportunity public.job_opportunities%rowtype;
  fingerprint text;
  algorithm text;
  skill_count integer;
  matched_count integer;
  result_eligibility public.match_eligibility;
  result_score numeric;
  result_reasons text[];
  result_match_id uuid;
  was_inserted boolean := false;
  requirement_item record;
  matching_evidence public.candidate_evidence%rowtype;
begin
  work := public.m11_assert_claimed_work(
    p_work_item, p_lease_token, 'MATCH_MATERIALIZE', true
  );
  if not exists (
    select 1 from public.resume_versions version
    join public.resume_documents document
      on document.id = version.document_id and document.user_id = version.user_id
    join public.users owner on owner.id = version.user_id and owner.status = 'ACTIVE'
    where version.id = work.resume_version_id and version.user_id = work.user_id
      and document.status = 'READY' and document.deleted_at is null
  ) then
    raise exception 'MATCH_TARGET_UNAVAILABLE' using errcode = 'P0001';
  end if;
  select * into requirement from public.job_requirement_sets
  where opportunity_id = work.opportunity_id
  order by version desc limit 1;
  if not found then
    raise exception 'MATCH_REQUIREMENT_SET_MISSING' using errcode = '22023';
  end if;
  select * into opportunity from public.job_opportunities
  where id = work.opportunity_id;
  if not found then
    raise exception 'MATCH_OPPORTUNITY_MISSING' using errcode = '22023';
  end if;
  select encode(digest(coalesce(string_agg(
      evidence.id::text || ':' || evidence.evidence_hash || ':' ||
        evidence.review_version::text || ':' || evidence.review_status::text,
      '|' order by evidence.id
    ), 'none'), 'sha256'), 'hex') into fingerprint
  from public.candidate_evidence evidence
  where evidence.user_id = work.user_id
    and evidence.resume_version_id = work.resume_version_id
    and evidence.superseded_at is null
    and evidence.review_status <> 'REJECTED';
  select count(*)::int into skill_count
  from jsonb_array_elements(coalesce(requirement.requirements->'requirements','[]'::jsonb)) item
  where upper(item->>'type') = 'SKILL' and coalesce((item->>'explicit')::boolean,false);
  select count(*)::int into matched_count
  from jsonb_array_elements(coalesce(requirement.requirements->'requirements','[]'::jsonb)) item
  where upper(item->>'type') = 'SKILL'
    and coalesce((item->>'explicit')::boolean,false)
    and exists (
      select 1 from public.candidate_evidence evidence
      where evidence.user_id = work.user_id
        and evidence.resume_version_id = work.resume_version_id
        and evidence.evidence_type = 'SKILL'
        and evidence.superseded_at is null
        and evidence.review_status <> 'REJECTED'
        and lower(evidence.normalized_value->>'skill') = lower(
          coalesce(item->'normalized_value'->>'skill', item->'normalized_value'->>'value')
        )
    );
  if opportunity.status <> 'ACTIVE' then
    result_eligibility := 'NOT_ELIGIBLE';
    result_score := 0;
    result_reasons := array['OPPORTUNITY_NOT_ACTIVE'];
  elsif skill_count = 0 then
    result_eligibility := 'UNKNOWN';
    result_score := null;
    result_reasons := array['REQUIREMENTS_UNKNOWN'];
  elsif matched_count < skill_count then
    result_eligibility := 'UNKNOWN';
    result_score := round((matched_count::numeric / skill_count::numeric) * 100);
    result_reasons := array['REQUIREMENTS_UNSUPPORTED'];
  else
    result_eligibility := 'ELIGIBLE';
    result_score := 100;
    result_reasons := array['ALL_EXPLICIT_SKILLS_SUPPORTED'];
  end if;
  algorithm := coalesce(nullif(work.algorithm_version,''), 'resume-coverage-v1');
  insert into public.resume_job_matches (
    user_id, resume_version_id, opportunity_id, requirement_set_id,
    eligibility, score, reason_codes, algorithm_version, idempotency_key,
    evidence_fingerprint
  ) values (
    work.user_id, work.resume_version_id, work.opportunity_id, requirement.id,
    result_eligibility, result_score, result_reasons, algorithm,
    work.resume_version_id::text || ':' || work.opportunity_id::text || ':' ||
      requirement.id::text || ':' || algorithm || ':' || fingerprint,
    fingerprint
  ) on conflict do nothing returning id into result_match_id;
  if result_match_id is not null then
    was_inserted := true;
  else
    select existing.id into result_match_id
    from public.resume_job_matches existing
    where existing.user_id = work.user_id
      and existing.resume_version_id = work.resume_version_id
      and existing.opportunity_id = work.opportunity_id
      and existing.requirement_set_id = requirement.id
      and existing.algorithm_version = algorithm
      and existing.evidence_fingerprint = fingerprint;
  end if;
  for requirement_item in
    select distinct
      lower(coalesce(item->'normalized_value'->>'skill', item->'normalized_value'->>'value')) as key
    from jsonb_array_elements(coalesce(requirement.requirements->'requirements','[]'::jsonb)) item
    where upper(item->>'type') = 'SKILL'
      and coalesce((item->>'explicit')::boolean,false)
      and coalesce(item->'normalized_value'->>'skill', item->'normalized_value'->>'value') is not null
  loop
    select * into matching_evidence from public.candidate_evidence evidence
    where evidence.user_id = work.user_id
      and evidence.resume_version_id = work.resume_version_id
      and evidence.evidence_type = 'SKILL'
      and evidence.superseded_at is null
      and evidence.review_status <> 'REJECTED'
      and lower(evidence.normalized_value->>'skill') = requirement_item.key
    order by (evidence.review_status = 'CONFIRMED') desc, evidence.created_at, evidence.id
    limit 1;
    insert into public.match_evidence (
      match_id, user_id, requirement_key, relation, evidence_id,
      reason_code, citation
    ) values (
      result_match_id, work.user_id, requirement_item.key,
      case when matching_evidence.id is null then 'UNKNOWN'::public.match_relation
        else 'SATISFIES'::public.match_relation end,
      matching_evidence.id,
      case when matching_evidence.id is null then 'NO_EXPLICIT_EVIDENCE'
        else 'EXPLICIT_SKILL_EVIDENCE' end,
      jsonb_strip_nulls(jsonb_build_object(
        'resumeVersionId', work.resume_version_id,
        'requirementSetId', requirement.id,
        'evidenceId', matching_evidence.id,
        'section', matching_evidence.section,
        'sourceSpan', matching_evidence.source_span
      ))
    ) on conflict do nothing;
  end loop;
  return query select result_match_id, result_eligibility, result_score,
    requirement.id, fingerprint, was_inserted;
end;
$$;
revoke all on function public.m11_materialize_claimed_match(uuid,uuid) from public;
grant execute on function public.m11_materialize_claimed_match(uuid,uuid)
  to recruitintel_worker_resume;

-- The runtime role can only operate through the lease-bound security-definer
-- functions above and the existing M7 claim/start/heartbeat/finish functions.
revoke all privileges on all tables in schema public from recruitintel_worker_resume;
revoke all privileges on all sequences in schema public from recruitintel_worker_resume;
grant usage on schema public to recruitintel_worker_resume;
grant execute on function public.claim_work_items(
  text, public.work_class[], integer, integer
) to recruitintel_worker_resume;
grant execute on function public.start_work_attempt(uuid,uuid),
  public.heartbeat_work_attempt(uuid,uuid,integer),
  public.finish_work_attempt(
    uuid,uuid,boolean,public.work_failure_classification,text,jsonb,
    public.coverage_status,integer,integer,integer,integer
  ) to recruitintel_worker_resume;

comment on role recruitintel_worker_resume is
  'Lease-fenced M11 resume parse/match capability with no direct table access.';
