create type public.actor_kind as enum ('USER', 'ADMIN', 'SERVICE', 'SYSTEM');
create type public.user_status as enum (
  'PENDING_IDENTITY', 'ACTIVE', 'DISABLED', 'DELETION_PENDING'
);
create type public.service_principal_kind as enum ('ADMIN_API', 'WORKER');
create type public.service_principal_status as enum ('ACTIVE', 'REVOKED');
create type public.service_scope as enum (
  'ADMIN_MUTATE', 'WORKER_INGEST', 'WORKER_CALENDAR_SYNC'
);
create type public.extension_grant_scope as enum ('PAGE_SCAN', 'JOB_IMPORT');
create type public.audit_outcome as enum ('SUCCEEDED', 'DENIED', 'FAILED');
create type public.product_event_source as enum ('SERVER', 'CLIENT');
create type public.product_event_type as enum (
  'CALENDAR_PLAN_CREATED', 'CALENDAR_PLAN_ACTIVATED', 'CALENDAR_ITEM_COMPLETED',
  'JOB_VIEWED', 'RECRUITER_VIEWED', 'INTERVIEW_INTEL_VIEWED',
  'RECOMMENDATION_IMPRESSION', 'JOB_SAVED', 'JOB_DISMISSED',
  'APPLICATION_STARTED', 'APPLICATION_SUBMITTED', 'ALERT_SHOWN', 'ALERT_OPENED',
  'RESUME_MATCH_VIEWED', 'RESUME_RECOMMENDATION_ACCEPTED',
  'BROWSER_SCAN_STARTED', 'BROWSER_JOB_IMPORTED'
);
create type public.privacy_request_type as enum ('EXPORT', 'DELETE');
create type public.privacy_request_status as enum (
  'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'
);
create type public.watchlist_item_type as enum ('COMPANY', 'JOB');

-- Better Auth 1.7.1 schema, generated and reviewed from the pinned runtime package.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  email text not null unique check (btrim(email) <> ''),
  email_verified boolean not null default false,
  image text,
  status public.user_status not null default 'ACTIVE',
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null,
  token text not null unique check (btrim(token) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id uuid not null references public.users(id) on delete cascade
);
create index user_sessions_user_id_idx on public.user_sessions (user_id);
create index user_sessions_expiry_idx on public.user_sessions (expires_at);

create table public.user_identities (
  id uuid primary key default gen_random_uuid(),
  issuer text not null check (btrim(issuer) <> ''),
  account_id text not null check (btrim(account_id) <> ''),
  provider_id text not null check (btrim(provider_id) <> ''),
  user_id uuid not null references public.users(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_identities_issuer_account_id_uidx unique (issuer, account_id),
  constraint user_identities_no_persisted_credentials check (
    access_token is null and refresh_token is null and id_token is null and password is null
  )
);
create index user_identities_user_id_idx on public.user_identities (user_id);

create table public.auth_verifications (
  id uuid primary key default gen_random_uuid(),
  identifier text not null check (btrim(identifier) <> ''),
  value text not null check (btrim(value) <> ''),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verifications_identifier_idx on public.auth_verifications (identifier);

create table public.user_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  timezone text not null default 'America/Chicago' check (btrim(timezone) <> ''),
  locale text not null default 'en-US' check (btrim(locale) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Preserve every pre-0006 owner UUID as a real, claimable user before constraints change.
with legacy_owner_ids as (
  select owner_id as id from public.recruiting_dates where owner_id is not null
  union select owner_id from public.application_plans
  union select owner_id from public.calendar_items
  union select owner_id from public.calendar_connections
  union select owner_id from public.calendar_oauth_states
  union select requested_by_owner_id from public.calendar_sync_requests
)
insert into public.users (id, name, email, status)
select id, 'Legacy RecruitIntel User', 'legacy+' || id::text || '@recruitintel.invalid',
       'PENDING_IDENTITY'
from legacy_owner_ids
on conflict (id) do nothing;

insert into public.user_profiles (user_id)
select id from public.users
on conflict (user_id) do nothing;

alter table public.recruiting_dates rename column owner_id to user_id;
alter table public.application_plans rename column owner_id to user_id;
alter table public.calendar_items rename column owner_id to user_id;
alter table public.calendar_connections rename column owner_id to user_id;
alter table public.calendar_oauth_states rename column owner_id to user_id;
alter table public.calendar_sync_requests rename column requested_by_owner_id to user_id;

alter table public.recruiting_dates
  add constraint recruiting_dates_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.application_plans
  add constraint application_plans_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_items
  add constraint calendar_items_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_connections
  add constraint calendar_connections_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_oauth_states
  add constraint calendar_oauth_states_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_sync_requests
  add constraint calendar_sync_requests_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;

alter table public.recruiting_dates add constraint recruiting_dates_id_user_unique unique (id, user_id);
alter table public.application_plans add constraint application_plans_id_user_unique unique (id, user_id);
alter table public.calendar_items add constraint calendar_items_id_user_unique unique (id, user_id);
alter table public.calendar_connections add constraint calendar_connections_id_user_unique unique (id, user_id);
alter table public.calendar_sync_requests add constraint calendar_sync_requests_id_user_unique unique (id, user_id);

alter table public.calendar_items drop constraint calendar_items_application_plan_id_fkey;
alter table public.calendar_items
  add constraint calendar_items_plan_owner_fkey foreign key (application_plan_id, user_id)
  references public.application_plans(id, user_id) on delete cascade;

alter table public.application_plan_tasks add column user_id uuid;
update public.application_plan_tasks task
set user_id = plan.user_id
from public.application_plans plan
where plan.id = task.application_plan_id;
alter table public.application_plan_tasks alter column user_id set not null;
alter table public.application_plan_tasks
  add constraint application_plan_tasks_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.application_plan_tasks drop constraint application_plan_tasks_application_plan_id_fkey;
alter table public.application_plan_tasks drop constraint application_plan_tasks_calendar_item_id_fkey;
alter table public.application_plan_tasks
  add constraint application_plan_tasks_plan_owner_fkey
  foreign key (application_plan_id, user_id)
  references public.application_plans(id, user_id) on delete cascade;
alter table public.application_plan_tasks
  add constraint application_plan_tasks_item_owner_fkey
  foreign key (calendar_item_id, user_id)
  references public.calendar_items(id, user_id) on delete cascade;

alter table public.calendar_external_events add column user_id uuid;
update public.calendar_external_events mapping
set user_id = item.user_id
from public.calendar_items item
where item.id = mapping.calendar_item_id;
alter table public.calendar_external_events alter column user_id set not null;
alter table public.calendar_external_events
  add constraint calendar_external_events_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_external_events drop constraint calendar_external_events_calendar_item_id_fkey;
alter table public.calendar_external_events drop constraint calendar_external_events_calendar_connection_id_fkey;
alter table public.calendar_external_events
  add constraint calendar_external_events_item_owner_fkey
  foreign key (calendar_item_id, user_id)
  references public.calendar_items(id, user_id) on delete cascade;
alter table public.calendar_external_events
  add constraint calendar_external_events_connection_owner_fkey
  foreign key (calendar_connection_id, user_id)
  references public.calendar_connections(id, user_id) on delete cascade;

-- The connection is authoritative if an old request ever carried a mismatched owner UUID.
update public.calendar_sync_requests request
set user_id = connection.user_id
from public.calendar_connections connection
where connection.id = request.calendar_connection_id and request.user_id <> connection.user_id;
alter table public.calendar_sync_requests drop constraint calendar_sync_requests_calendar_connection_id_fkey;
alter table public.calendar_sync_requests
  add constraint calendar_sync_requests_connection_owner_fkey
  foreign key (calendar_connection_id, user_id)
  references public.calendar_connections(id, user_id) on delete cascade;

alter table public.calendar_sync_runs add column user_id uuid;
update public.calendar_sync_runs run
set user_id = connection.user_id
from public.calendar_connections connection
where connection.id = run.calendar_connection_id;
alter table public.calendar_sync_runs alter column user_id set not null;
alter table public.calendar_sync_runs
  add constraint calendar_sync_runs_user_fkey foreign key (user_id)
  references public.users(id) on delete cascade;
alter table public.calendar_sync_runs drop constraint calendar_sync_runs_calendar_sync_request_id_fkey;
alter table public.calendar_sync_runs drop constraint calendar_sync_runs_calendar_connection_id_fkey;
alter table public.calendar_sync_runs
  add constraint calendar_sync_runs_request_owner_fkey
  foreign key (calendar_sync_request_id, user_id)
  references public.calendar_sync_requests(id, user_id) on delete cascade;
alter table public.calendar_sync_runs
  add constraint calendar_sync_runs_connection_owner_fkey
  foreign key (calendar_connection_id, user_id)
  references public.calendar_connections(id, user_id) on delete cascade;

create function public.enforce_private_calendar_reference_owner()
returns trigger language plpgsql as $$
declare
  referenced_user_id uuid;
begin
  if new.recruiting_date_id is not null then
    select user_id into referenced_user_id
    from public.recruiting_dates where id = new.recruiting_date_id;
    if referenced_user_id is not null and referenced_user_id <> new.user_id then
      raise exception 'private recruiting date ownership mismatch' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger application_plans_recruiting_date_owner_guard
before insert or update of recruiting_date_id, user_id on public.application_plans
for each row execute function public.enforce_private_calendar_reference_owner();
create trigger calendar_items_recruiting_date_owner_guard
before insert or update of recruiting_date_id, user_id on public.calendar_items
for each row execute function public.enforce_private_calendar_reference_owner();

create table public.service_principals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  kind public.service_principal_kind not null,
  token_prefix text not null unique check (token_prefix ~ '^ri_[a-z]+_[A-Za-z0-9_-]{8,32}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes public.service_scope[] not null check (cardinality(scopes) > 0),
  status public.service_principal_status not null default 'ACTIVE',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_used_ip_hash text check (last_used_ip_hash is null or last_used_ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'REVOKED') = (revoked_at is not null))
);

create table public.extension_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  token_prefix text not null unique check (token_prefix ~ '^ri_ext_[A-Za-z0-9_-]{8,32}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes public.extension_grant_scope[] not null check (cardinality(scopes) > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_used_ip_hash text check (last_used_ip_hash is null or last_used_ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index extension_grants_user_idx on public.extension_grants (user_id, created_at desc);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_kind public.actor_kind not null,
  actor_user_id uuid,
  actor_service_principal_id uuid,
  action text not null check (btrim(action) <> ''),
  resource_type text not null check (btrim(resource_type) <> ''),
  resource_id uuid,
  outcome public.audit_outcome not null,
  request_id uuid,
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and not metadata ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  check (
    (actor_kind in ('USER', 'ADMIN') and actor_user_id is not null)
    or (actor_kind = 'SERVICE' and actor_service_principal_id is not null)
    or actor_kind = 'SYSTEM'
  )
);
create index audit_events_actor_idx on public.audit_events (actor_user_id, occurred_at desc);
create index audit_events_resource_idx
  on public.audit_events (resource_type, resource_id, occurred_at desc);

create function public.reject_audit_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit events are append-only' using errcode = '55000';
end;
$$;
create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.reject_audit_event_mutation();

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type public.product_event_type not null,
  event_version integer not null default 1 check (event_version > 0),
  source public.product_event_source not null,
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  request_id uuid,
  deduplication_key text,
  context jsonb not null default '{}'::jsonb check (
    jsonb_typeof(context) = 'object'
    and not context ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  occurred_at timestamptz not null default now(),
  unique (user_id, deduplication_key)
);
create index product_events_user_time_idx on public.product_events (user_id, occurred_at desc);
create index product_events_type_time_idx on public.product_events (event_type, occurred_at desc);

create table public.ranking_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  surface text not null check (btrim(surface) <> ''),
  candidate_set_version text not null check (btrim(candidate_set_version) <> ''),
  ranking_algorithm text not null check (btrim(ranking_algorithm) <> ''),
  ranking_algorithm_version text not null check (btrim(ranking_algorithm_version) <> ''),
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_count integer not null check (candidate_count >= 0),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.recommendation_impressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  ranking_decision_id uuid not null,
  item_type text not null check (btrim(item_type) <> ''),
  item_id uuid not null,
  rank_position integer not null check (rank_position > 0),
  score numeric,
  shown_at timestamptz not null default now(),
  unique (ranking_decision_id, item_type, item_id),
  unique (ranking_decision_id, rank_position),
  foreign key (ranking_decision_id, user_id)
    references public.ranking_decisions(id, user_id) on delete cascade
);
create index recommendation_impressions_user_time_idx
  on public.recommendation_impressions (user_id, shown_at desc);

create function public.reject_product_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'instrumentation events are append-only' using errcode = '55000';
end;
$$;
create trigger product_events_append_only
before update or delete on public.product_events
for each row execute function public.reject_product_event_mutation();
create trigger ranking_decisions_append_only
before update or delete on public.ranking_decisions
for each row execute function public.reject_product_event_mutation();
create trigger recommendation_impressions_append_only
before update or delete on public.recommendation_impressions
for each row execute function public.reject_product_event_mutation();

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  user_fingerprint text not null check (user_fingerprint ~ '^[0-9a-f]{64}$'),
  request_type public.privacy_request_type not null,
  status public.privacy_request_status not null default 'PENDING',
  failure_code text,
  result_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(result_metadata) = 'object'
    and not result_metadata ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'resume_text', 'dom_html', 'raw_payload'
    ]
  ),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'COMPLETED' and completed_at is not null)
    or status <> 'COMPLETED'
  )
);
create index privacy_requests_user_idx on public.privacy_requests (user_id, requested_at desc);

create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_type public.watchlist_item_type not null,
  company_id uuid references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (item_type = 'COMPANY' and company_id is not null and job_id is null)
    or (item_type = 'JOB' and job_id is not null and company_id is null)
  )
);
create unique index watchlist_company_unique_idx
  on public.watchlist_items (user_id, company_id) where company_id is not null;
create unique index watchlist_job_unique_idx
  on public.watchlist_items (user_id, job_id) where job_id is not null;

create trigger users_set_updated_at before update on public.users
for each row execute function public.set_updated_at();
create trigger user_sessions_set_updated_at before update on public.user_sessions
for each row execute function public.set_updated_at();
create trigger user_profiles_set_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();
create trigger user_identities_set_updated_at before update on public.user_identities
for each row execute function public.set_updated_at();
create trigger service_principals_set_updated_at before update on public.service_principals
for each row execute function public.set_updated_at();
create trigger extension_grants_set_updated_at before update on public.extension_grants
for each row execute function public.set_updated_at();
create trigger privacy_requests_set_updated_at before update on public.privacy_requests
for each row execute function public.set_updated_at();

comment on table public.users is
  'Canonical user identity table and Better Auth 1.7.1 user model.';
comment on table public.user_identities is
  'Authentication identities only. OAuth provider credentials are deliberately never persisted.';
comment on table public.audit_events is
  'Append-only, payload-minimized ledger for security and privacy-sensitive operations.';
comment on table public.product_events is
  'Privacy-safe product interactions; raw resumes, DOM, provider payloads, and secrets are forbidden.';
comment on table public.extension_grants is
  'Minimal future browser-companion grant foundation; no authorization workflow is implemented.';
comment on table public.privacy_requests is
  'Privacy request lifecycle. Encrypted export artifact generation is intentionally outside 0006.';
comment on column public.recruiting_dates.user_id is
  'Null means shared intelligence; non-null means private user-created recruiting date.';
comment on column public.calendar_items.user_id is
  'Authenticated user owner. Browser requests never provide this value.';
