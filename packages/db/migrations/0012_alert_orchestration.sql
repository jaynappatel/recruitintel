-- Milestone 9 orchestration wiring. This is separate from 0011 because PostgreSQL
-- enum additions cannot be consumed safely until the transaction adding them commits.

create function public.enqueue_m9_alert_evaluation()
returns trigger language plpgsql set search_path = public as $$
declare
  request_id uuid;
  request_owner uuid;
  request_trigger public.alert_evaluation_trigger;
  request_fingerprint text;
  opportunity_change uuid;
  recruiting_event uuid;
  recruiting_date uuid;
  recruiter_profile uuid;
  campus_event uuid;
  interview_question uuid;
  calendar_item uuid;
  request_context jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'opportunity_change_events' then
    if new.event_type in ('BASELINE', 'CLOSED', 'MERGED', 'SPLIT') then return new; end if;
    request_trigger := 'OPPORTUNITY_CHANGE';
    opportunity_change := new.id;
    request_context := jsonb_build_object('eventKind', new.event_type::text);
    request_fingerprint := encode(digest('m9:opportunity-change:' || new.id::text, 'sha256'), 'hex');
  elsif tg_table_name = 'recruiter_profiles' then
    request_trigger := 'RECRUITER'; recruiter_profile := new.id;
    request_context := '{"eventKind":"RECRUITER_DISCOVERED"}'::jsonb;
    request_fingerprint := encode(digest('m9:recruiter-discovered:' || new.id::text, 'sha256'), 'hex');
  elsif tg_table_name = 'recruiter_evidence' then
    request_trigger := 'RECRUITER'; recruiter_profile := new.recruiter_profile_id;
    request_context := '{"eventKind":"RECRUITER_ACTIVITY"}'::jsonb;
    request_fingerprint := encode(digest('m9:recruiter-activity:' || new.id::text, 'sha256'), 'hex');
  elsif tg_table_name = 'campus_recruiting_events' then
    if tg_op = 'UPDATE' and old.content_hash = new.content_hash
        and old.starts_at is not distinct from new.starts_at
        and old.date_start is not distinct from new.date_start then return new; end if;
    request_trigger := 'CAMPUS_EVENT'; campus_event := new.id;
    request_context := '{"eventKind":"CAMPUS_EVENT_DISCOVERED"}'::jsonb;
    request_fingerprint := encode(digest(
      'm9:campus:' || new.id::text || ':' || new.content_hash, 'sha256'
    ), 'hex');
  elsif tg_table_name = 'company_interview_questions' then
    if tg_op = 'UPDATE' and old.observation_count = new.observation_count
        and old.last_seen_at = new.last_seen_at and old.confidence = new.confidence then return new; end if;
    request_trigger := 'INTERVIEW_INTELLIGENCE'; interview_question := new.id;
    request_context := '{"eventKind":"INTERVIEW_INTELLIGENCE_UPDATED"}'::jsonb;
    request_fingerprint := encode(digest(
      'm9:interview:' || new.id::text || ':' || new.observation_count::text || ':' ||
      new.last_seen_at::text, 'sha256'
    ), 'hex');
  elsif tg_table_name = 'recruiting_dates' then
    if new.type not in (
      'APPLICATION_OPEN', 'APPLICATION_DEADLINE', 'EXPECTED_OPENING_WINDOW',
      'CAREER_FAIR', 'CAMPUS_EVENT', 'INFO_SESSION', 'INTERVIEW_EVENT'
    ) then return new; end if;
    if tg_op = 'UPDATE' and old.starts_at = new.starts_at and old.ends_at is not distinct from new.ends_at
        and old.type = new.type and old.date_certainty = new.date_certainty then return new; end if;
    request_trigger := 'RECRUITING_DATE'; recruiting_date := new.id;
    request_context := jsonb_build_object('eventKind', new.type::text);
    request_fingerprint := encode(digest(
      'm9:recruiting-date:' || new.id::text || ':' || new.type::text || ':' ||
      new.starts_at::text || ':' || coalesce(new.ends_at::text, ''), 'sha256'
    ), 'hex');
  elsif tg_table_name = 'calendar_items' then
    if new.status <> 'TODO' or new.deleted_at is not null then return new; end if;
    if tg_op = 'UPDATE' and old.starts_at = new.starts_at and old.status = new.status
        and old.deleted_at is not distinct from new.deleted_at then return new; end if;
    request_owner := new.user_id; request_trigger := 'CALENDAR_ITEM'; calendar_item := new.id;
    request_context := '{"eventKind":"CALENDAR_ACTION_DUE"}'::jsonb;
    request_fingerprint := encode(digest(
      'm9:calendar:' || new.user_id::text || ':' || new.id::text || ':' || new.starts_at::text,
      'sha256'
    ), 'hex');
  elsif tg_table_name = 'recruiting_events' then
    if new.event_type not in ('RECRUITER_DISCOVERED', 'RECRUITER_ACTIVITY') then return new; end if;
    request_trigger := 'RECRUITING_EVENT'; recruiting_event := new.id;
    request_context := jsonb_build_object('eventKind', new.event_type::text);
    request_fingerprint := encode(digest('m9:recruiting-event:' || new.id::text, 'sha256'), 'hex');
  else
    raise exception 'M9_ALERT_TRIGGER_UNSUPPORTED_TABLE';
  end if;

  insert into public.alert_evaluation_requests (
    user_id, trigger_type, opportunity_change_event_id, recruiting_event_id,
    recruiting_date_id, recruiter_profile_id, campus_recruiting_event_id,
    company_interview_question_id, calendar_item_id, request_fingerprint
    , safe_context
  ) values (
    request_owner, request_trigger, opportunity_change, recruiting_event,
    recruiting_date, recruiter_profile, campus_event, interview_question,
    calendar_item, request_fingerprint, request_context
  ) on conflict (request_fingerprint) do update
    set request_fingerprint = excluded.request_fingerprint
  returning id into request_id;

  if request_owner is null then
    insert into public.work_items (
      work_type, work_class, alert_evaluation_request_id, priority,
      idempotency_fingerprint, exclusive_key, correlation_id
    ) values (
      'ALERT_FANOUT', 'PERSONALIZATION', request_id, 55,
      encode(digest('m9:fanout:' || request_id::text || ':root', 'sha256'), 'hex'),
      'm9-alert-fanout:' || request_id::text, gen_random_uuid()
    ) on conflict (idempotency_fingerprint) do nothing;
  else
    insert into public.work_items (
      work_type, work_class, alert_evaluation_request_id, user_id, priority,
      idempotency_fingerprint, exclusive_key, correlation_id
    ) values (
      'ALERT_EVALUATE', 'PERSONALIZATION', request_id, request_owner, 60,
      encode(digest('m9:evaluate:' || request_id::text || ':' || request_owner::text,
        'sha256'), 'hex'),
      'm9-alert-user:' || request_owner::text, gen_random_uuid()
    ) on conflict (idempotency_fingerprint) do nothing;
  end if;
  return new;
end;
$$;

create trigger opportunity_changes_enqueue_alert_evaluation
after insert on public.opportunity_change_events
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger recruiter_profiles_enqueue_alert_evaluation
after insert on public.recruiter_profiles
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger recruiter_evidence_enqueue_alert_evaluation
after insert on public.recruiter_evidence
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger campus_events_enqueue_alert_evaluation
after insert or update of content_hash, starts_at, date_start on public.campus_recruiting_events
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger interview_intelligence_enqueue_alert_evaluation
after insert or update of observation_count, last_seen_at, confidence
on public.company_interview_questions
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger recruiting_dates_enqueue_alert_evaluation
after insert or update of type, starts_at, ends_at, date_certainty on public.recruiting_dates
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger calendar_items_enqueue_alert_evaluation
after insert or update of starts_at, status, deleted_at on public.calendar_items
for each row execute function public.enqueue_m9_alert_evaluation();
create trigger recruiting_events_enqueue_alert_evaluation
after insert on public.recruiting_events
for each row execute function public.enqueue_m9_alert_evaluation();

insert into public.schedules (
  name, work_type, work_class, enabled, schedule_kind, interval_seconds,
  next_run_at, jitter_seconds, priority, max_attempts, retry_policy,
  catch_up, created_by_actor
) values (
  'm9-alert-due-scan', 'ALERT_FANOUT', 'PERSONALIZATION', true,
  'INTERVAL', 3600, date_trunc('hour', now()) + interval '1 hour',
  120, 40, 3, 'EXPONENTIAL_V1', 'LATEST_ONLY', 'SYSTEM'
) on conflict (name) do nothing;

-- Project orchestration completion into the M9 request without introducing a second queue.
create or replace function public.project_domain_request_status(
  work public.work_items, next_status public.work_status, safe_code text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if work.github_sync_request_id is not null then
    update public.github_sync_requests set
      status = case next_status when 'SUCCEEDED' then 'SUCCEEDED'::public.github_sync_request_status
        when 'CANCELLED' then 'CANCELLED'::public.github_sync_request_status
        when 'READY' then 'PENDING'::public.github_sync_request_status
        when 'RETRY_WAIT' then 'PENDING'::public.github_sync_request_status
        else 'FAILED'::public.github_sync_request_status end,
      started_at = case when next_status in ('READY', 'RETRY_WAIT') then null else started_at end,
      finished_at = case when next_status in ('READY', 'RETRY_WAIT') then null else now() end,
      error_message = safe_code
    where id = work.github_sync_request_id;
  elsif work.public_web_work_request_id is not null then
    update public.public_web_work_requests set
      status = case next_status when 'SUCCEEDED' then 'SUCCEEDED'::public.public_web_work_status
        when 'CANCELLED' then 'CANCELLED'::public.public_web_work_status
        when 'READY' then 'PENDING'::public.public_web_work_status
        when 'RETRY_WAIT' then 'PENDING'::public.public_web_work_status
        else 'FAILED'::public.public_web_work_status end,
      started_at = case when next_status in ('READY', 'RETRY_WAIT') then null else started_at end,
      finished_at = case when next_status in ('READY', 'RETRY_WAIT') then null else now() end,
      next_attempt_at = work.available_at, error_message = safe_code
    where id = work.public_web_work_request_id;
  elsif work.calendar_sync_request_id is not null then
    update public.calendar_sync_requests set
      status = case next_status when 'SUCCEEDED' then 'SUCCEEDED'::public.calendar_work_status
        when 'CANCELLED' then 'CANCELLED'::public.calendar_work_status
        when 'READY' then 'PENDING'::public.calendar_work_status
        when 'RETRY_WAIT' then 'PENDING'::public.calendar_work_status
        else 'FAILED'::public.calendar_work_status end,
      started_at = case when next_status in ('READY', 'RETRY_WAIT') then null else started_at end,
      finished_at = case when next_status in ('READY', 'RETRY_WAIT') then null else now() end,
      next_attempt_at = work.available_at, error_code = safe_code
    where id = work.calendar_sync_request_id;
  elsif work.alert_evaluation_request_id is not null then
    update public.alert_evaluation_requests set
      status = case next_status
        when 'SUCCEEDED' then 'SUCCEEDED'::public.alert_evaluation_status
        when 'CANCELLED' then 'CANCELLED'::public.alert_evaluation_status
        when 'READY' then 'PENDING'::public.alert_evaluation_status
        when 'RETRY_WAIT' then 'PENDING'::public.alert_evaluation_status
        else 'FAILED'::public.alert_evaluation_status end,
      started_at = case
        when next_status in ('LEASED', 'RUNNING') then coalesce(started_at, now())
        when next_status in ('READY', 'RETRY_WAIT') then null else started_at end,
      finished_at = case when next_status in ('READY', 'RETRY_WAIT') then null else now() end,
      error_code = safe_code
    where id = work.alert_evaluation_request_id;
  end if;
end;
$$;

-- Require the dedicated scope for the new private-data work class.
create or replace function public.claim_work_items(
  worker text, classes public.work_class[], claim_limit integer,
  lease_duration_seconds integer
) returns setof public.work_items
language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  blocked public.work_items;
begin
  if claim_limit < 1 or claim_limit > 100 then
    raise exception 'claim_limit must be between 1 and 100';
  end if;
  if lease_duration_seconds < 30 or lease_duration_seconds > 3600 then
    raise exception 'lease duration must be between 30 and 3600 seconds';
  end if;
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found then raise exception 'WORKER_ROLE_NOT_BOUND' using errcode = '42501'; end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id and kind = 'WORKER' and status = 'ACTIVE'
    and (expires_at is null or expires_at > now());
  if not found then raise exception 'WORKER_SERVICE_PRINCIPAL_INACTIVE' using errcode = '42501'; end if;
  if not classes <@ binding.allowed_work_classes then
    raise exception 'WORK_CLASS_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'CALENDAR' = any(classes) and not 'WORKER_CALENDAR_SYNC' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'PRIVACY' = any(classes) and not 'WORKER_PRIVACY' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'PERSONALIZATION' = any(classes)
      and not 'WORKER_PERSONALIZATION' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if classes && array['ATS', 'GITHUB', 'WEB_SEARCH', 'WEB_FETCH', 'PROJECTION']::public.work_class[]
      and not 'WORKER_GLOBAL' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'CONTROL' = any(classes)
      and not ('WORKER_GLOBAL' = any(principal.scopes)
        or (binding.can_schedule and 'WORKER_SCHEDULER' = any(principal.scopes))) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;

  for blocked in
    update public.work_items work set
      status = 'POLICY_BLOCKED', completed_at = now(),
      last_error_classification = 'POLICY_BLOCKED', last_error_code = 'SOURCE_POLICY_BLOCKED',
      safe_diagnostics = '{"reason":"source_policy_not_executable"}'::jsonb
    where work.status in ('READY', 'RETRY_WAIT') and work.available_at <= now()
      and work.work_class = any(classes) and work.source_id is not null
      and not public.source_policy_is_executable(work.source_id)
    returning work.*
  loop
    perform public.project_domain_request_status(blocked, 'POLICY_BLOCKED', 'SOURCE_POLICY_BLOCKED');
  end loop;

  return query
  with candidates as (
    select id from public.work_items
    where status in ('READY', 'RETRY_WAIT') and available_at <= now()
      and work_class = any(classes)
    order by priority desc, available_at, created_at, id
    for update skip locked limit claim_limit
  ), claimed as (
    update public.work_items work set
      status = 'LEASED', attempt_count = work.attempt_count + 1,
      lease_owner = worker, lease_service_principal_id = binding.service_principal_id,
      lease_token = gen_random_uuid(), lease_generation = work.lease_generation + 1,
      lease_expires_at = now() + make_interval(secs => lease_duration_seconds),
      heartbeat_at = now(), first_started_at = coalesce(work.first_started_at, now()),
      last_error_classification = null, last_error_code = null,
      safe_diagnostics = '{}'::jsonb
    from candidates where work.id = candidates.id returning work.*
  ), attempts as (
    insert into public.work_attempts (
      work_item_id, attempt_number, worker_instance, service_principal_id,
      lease_token, lease_generation, queue_delay_ms, provider, source_id
    )
    select id, attempt_count, worker, lease_service_principal_id, lease_token,
      lease_generation,
      greatest(0, floor(extract(epoch from (now() - available_at)) * 1000))::bigint,
      coalesce((select source.provider from public.sources source where source.id = claimed.source_id),
        case when claimed.work_type = 'CALENDAR_SYNC' then 'google'
             when claimed.work_class = 'PERSONALIZATION' then 'in_app' end),
      source_id from claimed returning work_item_id
  )
  select claimed.* from claimed join attempts on attempts.work_item_id = claimed.id;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_worker_personalization') then
    create role recruitintel_worker_personalization nologin;
  end if;
end $$;

revoke all on function public.claim_work_items(text, public.work_class[], integer, integer)
  from public;
grant execute on function public.claim_work_items(text, public.work_class[], integer, integer)
  to recruitintel_worker_global, recruitintel_worker_calendar, recruitintel_worker_privacy,
     recruitintel_worker_personalization;
grant execute on function public.start_work_attempt(uuid, uuid),
  public.heartbeat_work_attempt(uuid, uuid, integer) to recruitintel_worker_personalization;
grant execute on function public.finish_work_attempt(
  uuid, uuid, boolean, public.work_failure_classification, text, jsonb,
  public.coverage_status, integer, integer, integer, integer
) to recruitintel_worker_personalization;
grant usage on schema public to recruitintel_worker_personalization;
grant select on table
  public.users, public.companies, public.jobs, public.job_opportunities,
  public.job_opportunity_postings, public.job_locations, public.job_constraints,
  public.source_job_capabilities, public.opportunity_change_events,
  public.watchlist_items, public.user_recruiting_preferences,
  public.user_preferred_role_families, public.user_preferred_early_career_tracks,
  public.user_preferred_experience_levels, public.user_preferred_workplace_modes,
  public.user_preferred_locations, public.user_target_schools,
  public.user_notification_preferences, public.user_alert_type_preferences,
  public.opportunity_suppressions, public.recruiter_profiles, public.recruiter_evidence,
  public.people, public.schools, public.campus_recruiting_events,
  public.company_interview_questions, public.recruiting_events,
  public.recruiting_dates, public.calendar_items, public.alert_evaluation_requests,
  public.ranking_decisions, public.recommendation_impressions, public.alerts,
  public.work_items
to recruitintel_worker_personalization;
grant insert, update on table public.alerts, public.alert_evaluation_requests,
  public.work_items to recruitintel_worker_personalization;

comment on function public.enqueue_m9_alert_evaluation() is
  'Transactional, idempotent bridge from meaningful domain changes into M7 work.';
comment on role recruitintel_worker_personalization is
  'Narrow M9 in-app recommendation/alert worker capability; no external delivery access.';
