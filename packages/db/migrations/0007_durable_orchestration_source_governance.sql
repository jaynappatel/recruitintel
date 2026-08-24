create type public.work_type as enum (
  'ATS_COLLECT', 'GITHUB_SYNC', 'PUBLIC_WEB_SEARCH', 'PUBLIC_WEB_FETCH',
  'PUBLIC_WEB_PROCESS', 'RECRUITER_CAMPUS_PROJECT', 'CALENDAR_SYNC',
  'PRIVACY_RETENTION_CLEANUP', 'SOURCE_HEALTH_ROLLUP'
);

create type public.work_class as enum (
  'ATS', 'GITHUB', 'WEB_SEARCH', 'WEB_FETCH', 'PROJECTION',
  'CALENDAR', 'PRIVACY', 'CONTROL'
);

create type public.work_status as enum (
  'READY', 'LEASED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'CANCELLED',
  'DEAD_LETTERED', 'AUTH_REQUIRED', 'POLICY_BLOCKED'
);

create type public.work_attempt_status as enum (
  'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABANDONED', 'CANCELLED'
);

create type public.work_failure_classification as enum (
  'RETRYABLE', 'NON_RETRYABLE', 'RATE_LIMITED', 'AUTH_REQUIRED', 'POLICY_BLOCKED'
);

create type public.schedule_kind as enum ('INTERVAL', 'DAILY_AT');
create type public.schedule_catch_up as enum ('SKIP', 'LATEST_ONLY');

create type public.source_policy_status as enum (
  'ALLOWED', 'ALLOWED_WITH_LIMITS', 'MANUAL_ONLY', 'BLOCKED', 'REVIEW_REQUIRED'
);

create type public.collection_method as enum (
  'OFFICIAL_API', 'ROBOTS_PERMITTED_HTTP', 'MANUAL_REFERENCE_ONLY',
  'USER_SUBMITTED_REFERENCE'
);

create type public.robots_policy_mode as enum (
  'NOT_APPLICABLE', 'RESPECT_REQUIRED', 'DISALLOW_AUTOMATION'
);

create type public.coverage_status as enum (
  'COMPLETE', 'PARTIAL', 'UNKNOWN', 'BLOCKED', 'STALE'
);

create type public.source_incident_type as enum (
  'CONSECUTIVE_FAILURES', 'STALE', 'RATE_LIMIT_PRESSURE',
  'COVERAGE_PARTIAL', 'COUNT_ANOMALY'
);

create type public.source_incident_status as enum ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

alter type public.service_scope add value 'ORCHESTRATION_READ';
alter type public.service_scope add value 'ORCHESTRATION_MUTATE';
alter type public.service_scope add value 'WORKER_SCHEDULER';
alter type public.service_scope add value 'WORKER_GLOBAL';
alter type public.service_scope add value 'WORKER_PRIVACY';

create table public.source_policies (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider ~ '^[a-z0-9_-]+$'),
  display_name text not null check (btrim(display_name) <> ''),
  status public.source_policy_status not null default 'REVIEW_REQUIRED',
  collection_method public.collection_method not null,
  official_api_available boolean not null default false,
  authentication_mode text not null default 'NONE'
    check (authentication_mode in ('NONE', 'API_TOKEN', 'OAUTH', 'OTHER')),
  robots_policy public.robots_policy_mode not null default 'NOT_APPLICABLE',
  rate_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(rate_policy) = 'object'),
  retention_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(retention_policy) = 'object'),
  content_restrictions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(content_restrictions) = 'object'),
  allowed_uses text[] not null default '{}',
  terms_status text not null default 'NOT_REVIEWED'
    check (terms_status in ('NOT_REVIEWED', 'REVIEWED', 'REVIEW_EXPIRED')),
  terms_url text check (terms_url is null or terms_url ~ '^https://'),
  reviewed_at timestamptz,
  reviewed_by text,
  maintainer text,
  policy_version integer not null default 1 check (policy_version > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('ALLOWED', 'ALLOWED_WITH_LIMITS')
      and terms_status = 'REVIEWED' and reviewed_at is not null and btrim(reviewed_by) <> '')
    or status not in ('ALLOWED', 'ALLOWED_WITH_LIMITS')
  )
);

create table public.source_policy_host_rules (
  id uuid primary key default gen_random_uuid(),
  source_policy_id uuid not null references public.source_policies(id) on delete cascade,
  hostname_suffix text not null check (
    hostname_suffix = lower(hostname_suffix)
    and hostname_suffix !~ '[/:@* ]'
    and btrim(hostname_suffix) <> ''
  ),
  allow_subdomains boolean not null default false,
  https_required boolean not null default true,
  allowed_ports integer[] not null default '{443}' check (
    cardinality(allowed_ports) > 0 and array_position(allowed_ports, null) is null
  ),
  created_at timestamptz not null default now(),
  unique (source_policy_id, hostname_suffix)
);

-- Existing providers are deliberately not approved by this migration. An operator must
-- record a real review before automated scheduling is enabled.
insert into public.source_policies (
  provider, display_name, collection_method, official_api_available, robots_policy
)
select distinct
  provider,
  initcap(replace(provider, '_', ' ')),
  case
    when bool_or(source_type in ('ATS', 'GITHUB'))
      then 'OFFICIAL_API'::public.collection_method
    when bool_or(source_type in ('PUBLIC_WEB', 'COMPANY_CAREERS', 'COMPANY_BLOG',
                                 'UNIVERSITY', 'FORUM', 'RECRUITER_PUBLIC_PAGE'))
      then 'ROBOTS_PERMITTED_HTTP'::public.collection_method
    else 'MANUAL_REFERENCE_ONLY'::public.collection_method
  end,
  bool_or(source_type in ('ATS', 'GITHUB')),
  case
    when bool_or(source_type in ('PUBLIC_WEB', 'COMPANY_CAREERS', 'COMPANY_BLOG',
                                 'UNIVERSITY', 'FORUM', 'RECRUITER_PUBLIC_PAGE'))
      then 'RESPECT_REQUIRED'::public.robots_policy_mode
    else 'NOT_APPLICABLE'::public.robots_policy_mode
  end
from public.sources
group by provider
on conflict (provider) do nothing;

insert into public.source_policies (
  provider, display_name, collection_method, official_api_available,
  authentication_mode, robots_policy, notes
) values
  (
    'greenhouse', 'Greenhouse Job Board API', 'OFFICIAL_API', true, 'NONE',
    'NOT_APPLICABLE', 'Collection remains disabled until an operator records a terms review.'
  ),
  (
    'lever', 'Lever Postings API', 'OFFICIAL_API', true, 'NONE',
    'NOT_APPLICABLE', 'Collection remains disabled until an operator records a terms review.'
  ),
  (
    'github', 'GitHub API', 'OFFICIAL_API', true, 'API_TOKEN',
    'NOT_APPLICABLE', 'Collection remains disabled until an operator records a terms review.'
  ),
  (
    'web_search', 'Public-web search registry', 'OFFICIAL_API', false, 'OTHER',
    'NOT_APPLICABLE', 'Only the static provider exists; live provider selection is Gate 7.1.'
  ),
  (
    'public_web', 'Public-web fetch', 'ROBOTS_PERMITTED_HTTP', false, 'NONE',
    'RESPECT_REQUIRED', 'Every hostname additionally requires an explicit host rule.'
  ),
  (
    'manual', 'Manual reference source', 'MANUAL_REFERENCE_ONLY', false, 'NONE',
    'NOT_APPLICABLE', 'Manual evidence is never scheduled for automated fetching.'
  )
on conflict (provider) do nothing;

alter table public.sources add column source_policy_id uuid
  references public.source_policies(id) on delete restrict;
update public.sources source
set source_policy_id = policy.id
from public.source_policies policy
where policy.provider = source.provider and source.source_policy_id is null;
create index sources_policy_idx on public.sources (source_policy_id, enabled, id);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> ''),
  work_type public.work_type not null,
  work_class public.work_class not null,
  source_id uuid references public.sources(id) on delete cascade,
  github_repository_id uuid references public.github_repositories(id) on delete cascade,
  public_web_search_query_id uuid
    references public.public_web_search_queries(id) on delete cascade,
  enabled boolean not null default false,
  schedule_kind public.schedule_kind not null,
  interval_seconds integer check (interval_seconds is null or interval_seconds between 60 and 2592000),
  daily_local_time time,
  timezone text check (timezone is null or btrim(timezone) <> ''),
  anchor_at timestamptz,
  next_run_at timestamptz not null,
  last_enqueued_for timestamptz,
  jitter_seconds integer not null default 0 check (jitter_seconds between 0 and 3600),
  priority smallint not null default 50 check (priority between 0 and 100),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  retry_policy text not null default 'EXPONENTIAL_V1'
    check (retry_policy in ('EXPONENTIAL_V1', 'NO_RETRY')),
  catch_up public.schedule_catch_up not null default 'LATEST_ONLY',
  created_by_actor public.actor_kind not null default 'SYSTEM',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_by_service_principal_id uuid
    references public.service_principals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (schedule_kind = 'INTERVAL' and interval_seconds is not null
      and daily_local_time is null and timezone is null)
    or
    (schedule_kind = 'DAILY_AT' and interval_seconds is null
      and daily_local_time is not null and timezone is not null)
  ),
  check (
    (work_type = 'ATS_COLLECT' and source_id is not null
      and github_repository_id is null and public_web_search_query_id is null)
    or
    (work_type = 'GITHUB_SYNC' and source_id is null
      and github_repository_id is not null and public_web_search_query_id is null)
    or
    (work_type = 'PUBLIC_WEB_SEARCH' and source_id is null
      and github_repository_id is null and public_web_search_query_id is not null)
    or
    (work_type in ('PRIVACY_RETENTION_CLEANUP', 'SOURCE_HEALTH_ROLLUP')
      and source_id is null and github_repository_id is null
      and public_web_search_query_id is null)
  )
);
create index schedules_due_idx on public.schedules (next_run_at, priority desc, id) where enabled;

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  work_type public.work_type not null,
  work_class public.work_class not null,
  handler_version integer not null default 1 check (handler_version > 0),
  schedule_id uuid references public.schedules(id) on delete set null,
  source_id uuid references public.sources(id) on delete cascade,
  github_sync_request_id uuid
    references public.github_sync_requests(id) on delete cascade,
  public_web_work_request_id uuid
    references public.public_web_work_requests(id) on delete cascade,
  calendar_sync_request_id uuid
    references public.calendar_sync_requests(id) on delete cascade,
  recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  requesting_actor_kind public.actor_kind not null default 'SYSTEM',
  requesting_user_id uuid references public.users(id) on delete set null,
  requesting_service_principal_id uuid
    references public.service_principals(id) on delete set null,
  priority smallint not null default 50 check (priority between 0 and 100),
  scheduled_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  status public.work_status not null default 'READY',
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  retry_policy text not null default 'EXPONENTIAL_V1'
    check (retry_policy in ('EXPONENTIAL_V1', 'NO_RETRY')),
  retry_policy_version smallint not null default 1 check (retry_policy_version > 0),
  lease_owner text,
  lease_service_principal_id uuid
    references public.service_principals(id) on delete set null,
  lease_token uuid,
  lease_generation integer not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  idempotency_fingerprint text not null unique check (btrim(idempotency_fingerprint) <> ''),
  exclusive_key text check (exclusive_key is null or btrim(exclusive_key) <> ''),
  correlation_id uuid not null default gen_random_uuid(),
  causation_id uuid references public.work_items(id) on delete set null,
  parent_work_item_id uuid references public.work_items(id) on delete set null,
  requeued_from_id uuid references public.work_items(id) on delete set null,
  cancel_requested_at timestamptz,
  first_started_at timestamptz,
  completed_at timestamptz,
  last_error_classification public.work_failure_classification,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'
  ),
  safe_diagnostics jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_diagnostics) = 'object'
    and not safe_diagnostics ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('LEASED', 'RUNNING') and lease_owner is not null
      and lease_token is not null and lease_expires_at is not null)
    or
    (status not in ('LEASED', 'RUNNING') and lease_owner is null
      and lease_token is null and lease_expires_at is null)
  ),
  check (
    (work_type = 'ATS_COLLECT' and source_id is not null
      and github_sync_request_id is null and public_web_work_request_id is null
      and calendar_sync_request_id is null and recruiting_observation_id is null
      and user_id is null)
    or
    (work_type = 'GITHUB_SYNC' and source_id is not null
      and github_sync_request_id is not null and public_web_work_request_id is null
      and calendar_sync_request_id is null and recruiting_observation_id is null
      and user_id is null)
    or
    (work_type in ('PUBLIC_WEB_SEARCH', 'PUBLIC_WEB_FETCH', 'PUBLIC_WEB_PROCESS')
      and source_id is not null and public_web_work_request_id is not null
      and github_sync_request_id is null and calendar_sync_request_id is null
      and recruiting_observation_id is null and user_id is null)
    or
    (work_type = 'RECRUITER_CAMPUS_PROJECT' and recruiting_observation_id is not null
      and github_sync_request_id is null and public_web_work_request_id is null
      and calendar_sync_request_id is null and user_id is null)
    or
    (work_type = 'CALENDAR_SYNC' and calendar_sync_request_id is not null
      and user_id is not null and github_sync_request_id is null
      and public_web_work_request_id is null and recruiting_observation_id is null
      and source_id is null)
    or
    (work_type in ('PRIVACY_RETENTION_CLEANUP', 'SOURCE_HEALTH_ROLLUP')
      and source_id is null and github_sync_request_id is null
      and public_web_work_request_id is null and calendar_sync_request_id is null
      and recruiting_observation_id is null and user_id is null)
  )
);

create unique index work_items_exclusive_active_idx on public.work_items (exclusive_key)
where exclusive_key is not null and status in ('READY', 'LEASED', 'RUNNING', 'RETRY_WAIT');
create index work_items_eligible_idx
  on public.work_items (work_class, priority desc, available_at, created_at, id)
  where status in ('READY', 'RETRY_WAIT');
create index work_items_lease_expiry_idx on public.work_items (lease_expires_at, id)
  where status in ('LEASED', 'RUNNING');
create index work_items_correlation_idx on public.work_items (correlation_id, created_at, id);
create index work_items_github_request_idx on public.work_items (github_sync_request_id)
  where github_sync_request_id is not null;
create index work_items_public_web_request_idx on public.work_items (public_web_work_request_id)
  where public_web_work_request_id is not null;
create index work_items_calendar_request_idx on public.work_items (calendar_sync_request_id)
  where calendar_sync_request_id is not null;

create table public.work_attempts (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  attempt_number smallint not null check (attempt_number > 0),
  status public.work_attempt_status not null default 'LEASED',
  worker_instance text not null check (btrim(worker_instance) <> ''),
  service_principal_id uuid references public.service_principals(id) on delete set null,
  lease_token uuid not null,
  lease_generation integer not null check (lease_generation > 0),
  claimed_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  queue_delay_ms bigint not null default 0 check (queue_delay_ms >= 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  outcome public.work_failure_classification,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  provider text,
  source_id uuid references public.sources(id) on delete set null,
  coverage_status public.coverage_status not null default 'UNKNOWN',
  items_discovered integer check (items_discovered is null or items_discovered >= 0),
  items_processed integer check (items_processed is null or items_processed >= 0),
  items_failed integer check (items_failed is null or items_failed >= 0),
  safe_diagnostics jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_diagnostics) = 'object'
    and not safe_diagnostics ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  unique (work_item_id, attempt_number),
  unique (work_item_id, lease_generation)
);
create index work_attempts_work_idx on public.work_attempts (work_item_id, attempt_number desc);

create table public.dead_letters (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null unique references public.work_items(id) on delete cascade,
  work_type public.work_type not null,
  source_id uuid references public.sources(id) on delete set null,
  provider text,
  attempt_count smallint not null check (attempt_count > 0),
  final_classification public.work_failure_classification not null,
  final_error_code text not null check (final_error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  correlation_id uuid not null,
  safe_diagnostics jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_diagnostics) = 'object'
    and not safe_diagnostics ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  dead_lettered_at timestamptz not null default now()
);

create table public.rate_limit_states (
  scope_type text not null check (scope_type in ('PROVIDER', 'HOST', 'SOURCE', 'ACCOUNT')),
  scope_key_hash text not null check (scope_key_hash ~ '^[0-9a-f]{64}$'),
  next_allowed_at timestamptz,
  reset_at timestamptz,
  remaining integer check (remaining is null or remaining >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope_type, scope_key_hash)
);
create index rate_limit_states_cleanup_idx on public.rate_limit_states (updated_at);

create table public.source_health_samples (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  work_attempt_id uuid not null unique references public.work_attempts(id) on delete cascade,
  succeeded boolean not null,
  latency_ms bigint not null check (latency_ms >= 0),
  rate_limited boolean not null default false,
  coverage_status public.coverage_status not null default 'UNKNOWN',
  items_discovered integer check (items_discovered is null or items_discovered >= 0),
  items_processed integer check (items_processed is null or items_processed >= 0),
  discovery_delay_seconds bigint check (
    discovery_delay_seconds is null or discovery_delay_seconds >= 0
  ),
  sampled_at timestamptz not null default now()
);
create index source_health_samples_source_time_idx
  on public.source_health_samples (source_id, sampled_at desc, id desc);

create table public.source_health_state (
  source_id uuid primary key references public.sources(id) on delete cascade,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  rolling_attempt_count integer not null default 0 check (rolling_attempt_count >= 0),
  rolling_success_rate numeric(5, 4) check (
    rolling_success_rate is null or rolling_success_rate between 0 and 1
  ),
  average_latency_ms bigint check (average_latency_ms is null or average_latency_ms >= 0),
  average_discovery_delay_seconds bigint check (
    average_discovery_delay_seconds is null or average_discovery_delay_seconds >= 0
  ),
  rate_limit_frequency numeric(5, 4) check (
    rate_limit_frequency is null or rate_limit_frequency between 0 and 1
  ),
  coverage_status public.coverage_status not null default 'UNKNOWN',
  updated_at timestamptz not null default now()
);

create table public.source_incidents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  incident_type public.source_incident_type not null,
  status public.source_incident_status not null default 'OPEN',
  rule_version integer not null default 1 check (rule_version > 0),
  opened_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  safe_evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_evidence) = 'object'
    and not safe_evidence ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
    ]
  )
);
create unique index source_incidents_one_open_idx
  on public.source_incidents (source_id, incident_type)
  where status in ('OPEN', 'ACKNOWLEDGED');

create table public.worker_role_bindings (
  database_role name primary key,
  service_principal_id uuid not null unique
    references public.service_principals(id) on delete cascade,
  allowed_work_classes public.work_class[] not null check (cardinality(allowed_work_classes) > 0),
  can_schedule boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.collector_runs add column work_attempt_id uuid unique
  references public.work_attempts(id) on delete set null;
alter table public.github_sync_runs add column work_attempt_id uuid unique
  references public.work_attempts(id) on delete set null;
alter table public.public_web_runs drop constraint public_web_runs_work_request_id_key;
create index public_web_runs_request_idx
  on public.public_web_runs (work_request_id, created_at desc, collector_run_id desc);
alter table public.public_web_runs add column work_attempt_id uuid unique
  references public.work_attempts(id) on delete set null;
alter table public.calendar_sync_runs add column work_attempt_id uuid unique
  references public.work_attempts(id) on delete set null;
alter table public.calendar_sync_requests add column metadata jsonb not null default '{}'::jsonb
  check (jsonb_typeof(metadata) = 'object');

create function public.source_policy_is_executable(target_source_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select source.enabled
      and policy.status in ('ALLOWED', 'ALLOWED_WITH_LIMITS')
      and policy.terms_status = 'REVIEWED'
      and policy.reviewed_at is not null
    from public.sources source
    join public.source_policies policy on policy.id = source.source_policy_id
    where source.id = target_source_id
  ), false)
$$;

create function public.assert_source_policy_executable(target_source_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.source_policy_is_executable(target_source_id) then
    raise exception 'SOURCE_POLICY_NOT_EXECUTABLE' using errcode = 'P0001';
  end if;
end;
$$;

create function public.executable_source_policy_for_hostname(target_hostname text)
returns uuid language sql stable security definer set search_path = public as $$
  with matches as (
    select distinct policy.id
    from public.source_policies policy
    join public.source_policy_host_rules rule on rule.source_policy_id = policy.id
    where policy.status in ('ALLOWED', 'ALLOWED_WITH_LIMITS')
      and policy.terms_status = 'REVIEWED' and policy.reviewed_at is not null
      and (
        lower(target_hostname) = rule.hostname_suffix
        or (rule.allow_subdomains
          and lower(target_hostname) like '%.' || rule.hostname_suffix)
      )
  )
  select case when count(*) = 1 then (array_agg(id))[1] end from matches
$$;

create function public.source_policy_allows_destination(
  target_source_id uuid, target_hostname text, target_scheme text, target_port integer
) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.source_policy_is_executable(source.id) and exists (
      select 1 from public.source_policy_host_rules rule
      where rule.source_policy_id = source.source_policy_id
        and (
          lower(target_hostname) = rule.hostname_suffix
          or (rule.allow_subdomains
            and lower(target_hostname) like '%.' || rule.hostname_suffix)
        )
        and (not rule.https_required or lower(target_scheme) = 'https')
        and target_port = any(rule.allowed_ports)
    )
    from public.sources source where source.id = target_source_id
  ), false)
$$;

-- The earliest UTC instant whose local representation exactly equals the requested
-- wall clock time is selected. Nonexistent spring-forward times skip that local day.
create function public.next_daily_occurrence(
  after_instant timestamptz, local_time time, zone_name text
) returns timestamptz language plpgsql stable as $$
declare
  local_date date := (after_instant at time zone zone_name)::date;
  target_local timestamp;
  baseline timestamptz;
  candidate timestamptz;
  day_offset integer;
  minute_offset integer;
begin
  perform now() at time zone zone_name;
  for day_offset in 0..7 loop
    target_local := (local_date + day_offset) + local_time;
    baseline := target_local at time zone zone_name;
    for minute_offset in -180..180 loop
      candidate := baseline + make_interval(mins => minute_offset);
      if candidate > after_instant and candidate at time zone zone_name = target_local then
        return candidate;
      end if;
    end loop;
  end loop;
  raise exception 'no valid daily occurrence found for timezone %', zone_name;
end;
$$;

insert into public.schedules (
  name, work_type, work_class, source_id, enabled, schedule_kind,
  interval_seconds, anchor_at, next_run_at, jitter_seconds, priority,
  max_attempts, retry_policy
)
select 'ats:' || source.id::text, 'ATS_COLLECT', 'ATS', source.id, false,
  'INTERVAL', 3600, now(), now() + interval '1 hour', 300, 60, 3,
  'EXPONENTIAL_V1'
from public.sources source where source.source_type = 'ATS'
on conflict (name) do nothing;

insert into public.schedules (
  name, work_type, work_class, github_repository_id, enabled, schedule_kind,
  interval_seconds, anchor_at, next_run_at, jitter_seconds, priority,
  max_attempts, retry_policy
)
select 'github:' || repository.id::text, 'GITHUB_SYNC', 'GITHUB', repository.id,
  false, 'INTERVAL', 21600, now(), now() + interval '6 hours', 900, 45, 3,
  'EXPONENTIAL_V1'
from public.github_repositories repository
on conflict (name) do nothing;

insert into public.schedules (
  name, work_type, work_class, public_web_search_query_id, enabled,
  schedule_kind, interval_seconds, anchor_at, next_run_at, jitter_seconds,
  priority, max_attempts, retry_policy
)
select 'public-web-search:' || query.id::text, 'PUBLIC_WEB_SEARCH', 'WEB_SEARCH',
  query.id, false, 'INTERVAL', greatest(query.minimum_interval_seconds, 21600),
  now(), now() + make_interval(secs => greatest(query.minimum_interval_seconds, 21600)),
  1800, 30, 3, 'EXPONENTIAL_V1'
from public.public_web_search_queries query
on conflict (name) do nothing;

insert into public.schedules (
  name, work_type, work_class, enabled, schedule_kind, daily_local_time,
  timezone, next_run_at, priority, max_attempts, retry_policy
) values
  (
    'system:source-health-rollup', 'SOURCE_HEALTH_ROLLUP', 'CONTROL', true,
    'DAILY_AT', '02:30', 'America/Chicago',
    public.next_daily_occurrence(now(), '02:30', 'America/Chicago'), 20, 1, 'NO_RETRY'
  ),
  (
    'system:privacy-retention-cleanup', 'PRIVACY_RETENTION_CLEANUP', 'PRIVACY', true,
    'DAILY_AT', '03:00', 'America/Chicago',
    public.next_daily_occurrence(now(), '03:00', 'America/Chicago'), 15, 3,
    'EXPONENTIAL_V1'
  )
on conflict (name) do nothing;

-- Backfill legacy requests before enabling enqueue triggers. Domain tables remain the
-- authoritative request histories; WorkItem adds execution lifecycle only.
insert into public.work_items (
  work_type, work_class, source_id, github_sync_request_id, priority,
  scheduled_at, available_at, status, attempt_count, max_attempts,
  idempotency_fingerprint, exclusive_key, last_error_classification, last_error_code
)
select
  'GITHUB_SYNC', 'GITHUB', repository.source_id, request.id, 50,
  request.requested_at, request.requested_at,
  case request.status
    when 'PENDING' then 'READY'::public.work_status
    when 'RUNNING' then 'RETRY_WAIT'::public.work_status
    when 'SUCCEEDED' then 'SUCCEEDED'::public.work_status
    when 'CANCELLED' then 'CANCELLED'::public.work_status
    else 'DEAD_LETTERED'::public.work_status
  end,
  case when request.status = 'PENDING' then 0 else 1 end,
  3,
  encode(digest('github-request:' || request.id::text, 'sha256'), 'hex'),
  case when request.status in ('PENDING', 'RUNNING')
    then 'github-repository:' || request.github_repository_id::text end,
  case when request.status = 'FAILED' then 'NON_RETRYABLE'::public.work_failure_classification end,
  case when request.status = 'FAILED' then 'LEGACY_FAILED' end
from public.github_sync_requests request
join public.github_repositories repository on repository.id = request.github_repository_id;

insert into public.work_items (
  work_type, work_class, source_id, public_web_work_request_id, priority,
  scheduled_at, available_at, status, attempt_count, max_attempts,
  idempotency_fingerprint, exclusive_key, last_error_classification, last_error_code
)
select
  case request.work_type
    when 'WEB_SEARCH' then 'PUBLIC_WEB_SEARCH'::public.work_type
    when 'WEB_FETCH' then 'PUBLIC_WEB_FETCH'::public.work_type
    else 'PUBLIC_WEB_PROCESS'::public.work_type
  end,
  case request.work_type
    when 'WEB_SEARCH' then 'WEB_SEARCH'::public.work_class
    when 'WEB_FETCH' then 'WEB_FETCH'::public.work_class
    else 'PROJECTION'::public.work_class
  end,
  coalesce(query.source_id, candidate.source_id), request.id, 50,
  request.requested_at, greatest(request.next_attempt_at, request.requested_at),
  case request.status
    when 'PENDING' then case when request.attempt_count > 0
      then 'RETRY_WAIT'::public.work_status else 'READY'::public.work_status end
    when 'RUNNING' then 'RETRY_WAIT'::public.work_status
    when 'SUCCEEDED' then 'SUCCEEDED'::public.work_status
    when 'CANCELLED' then 'CANCELLED'::public.work_status
    else 'DEAD_LETTERED'::public.work_status
  end,
  request.attempt_count, request.max_attempts,
  encode(digest('public-web-request:' || request.id::text, 'sha256'), 'hex'),
  case when request.status in ('PENDING', 'RUNNING') then
    'public-web:' || request.work_type::text || ':' ||
      coalesce(request.search_query_id, request.candidate_id)::text
  end,
  case when request.status = 'FAILED' then 'NON_RETRYABLE'::public.work_failure_classification end,
  case when request.status = 'FAILED' then 'LEGACY_FAILED' end
from public.public_web_work_requests request
left join public.public_web_search_queries query on query.id = request.search_query_id
left join public.public_web_candidates candidate on candidate.id = request.candidate_id;

insert into public.work_items (
  work_type, work_class, calendar_sync_request_id, user_id, requesting_actor_kind,
  requesting_user_id, priority, scheduled_at, available_at, status, attempt_count,
  max_attempts, idempotency_fingerprint, exclusive_key,
  last_error_classification, last_error_code
)
select
  'CALENDAR_SYNC', 'CALENDAR', request.id, request.user_id, 'USER', request.user_id,
  75, request.requested_at, greatest(request.next_attempt_at, request.requested_at),
  case request.status
    when 'PENDING' then case when request.attempt_count > 0
      then 'RETRY_WAIT'::public.work_status else 'READY'::public.work_status end
    when 'RUNNING' then 'RETRY_WAIT'::public.work_status
    when 'SUCCEEDED' then 'SUCCEEDED'::public.work_status
    when 'CANCELLED' then 'CANCELLED'::public.work_status
    else 'DEAD_LETTERED'::public.work_status
  end,
  request.attempt_count, request.max_attempts,
  encode(digest('calendar-request:' || request.id::text, 'sha256'), 'hex'),
  case when request.status in ('PENDING', 'RUNNING')
    then 'calendar-connection:' || request.calendar_connection_id::text end,
  case when request.status = 'FAILED' then 'NON_RETRYABLE'::public.work_failure_classification end,
  case when request.status = 'FAILED' then coalesce(request.error_code, 'LEGACY_FAILED') end
from public.calendar_sync_requests request;

insert into public.work_attempts (
  work_item_id, attempt_number, status, worker_instance, lease_token,
  lease_generation, claimed_at, started_at, finished_at, queue_delay_ms,
  duration_ms, outcome, error_code, provider, source_id, coverage_status,
  safe_diagnostics
)
select
  work.id, greatest(work.attempt_count, 1),
  case
    when work.status = 'SUCCEEDED' then 'SUCCEEDED'::public.work_attempt_status
    when work.status = 'CANCELLED' then 'CANCELLED'::public.work_attempt_status
    when work.status = 'DEAD_LETTERED' then 'FAILED'::public.work_attempt_status
    else 'ABANDONED'::public.work_attempt_status
  end,
  'legacy-migration', gen_random_uuid(), 1, work.created_at,
  work.first_started_at, now(), 0, 0,
  case
    when work.status = 'DEAD_LETTERED' then 'NON_RETRYABLE'::public.work_failure_classification
    when work.status in ('READY', 'RETRY_WAIT') then 'RETRYABLE'::public.work_failure_classification
  end,
  case
    when work.status = 'DEAD_LETTERED' then 'LEGACY_FAILED'
    when work.status in ('READY', 'RETRY_WAIT') then 'MIGRATION_RECONCILED'
  end,
  coalesce(
    (select source.provider from public.sources source where source.id = work.source_id),
    case when work.work_type = 'CALENDAR_SYNC' then 'google' end
  ), work.source_id, 'UNKNOWN', '{"legacy":true}'::jsonb
from public.work_items work
where work.attempt_count > 0 or work.status in ('SUCCEEDED', 'CANCELLED', 'DEAD_LETTERED');

insert into public.dead_letters (
  work_item_id, work_type, source_id, provider, attempt_count, final_classification,
  final_error_code, correlation_id, safe_diagnostics, dead_lettered_at
)
select id, work_type, source_id, coalesce(
         (select source.provider from public.sources source where source.id = work.source_id),
         case when work.work_type = 'CALENDAR_SYNC' then 'google' end
       ), greatest(attempt_count, 1), 'NON_RETRYABLE',
       coalesce(last_error_code, 'LEGACY_FAILED'), correlation_id,
       '{"legacy":true}'::jsonb, coalesce(completed_at, now())
from public.work_items work where status = 'DEAD_LETTERED';

-- Link the latest legacy domain run to its compatibility attempt without deleting history.
update public.github_sync_runs run set work_attempt_id = attempt.id
from public.work_attempts attempt
join public.work_items work on work.id = attempt.work_item_id
where run.sync_request_id = work.github_sync_request_id and run.work_attempt_id is null;

update public.public_web_runs run set work_attempt_id = attempt.id
from public.work_attempts attempt
join public.work_items work on work.id = attempt.work_item_id
where run.work_request_id = work.public_web_work_request_id and run.work_attempt_id is null;

update public.calendar_sync_runs run set work_attempt_id = attempt.id
from public.work_attempts attempt
join public.work_items work on work.id = attempt.work_item_id
where run.calendar_sync_request_id = work.calendar_sync_request_id
  and run.work_attempt_id is null;

update public.collector_runs collector set work_attempt_id = attempt.id
from public.work_attempts attempt, public.work_items work, public.github_sync_runs github_run
where work.id = attempt.work_item_id
  and github_run.sync_request_id = work.github_sync_request_id
  and collector.id = github_run.collector_run_id and collector.work_attempt_id is null;

update public.collector_runs collector set work_attempt_id = attempt.id
from public.work_attempts attempt, public.work_items work, public.public_web_runs web_run
where work.id = attempt.work_item_id
  and web_run.work_request_id = work.public_web_work_request_id
  and collector.id = web_run.collector_run_id and collector.work_attempt_id is null;

-- A migration is an atomic deployment boundary and is applied with workers stopped.
-- Reconcile stale pre-lease RUNNING rows so their partial unique indexes cannot wedge retries.
update public.collector_runs set status = 'FAILED', finished_at = now(), errors = errors + 1,
  metadata = metadata || '{"recovery_code":"MIGRATION_RECONCILED"}'::jsonb
where status = 'RUNNING';
update public.github_sync_requests set status = 'PENDING', started_at = null,
  finished_at = null, error_message = 'MIGRATION_RECONCILED'
where status = 'RUNNING';
update public.public_web_work_requests set status = 'PENDING', started_at = null,
  finished_at = null, error_message = 'MIGRATION_RECONCILED', next_attempt_at = now()
where status = 'RUNNING';
update public.calendar_sync_requests set status = 'PENDING', started_at = null,
  finished_at = null, error_code = 'MIGRATION_RECONCILED', next_attempt_at = now()
where status = 'RUNNING';
update public.calendar_sync_runs set status = 'FAILED', finished_at = now(),
  errors = errors || '[{"code":"MIGRATION_RECONCILED"}]'::jsonb
where status = 'RUNNING';

create function public.enqueue_domain_request_work()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_source_id uuid;
  mapped_type public.work_type;
  mapped_class public.work_class;
  target_user_id uuid;
  exclusive_value text;
  fingerprint_value text;
  scheduled_value timestamptz;
  available_value timestamptz;
  correlation_value uuid;
begin
  scheduled_value := coalesce((new.metadata ->> 'scheduled_for')::timestamptz, now());
  available_value := coalesce((new.metadata ->> 'available_at')::timestamptz, scheduled_value);
  correlation_value := coalesce((new.metadata ->> 'correlation_id')::uuid, gen_random_uuid());
  fingerprint_value := coalesce(
    nullif(new.metadata ->> 'work_fingerprint', ''),
    encode(digest(tg_table_name || ':' || new.id::text, 'sha256'), 'hex')
  );

  if tg_table_name = 'github_sync_requests' then
    select source_id into target_source_id from public.github_repositories
      where id = new.github_repository_id;
    mapped_type := 'GITHUB_SYNC'; mapped_class := 'GITHUB';
    exclusive_value := 'github-repository:' || new.github_repository_id::text;
  elsif tg_table_name = 'public_web_work_requests' then
    if new.work_type = 'WEB_SEARCH' then
      select source_id into target_source_id from public.public_web_search_queries
        where id = new.search_query_id;
      mapped_type := 'PUBLIC_WEB_SEARCH'; mapped_class := 'WEB_SEARCH';
      exclusive_value := 'public-web:WEB_SEARCH:' || new.search_query_id::text;
    else
      select source_id into target_source_id from public.public_web_candidates
        where id = new.candidate_id;
      mapped_type := case when new.work_type = 'WEB_FETCH'
        then 'PUBLIC_WEB_FETCH'::public.work_type
        else 'PUBLIC_WEB_PROCESS'::public.work_type end;
      mapped_class := case when new.work_type = 'WEB_FETCH'
        then 'WEB_FETCH'::public.work_class else 'PROJECTION'::public.work_class end;
      exclusive_value := 'public-web:' || new.work_type::text || ':' || new.candidate_id::text;
    end if;
  elsif tg_table_name = 'calendar_sync_requests' then
    mapped_type := 'CALENDAR_SYNC'; mapped_class := 'CALENDAR';
    target_user_id := new.user_id;
    exclusive_value := 'calendar-connection:' || new.calendar_connection_id::text;
  end if;

  if target_source_id is not null then
    perform public.assert_source_policy_executable(target_source_id);
  end if;

  insert into public.work_items (
    work_type, work_class, schedule_id, source_id, github_sync_request_id,
    public_web_work_request_id, calendar_sync_request_id, user_id,
    requesting_actor_kind, requesting_user_id, priority, scheduled_at,
    available_at, max_attempts, idempotency_fingerprint, exclusive_key, correlation_id
  ) values (
    mapped_type, mapped_class, (new.metadata ->> 'schedule_id')::uuid,
    target_source_id,
    case when tg_table_name = 'github_sync_requests' then new.id end,
    case when tg_table_name = 'public_web_work_requests' then new.id end,
    case when tg_table_name = 'calendar_sync_requests' then new.id end,
    target_user_id,
    case when target_user_id is null then 'SYSTEM'::public.actor_kind else 'USER' end,
    target_user_id,
    coalesce((new.metadata ->> 'priority')::smallint,
      case when mapped_class = 'CALENDAR' then 75 else 50 end),
    scheduled_value, available_value, coalesce(new.max_attempts, 3),
    fingerprint_value, exclusive_value, correlation_value
  );
  return new;
end;
$$;

-- GitHub's legacy request did not have attempt limits; expose a stable value to the trigger.
alter table public.github_sync_requests add column max_attempts integer not null default 3
  check (max_attempts between 1 and 10);

create trigger github_sync_requests_enqueue_work
after insert on public.github_sync_requests
for each row execute function public.enqueue_domain_request_work();
create trigger public_web_work_requests_enqueue_work
after insert on public.public_web_work_requests
for each row execute function public.enqueue_domain_request_work();
create trigger calendar_sync_requests_enqueue_work
after insert on public.calendar_sync_requests
for each row execute function public.enqueue_domain_request_work();

create function public.enqueue_recruiter_projection(
  target_observation_id uuid, parent_id uuid, correlation uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  inserted_id uuid;
begin
  insert into public.work_items (
    work_type, work_class, recruiting_observation_id, requesting_actor_kind,
    priority, scheduled_at, available_at, idempotency_fingerprint, exclusive_key,
    correlation_id, parent_work_item_id
  ) values (
    'RECRUITER_CAMPUS_PROJECT', 'PROJECTION', target_observation_id, 'SYSTEM',
    45, now(), now(),
    encode(digest('recruiter-projection:' || target_observation_id::text, 'sha256'), 'hex'),
    'recruiter-projection:' || target_observation_id::text,
    correlation, parent_id
  ) on conflict (idempotency_fingerprint) do nothing
  returning id into inserted_id;
  return inserted_id;
end;
$$;

create function public.claim_work_items(
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
  if not found then
    raise exception 'WORKER_SERVICE_PRINCIPAL_INACTIVE' using errcode = '42501';
  end if;
  if not classes <@ binding.allowed_work_classes then
    raise exception 'WORK_CLASS_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'CALENDAR' = any(classes)
      and not 'WORKER_CALENDAR_SYNC' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if 'PRIVACY' = any(classes) and not 'WORKER_PRIVACY' = any(principal.scopes) then
    raise exception 'WORKER_SCOPE_NOT_GRANTED' using errcode = '42501';
  end if;
  if classes && array[
      'ATS', 'GITHUB', 'WEB_SEARCH', 'WEB_FETCH', 'PROJECTION'
    ]::public.work_class[] and not 'WORKER_GLOBAL' = any(principal.scopes) then
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
    perform public.project_domain_request_status(
      blocked, 'POLICY_BLOCKED', 'SOURCE_POLICY_BLOCKED'
    );
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
    from candidates where work.id = candidates.id
    returning work.*
  ), attempts as (
    insert into public.work_attempts (
      work_item_id, attempt_number, worker_instance, service_principal_id,
      lease_token, lease_generation, queue_delay_ms, provider, source_id
    )
    select id, attempt_count, worker, lease_service_principal_id, lease_token,
      lease_generation,
      greatest(0, floor(extract(epoch from (now() - available_at)) * 1000))::bigint,
      coalesce(
        (select source.provider from public.sources source where source.id = claimed.source_id),
        case when claimed.work_type = 'CALENDAR_SYNC' then 'google' end
      ), source_id
    from claimed returning work_item_id
  )
  select claimed.* from claimed join attempts on attempts.work_item_id = claimed.id;
end;
$$;

create function public.start_work_attempt(target_id uuid, token uuid)
returns public.work_items language plpgsql security definer set search_path = public as $$
declare result public.work_items;
begin
  update public.work_items set status = 'RUNNING', heartbeat_at = now()
  where id = target_id and status = 'LEASED' and lease_token = token
    and lease_expires_at > now() and lease_service_principal_id = (
      select binding.service_principal_id from public.worker_role_bindings binding
      join public.service_principals principal on principal.id = binding.service_principal_id
      where binding.database_role = session_user and principal.kind = 'WORKER'
        and principal.status = 'ACTIVE'
        and (principal.expires_at is null or principal.expires_at > now())
    ) returning * into result;
  if result.id is null then raise exception 'STALE_OR_INVALID_LEASE' using errcode = 'P0001'; end if;
  update public.work_attempts set status = 'RUNNING', started_at = now(), heartbeat_at = now()
  where work_item_id = target_id and lease_token = token;
  return result;
end;
$$;

create function public.heartbeat_work_attempt(
  target_id uuid, token uuid, lease_duration_seconds integer
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare expires timestamptz;
begin
  update public.work_items set heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => lease_duration_seconds)
  where id = target_id and status = 'RUNNING' and lease_token = token
    and lease_expires_at > now() and lease_service_principal_id = (
      select binding.service_principal_id from public.worker_role_bindings binding
      join public.service_principals principal on principal.id = binding.service_principal_id
      where binding.database_role = session_user and principal.kind = 'WORKER'
        and principal.status = 'ACTIVE'
        and (principal.expires_at is null or principal.expires_at > now())
    ) returning lease_expires_at into expires;
  if expires is null then raise exception 'STALE_OR_INVALID_LEASE' using errcode = 'P0001'; end if;
  update public.work_attempts set heartbeat_at = now()
  where work_item_id = target_id and lease_token = token and status = 'RUNNING';
  return expires;
end;
$$;

create function public.project_domain_request_status(
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
      next_attempt_at = work.available_at,
      error_message = safe_code
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
      next_attempt_at = work.available_at,
      error_code = safe_code
    where id = work.calendar_sync_request_id;
  end if;
end;
$$;

create function public.finish_work_attempt(
  target_id uuid, token uuid, succeeded boolean,
  classification public.work_failure_classification, safe_error_code text,
  diagnostics jsonb, coverage public.coverage_status,
  discovered integer, processed integer, failed integer,
  retry_after_seconds integer default null
) returns public.work_status language plpgsql security definer set search_path = public as $$
declare
  work public.work_items;
  next_status public.work_status;
  delay_seconds integer;
begin
  select * into work from public.work_items
  where id = target_id and status in ('LEASED', 'RUNNING') and lease_token = token
    and lease_service_principal_id = (
      select binding.service_principal_id from public.worker_role_bindings binding
      join public.service_principals principal on principal.id = binding.service_principal_id
      where binding.database_role = session_user and principal.kind = 'WORKER'
        and principal.status = 'ACTIVE'
        and (principal.expires_at is null or principal.expires_at > now())
    ) for update;
  if work.id is null then raise exception 'STALE_OR_INVALID_LEASE' using errcode = 'P0001'; end if;
  if diagnostics ?| array[
    'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
    'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload'
  ] then raise exception 'unsafe diagnostic key'; end if;
  if not succeeded and classification is null then
    raise exception 'failure classification is required';
  end if;

  if work.cancel_requested_at is not null then
    next_status := 'CANCELLED';
  elsif succeeded then
    next_status := 'SUCCEEDED';
  elsif classification = 'AUTH_REQUIRED' then next_status := 'AUTH_REQUIRED';
  elsif classification = 'POLICY_BLOCKED' then next_status := 'POLICY_BLOCKED';
  elsif classification = 'NON_RETRYABLE' or work.retry_policy = 'NO_RETRY'
      or work.attempt_count >= work.max_attempts then
    next_status := 'DEAD_LETTERED';
  else
    next_status := 'RETRY_WAIT';
  end if;

  if next_status = 'RETRY_WAIT' then
    delay_seconds := greatest(
      coalesce(retry_after_seconds, 0),
      least(30 * (2 ^ greatest(work.attempt_count - 1, 0))::integer, 3600)
        + mod(get_byte(digest(work.id::text || ':' || work.attempt_count::text, 'sha256'), 0), 31)
    );
  else delay_seconds := 0;
  end if;

  update public.work_attempts set
    status = case when next_status = 'CANCELLED' then 'CANCELLED'::public.work_attempt_status
      when succeeded then 'SUCCEEDED'::public.work_attempt_status
      else 'FAILED'::public.work_attempt_status end,
    finished_at = now(),
    duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, claimed_at))) * 1000))::bigint,
    outcome = case when succeeded or next_status = 'CANCELLED' then null else classification end,
    error_code = case when succeeded or next_status = 'CANCELLED' then null else safe_error_code end,
    coverage_status = coverage, items_discovered = discovered,
    items_processed = processed, items_failed = failed,
    safe_diagnostics = diagnostics
  where work_item_id = target_id and lease_token = token;

  update public.work_items set status = next_status,
    available_at = case when next_status = 'RETRY_WAIT'
      then now() + make_interval(secs => delay_seconds) else available_at end,
    completed_at = case when next_status = 'RETRY_WAIT' then null else now() end,
    lease_owner = null, lease_service_principal_id = null, lease_token = null,
    lease_expires_at = null, heartbeat_at = null,
    last_error_classification = case when succeeded or next_status = 'CANCELLED'
      then null else classification end,
    last_error_code = case when succeeded or next_status = 'CANCELLED'
      then null else safe_error_code end,
    safe_diagnostics = diagnostics
  where id = target_id returning * into work;

  perform public.project_domain_request_status(work, next_status, safe_error_code);

  if next_status = 'DEAD_LETTERED' then
    insert into public.dead_letters (
      work_item_id, work_type, source_id, provider, attempt_count, final_classification,
      final_error_code, correlation_id, safe_diagnostics
    ) values (
      work.id, work.work_type, work.source_id, coalesce(
        (select source.provider from public.sources source where source.id = work.source_id),
        case when work.work_type = 'CALENDAR_SYNC' then 'google' end
      ), work.attempt_count, classification,
      safe_error_code, work.correlation_id, diagnostics
    ) on conflict (work_item_id) do nothing;
  end if;

  if work.source_id is not null and next_status <> 'CANCELLED' then
    insert into public.source_health_samples (
      source_id, work_attempt_id, succeeded, latency_ms, rate_limited,
      coverage_status, items_discovered, items_processed, discovery_delay_seconds
    )
    select work.source_id, attempt.id, succeeded, coalesce(attempt.duration_ms, 0),
      coalesce(classification = 'RATE_LIMITED', false), coverage, discovered, processed,
      (
        select avg(greatest(0, extract(epoch from (event.discovered_at - event.occurred_at))))::bigint
        from public.recruiting_events event
        where event.source_id = work.source_id
          and event.created_at >= attempt.claimed_at and event.created_at <= now()
      )
    from public.work_attempts attempt
    where attempt.work_item_id = target_id and attempt.lease_token = token
    on conflict (work_attempt_id) do nothing;
  end if;
  return next_status;
end;
$$;

create function public.reap_expired_work_items(reap_limit integer default 100)
returns integer language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  work public.work_items;
  reaped integer := 0;
  next_state public.work_status;
begin
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found then raise exception 'WORKER_ROLE_NOT_BOUND' using errcode = '42501'; end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id and kind = 'WORKER' and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
    and ('WORKER_SCHEDULER' = any(scopes) or 'WORKER_GLOBAL' = any(scopes));
  if not found then
    raise exception 'WORKER_SERVICE_PRINCIPAL_INACTIVE' using errcode = '42501';
  end if;
  for work in
    select * from public.work_items
    where status in ('LEASED', 'RUNNING') and lease_expires_at <= now()
    order by lease_expires_at, id for update skip locked limit reap_limit
  loop
    next_state := case when work.attempt_count < work.max_attempts
      then 'RETRY_WAIT'::public.work_status else 'DEAD_LETTERED'::public.work_status end;
    update public.work_attempts set status = 'ABANDONED', finished_at = now(),
      duration_ms = greatest(0, floor(extract(epoch from (now() - coalesce(started_at, claimed_at))) * 1000))::bigint,
      outcome = 'RETRYABLE', error_code = 'LEASE_EXPIRED',
      safe_diagnostics = '{"reason":"worker_heartbeat_expired"}'::jsonb
    where work_item_id = work.id and lease_token = work.lease_token
      and status in ('LEASED', 'RUNNING');
    if work.source_id is not null then
      insert into public.source_health_samples (
        source_id, work_attempt_id, succeeded, latency_ms, rate_limited,
        coverage_status
      )
      select work.source_id, attempt.id, false, coalesce(attempt.duration_ms, 0),
        false, 'UNKNOWN'
      from public.work_attempts attempt
      where attempt.work_item_id = work.id and attempt.lease_token = work.lease_token
      on conflict (work_attempt_id) do nothing;
    end if;
    update public.collector_runs set status = 'FAILED', finished_at = now(), errors = errors + 1,
      metadata = metadata || '{"recovery_code":"LEASE_EXPIRED"}'::jsonb
    where work_attempt_id in (
      select id from public.work_attempts where work_item_id = work.id
        and lease_token = work.lease_token
    ) and status = 'RUNNING';
    update public.calendar_sync_runs set status = 'FAILED', finished_at = now(),
      errors = errors || '[{"code":"LEASE_EXPIRED"}]'::jsonb
    where work_attempt_id in (
      select id from public.work_attempts where work_item_id = work.id
        and lease_token = work.lease_token
    ) and status = 'RUNNING';
    update public.work_items set status = next_state,
      available_at = case when next_state = 'RETRY_WAIT' then now() else available_at end,
      completed_at = case when next_state = 'DEAD_LETTERED' then now() else null end,
      lease_owner = null, lease_service_principal_id = null, lease_token = null,
      lease_expires_at = null, heartbeat_at = null,
      last_error_classification = 'RETRYABLE', last_error_code = 'LEASE_EXPIRED',
      safe_diagnostics = '{"reason":"worker_heartbeat_expired"}'::jsonb
    where id = work.id returning * into work;
    perform public.project_domain_request_status(work, next_state, 'LEASE_EXPIRED');
    if next_state = 'DEAD_LETTERED' then
      insert into public.dead_letters (
        work_item_id, work_type, source_id, provider, attempt_count, final_classification,
        final_error_code, correlation_id, safe_diagnostics
      ) values (
        work.id, work.work_type, work.source_id, coalesce(
          (select source.provider from public.sources source where source.id = work.source_id),
          case when work.work_type = 'CALENDAR_SYNC' then 'google' end
        ), work.attempt_count, 'RETRYABLE',
        'LEASE_EXPIRED', work.correlation_id,
        '{"reason":"worker_heartbeat_expired"}'::jsonb
      ) on conflict (work_item_id) do nothing;
    end if;
    reaped := reaped + 1;
  end loop;
  return reaped;
end;
$$;

create function public.enqueue_due_schedules(schedule_limit integer default 100)
returns integer language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  schedule public.schedules;
  logical_due timestamptz;
  available_time timestamptz;
  fingerprint text;
  correlation uuid;
  inserted_count integer := 0;
begin
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found or not binding.can_schedule then
    raise exception 'SCHEDULER_ROLE_NOT_BOUND' using errcode = '42501';
  end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id and kind = 'WORKER' and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
    and 'WORKER_SCHEDULER' = any(scopes);
  if not found then
    raise exception 'SCHEDULER_SERVICE_PRINCIPAL_INACTIVE' using errcode = '42501';
  end if;
  for schedule in
    select * from public.schedules where enabled and next_run_at <= now()
    order by next_run_at, priority desc, id for update skip locked limit schedule_limit
  loop
    logical_due := schedule.next_run_at;
    if schedule.source_id is not null
       and not public.source_policy_is_executable(schedule.source_id) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    if schedule.github_repository_id is not null and not exists (
      select 1 from public.github_repositories repository
      join public.sources source on source.id = repository.source_id
      where repository.id = schedule.github_repository_id
        and public.source_policy_is_executable(source.id)
    ) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    if schedule.public_web_search_query_id is not null and not exists (
      select 1 from public.public_web_search_queries query
      where query.id = schedule.public_web_search_query_id
        and public.source_policy_is_executable(query.source_id)
    ) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    available_time := logical_due + make_interval(secs => case when schedule.jitter_seconds = 0
      then 0 else mod(get_byte(digest(schedule.id::text || ':' || logical_due::text, 'sha256'), 0),
                        schedule.jitter_seconds + 1) end);
    fingerprint := encode(digest(
      'schedule:' || schedule.id::text || ':' || logical_due::text, 'sha256'
    ), 'hex');
    correlation := gen_random_uuid();

    if schedule.work_type = 'ATS_COLLECT' then
      insert into public.work_items (
        work_type, work_class, schedule_id, source_id, priority, scheduled_at,
        available_at, max_attempts, retry_policy, idempotency_fingerprint,
        exclusive_key, correlation_id
      ) values (
        schedule.work_type, schedule.work_class, schedule.id, schedule.source_id,
        schedule.priority, logical_due, available_time, schedule.max_attempts,
        schedule.retry_policy, fingerprint, 'ats-source:' || schedule.source_id::text,
        correlation
      ) on conflict do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    elsif schedule.work_type = 'GITHUB_SYNC' then
      insert into public.github_sync_requests (
        github_repository_id, requested_by, max_attempts, metadata
      ) values (
        schedule.github_repository_id, 'scheduler', schedule.max_attempts,
        jsonb_build_object(
          'schedule_id', schedule.id, 'scheduled_for', logical_due,
          'available_at', available_time, 'work_fingerprint', fingerprint,
          'priority', schedule.priority, 'correlation_id', correlation
        )
      ) on conflict (github_repository_id)
        where status in ('PENDING', 'RUNNING') do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    elsif schedule.work_type = 'PUBLIC_WEB_SEARCH' then
      insert into public.public_web_work_requests (
        work_type, company_id, search_query_id, requested_by, max_attempts, metadata
      ) select 'WEB_SEARCH', query.company_id, query.id, 'scheduler', schedule.max_attempts,
        jsonb_build_object(
          'schedule_id', schedule.id, 'scheduled_for', logical_due,
          'available_at', greatest(available_time, coalesce(query.next_allowed_run_at, available_time)),
          'work_fingerprint', fingerprint, 'priority', schedule.priority,
          'correlation_id', correlation
        )
      from public.public_web_search_queries query
      where query.id = schedule.public_web_search_query_id
        and coalesce(query.next_allowed_run_at, available_time) <= now()
      on conflict (work_type, search_query_id)
        where status in ('PENDING', 'RUNNING') and work_type = 'WEB_SEARCH' do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    else
      insert into public.work_items (
        work_type, work_class, schedule_id, priority, scheduled_at, available_at,
        max_attempts, retry_policy, idempotency_fingerprint, correlation_id
      ) values (
        schedule.work_type, schedule.work_class, schedule.id, schedule.priority,
        logical_due, available_time, schedule.max_attempts, schedule.retry_policy,
        fingerprint, correlation
      ) on conflict (idempotency_fingerprint) do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    end if;

    update public.schedules set last_enqueued_for = logical_due,
      next_run_at = case when schedule.schedule_kind = 'INTERVAL'
        then logical_due + make_interval(secs => schedule.interval_seconds * (
          floor(greatest(0, extract(epoch from (now() - logical_due)))
            / schedule.interval_seconds)::integer + 1
        ))
        else public.next_daily_occurrence(
          greatest(logical_due, now()), schedule.daily_local_time, schedule.timezone
        ) end,
      updated_at = now()
    where id = schedule.id;
  end loop;
  return inserted_count;
end;
$$;

create function public.requeue_dead_letter(target_work_item_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  original public.work_items;
  new_id uuid := gen_random_uuid();
begin
  select * into original from public.work_items where id = target_work_item_id for update;
  if original.status <> 'DEAD_LETTERED' then raise exception 'WORK_NOT_DEAD_LETTERED'; end if;
  if original.user_id is not null then
    raise exception 'OWNER_SCOPED_WORK_CANNOT_BE_ADMIN_REQUEUED' using errcode = '42501';
  end if;
  if original.source_id is not null then
    perform public.assert_source_policy_executable(original.source_id);
  end if;
  insert into public.work_items (
    id, work_type, work_class, handler_version, source_id, github_sync_request_id,
    public_web_work_request_id, calendar_sync_request_id, recruiting_observation_id,
    priority, scheduled_at, available_at, max_attempts, retry_policy,
    retry_policy_version, idempotency_fingerprint, exclusive_key, correlation_id,
    causation_id, parent_work_item_id, requeued_from_id, requesting_actor_kind
  ) values (
    new_id, original.work_type, original.work_class, original.handler_version,
    original.source_id, original.github_sync_request_id,
    original.public_web_work_request_id, original.calendar_sync_request_id,
    original.recruiting_observation_id, original.priority, now(), now(),
    original.max_attempts, original.retry_policy, original.retry_policy_version,
    encode(digest('requeue:' || original.id::text || ':' || new_id::text, 'sha256'), 'hex'),
    original.exclusive_key, original.correlation_id, original.id,
    original.parent_work_item_id, original.id, 'SYSTEM'
  );
  if original.public_web_work_request_id is not null then
    update public.public_web_work_requests set status = 'PENDING', attempt_count = 0,
      started_at = null, finished_at = null, next_attempt_at = now(), error_message = null
    where id = original.public_web_work_request_id;
  elsif original.github_sync_request_id is not null then
    update public.github_sync_requests set status = 'PENDING', started_at = null,
      finished_at = null, error_message = null
    where id = original.github_sync_request_id;
  end if;
  return new_id;
end;
$$;

create function public.rollup_source_health(sample_window integer default 20)
returns integer language plpgsql security definer set search_path = public as $$
declare updated_rows integer;
begin
  with recent as (
    select sample.*, row_number() over (
      partition by source_id order by sampled_at desc, id desc
    ) as position
    from public.source_health_samples sample
  ), aggregate as (
    select source_id,
      max(sampled_at) filter (where succeeded) as last_success,
      max(sampled_at) filter (where not succeeded) as last_failure,
      count(*)::integer attempts,
      avg(case when succeeded then 1.0 else 0.0 end)::numeric(5,4) success_rate,
      avg(latency_ms)::bigint average_latency,
      avg(case when rate_limited then 1.0 else 0.0 end)::numeric(5,4) rate_frequency,
      avg(discovery_delay_seconds)::bigint average_discovery_delay,
      (array_agg(coverage_status order by sampled_at desc, id desc))[1] coverage
    from recent where position <= sample_window group by source_id
  ), failures as (
    select source_id, count(*)::integer consecutive
    from recent current
    where position < coalesce((
      select min(position) from recent success
      where success.source_id = current.source_id and success.succeeded
    ), sample_window + 1) and not succeeded
    group by source_id
  )
  insert into public.source_health_state (
    source_id, last_success_at, last_failure_at, consecutive_failures,
    rolling_attempt_count, rolling_success_rate, average_latency_ms,
    average_discovery_delay_seconds, rate_limit_frequency, coverage_status
  )
  select aggregate.source_id, aggregate.last_success, aggregate.last_failure,
    coalesce(failures.consecutive, 0), aggregate.attempts, aggregate.success_rate,
    aggregate.average_latency, aggregate.average_discovery_delay,
    aggregate.rate_frequency, aggregate.coverage
  from aggregate left join failures using (source_id)
  on conflict (source_id) do update set
    last_success_at = excluded.last_success_at,
    last_failure_at = excluded.last_failure_at,
    consecutive_failures = excluded.consecutive_failures,
    rolling_attempt_count = excluded.rolling_attempt_count,
    rolling_success_rate = excluded.rolling_success_rate,
    average_latency_ms = excluded.average_latency_ms,
    average_discovery_delay_seconds = excluded.average_discovery_delay_seconds,
    rate_limit_frequency = excluded.rate_limit_frequency,
    coverage_status = excluded.coverage_status,
    updated_at = now();
  get diagnostics updated_rows = row_count;

  insert into public.source_incidents (source_id, incident_type, rule_version, safe_evidence)
  select source_id, 'CONSECUTIVE_FAILURES', 1,
    jsonb_build_object('consecutive_failures', consecutive_failures)
  from public.source_health_state where consecutive_failures >= 3
  on conflict (source_id, incident_type)
    where status in ('OPEN', 'ACKNOWLEDGED') do nothing;
  insert into public.source_incidents (source_id, incident_type, rule_version, safe_evidence)
  select source_id, 'COVERAGE_PARTIAL', 1,
    jsonb_build_object('coverage_status', coverage_status)
  from public.source_health_state where coverage_status in ('PARTIAL', 'STALE')
  on conflict (source_id, incident_type)
    where status in ('OPEN', 'ACKNOWLEDGED') do nothing;
  insert into public.source_incidents (source_id, incident_type, rule_version, safe_evidence)
  select source_id, 'RATE_LIMIT_PRESSURE', 1,
    jsonb_build_object(
      'rolling_attempt_count', rolling_attempt_count,
      'rate_limit_frequency', rate_limit_frequency
    )
  from public.source_health_state
  where rolling_attempt_count >= 5 and rate_limit_frequency >= 0.3000
  on conflict (source_id, incident_type)
    where status in ('OPEN', 'ACKNOWLEDGED') do nothing;
  insert into public.source_incidents (source_id, incident_type, rule_version, safe_evidence)
  select source_id, 'STALE', 1,
    jsonb_build_object('last_success_at', last_success_at)
  from public.source_health_state
  where last_success_at is not null and last_success_at < now() - interval '2 days'
  on conflict (source_id, incident_type)
    where status in ('OPEN', 'ACKNOWLEDGED') do nothing;
  with successful_counts as (
    select source_id, items_discovered, sampled_at,
      row_number() over (partition by source_id order by sampled_at desc, id desc) as position
    from public.source_health_samples
    where succeeded and items_discovered is not null
  ), baselines as (
    select source_id, avg(items_discovered)::numeric as mean_count,
      stddev_pop(items_discovered)::numeric as deviation, count(*)::integer as sample_count
    from successful_counts where position between 2 and 11 group by source_id
  ), anomalies as (
    select latest.source_id, latest.items_discovered, baseline.mean_count,
      baseline.deviation, baseline.sample_count
    from successful_counts latest join baselines baseline using (source_id)
    where latest.position = 1 and baseline.sample_count >= 5 and baseline.mean_count > 0
      and abs(latest.items_discovered - baseline.mean_count) > greatest(
        baseline.mean_count * 0.5, coalesce(baseline.deviation, 0) * 3, 5
      )
  )
  insert into public.source_incidents (source_id, incident_type, rule_version, safe_evidence)
  select source_id, 'COUNT_ANOMALY', 1,
    jsonb_build_object(
      'latest_count', items_discovered, 'baseline_mean', round(mean_count, 2),
      'baseline_samples', sample_count
    )
  from anomalies
  on conflict (source_id, incident_type)
    where status in ('OPEN', 'ACKNOWLEDGED') do nothing;
  return updated_rows;
end;
$$;

create trigger source_policies_set_updated_at before update on public.source_policies
for each row execute function public.set_updated_at();
create trigger schedules_set_updated_at before update on public.schedules
for each row execute function public.set_updated_at();
create trigger work_items_set_updated_at before update on public.work_items
for each row execute function public.set_updated_at();

-- Narrow operational roles are NOLOGIN capabilities. Deployment creates login roles and
-- grants only the matching capability; no password or credential is stored in migration SQL.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_scheduler') then
    create role recruitintel_scheduler nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_worker_global') then
    create role recruitintel_worker_global nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_worker_calendar') then
    create role recruitintel_worker_calendar nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_worker_privacy') then
    create role recruitintel_worker_privacy nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'recruitintel_web_app') then
    create role recruitintel_web_app nologin;
  end if;
end $$;

revoke all on function public.claim_work_items(text, public.work_class[], integer, integer)
  from public;
revoke all on function public.start_work_attempt(uuid, uuid) from public;
revoke all on function public.heartbeat_work_attempt(uuid, uuid, integer) from public;
revoke all on function public.finish_work_attempt(
  uuid, uuid, boolean, public.work_failure_classification, text, jsonb,
  public.coverage_status, integer, integer, integer, integer
) from public;
revoke all on function public.reap_expired_work_items(integer) from public;
revoke all on function public.enqueue_due_schedules(integer) from public;
revoke all on function public.requeue_dead_letter(uuid) from public;

grant execute on function public.claim_work_items(text, public.work_class[], integer, integer)
  to recruitintel_worker_global, recruitintel_worker_calendar, recruitintel_worker_privacy;
grant execute on function public.start_work_attempt(uuid, uuid)
  to recruitintel_worker_global, recruitintel_worker_calendar, recruitintel_worker_privacy;
grant execute on function public.heartbeat_work_attempt(uuid, uuid, integer)
  to recruitintel_worker_global, recruitintel_worker_calendar;
grant execute on function public.finish_work_attempt(
  uuid, uuid, boolean, public.work_failure_classification, text, jsonb,
  public.coverage_status, integer, integer, integer, integer
) to recruitintel_worker_global, recruitintel_worker_calendar, recruitintel_worker_privacy;
grant execute on function public.reap_expired_work_items(integer)
  to recruitintel_scheduler, recruitintel_worker_global;
grant execute on function public.enqueue_due_schedules(integer) to recruitintel_scheduler;
grant execute on function public.requeue_dead_letter(uuid) to recruitintel_web_app;

grant usage on schema public to recruitintel_scheduler, recruitintel_worker_global,
  recruitintel_worker_calendar, recruitintel_worker_privacy, recruitintel_web_app;

grant select, insert, update on table
  public.sources, public.companies, public.company_aliases, public.company_domains,
  public.collector_runs, public.collector_errors, public.jobs, public.job_snapshots,
  public.observations, public.recruiting_events,
  public.github_repositories, public.github_repository_company_links,
  public.github_sync_requests, public.github_sync_runs,
  public.interview_questions, public.company_interview_questions,
  public.interview_question_observations, public.unresolved_github_observations,
  public.schools, public.school_aliases,
  public.public_web_search_queries, public.public_web_candidates,
  public.public_web_candidate_discoveries, public.public_web_documents,
  public.public_recruiting_observations, public.public_recruiting_claims,
  public.public_recruiting_claim_observations, public.public_web_work_requests,
  public.public_web_runs, public.people, public.recruiter_profiles,
  public.recruiter_evidence, public.recruiter_school_relationships,
  public.recruiter_school_evidence, public.recruiter_role_focus,
  public.recruiter_role_evidence, public.campus_recruiting_events,
  public.campus_recruiting_event_evidence, public.campus_event_recruiters,
  public.unresolved_recruiter_observations
to recruitintel_worker_global;

grant select on table
  public.calendar_connections, public.calendar_items, public.calendar_external_events,
  public.calendar_sync_requests, public.calendar_sync_runs, public.recruiting_dates,
  public.application_plans, public.companies, public.jobs
to recruitintel_worker_calendar;
grant insert, update on table
  public.calendar_external_events, public.calendar_sync_requests,
  public.calendar_sync_runs, public.calendar_connections
to recruitintel_worker_calendar;

grant select, insert, update on table public.rate_limit_states
to recruitintel_worker_global, recruitintel_worker_calendar;

grant select, delete on table
  public.user_sessions, public.auth_verifications, public.calendar_oauth_states,
  public.extension_grants, public.rate_limit_states
to recruitintel_worker_privacy;

-- The web application is the trusted server boundary. Browser users never receive this role;
-- owner/admin authorization remains in the route and repository layer from Milestone 6.
grant select, insert, update, delete on all tables in schema public to recruitintel_web_app;

comment on table public.work_items is
  'Small PostgreSQL orchestration control plane. Domain state remains in subsystem tables.';
comment on table public.source_policies is
  'Reviewed collection policy. Migration-created policies remain REVIEW_REQUIRED.';
comment on table public.dead_letters is
  'Safe terminal diagnostics only; private payloads and secrets are forbidden.';
