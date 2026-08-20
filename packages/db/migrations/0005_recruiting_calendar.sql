create type public.recruiting_date_type as enum (
  'APPLICATION_OPEN', 'APPLICATION_DEADLINE', 'EXPECTED_OPENING_WINDOW',
  'CAREER_FAIR', 'CAMPUS_EVENT', 'INFO_SESSION', 'INTERVIEW_EVENT', 'OTHER'
);

create type public.calendar_date_certainty as enum (
  'CONFIRMED', 'ESTIMATED', 'HISTORICAL', 'CLAIMED', 'USER_CREATED'
);

create type public.recruiting_date_source as enum (
  'PUBLIC_OBSERVATION', 'PUBLIC_CLAIM', 'CAMPUS_EVENT', 'RECRUITING_EVENT', 'USER'
);

create type public.calendar_item_type as enum (
  'RECRUITING_DATE', 'APPLICATION_TASK', 'LEETCODE', 'INTERVIEW_PREP',
  'SYSTEM_DESIGN', 'BEHAVIORAL_PREP', 'RECRUITER_OUTREACH', 'RESUME_WORK',
  'CAREER_EVENT', 'OA', 'CUSTOM'
);

create type public.calendar_item_status as enum ('TODO', 'DONE', 'SKIPPED', 'CANCELLED');

create type public.calendar_item_source as enum (
  'RECRUITING_INTELLIGENCE', 'USER', 'APPLICATION_PLAN'
);

create type public.application_plan_status as enum ('DRAFT', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

create type public.calendar_provider as enum ('GOOGLE');

create type public.calendar_connection_status as enum (
  'CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR'
);

create type public.calendar_sync_status as enum (
  'PENDING', 'SYNCED', 'UNCHANGED', 'DELETED', 'ERROR'
);

create type public.calendar_work_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

create table public.recruiting_dates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  company_id uuid references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  recruiting_event_id uuid references public.recruiting_events(id) on delete set null,
  campus_recruiting_event_id uuid
    references public.campus_recruiting_events(id) on delete set null,
  public_recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  public_recruiting_claim_id uuid
    references public.public_recruiting_claims(id) on delete set null,
  source_id uuid references public.sources(id) on delete set null,
  type public.recruiting_date_type not null,
  title text not null check (btrim(title) <> ''),
  starts_at timestamptz not null,
  ends_at timestamptz,
  starts_on date,
  ends_on date,
  all_day boolean not null default true,
  timezone text not null default 'UTC' check (btrim(timezone) <> ''),
  date_certainty public.calendar_date_certainty not null,
  date_precision public.date_precision not null default 'UNKNOWN',
  confidence numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  source_kind public.recruiting_date_source not null,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  source_fingerprint text not null unique check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (ends_on is null or starts_on is not null),
  check (ends_on is null or ends_on >= starts_on),
  check ((all_day and starts_on is not null) or (not all_day and starts_on is null)),
  check ((source_kind = 'USER') = (owner_id is not null)),
  check (
    source_kind = 'USER' or source_id is not null or recruiting_event_id is not null
  )
);

create index recruiting_dates_range_idx
  on public.recruiting_dates (starts_at, coalesce(ends_at, starts_at), id);
create index recruiting_dates_company_idx
  on public.recruiting_dates (company_id, starts_at, id) where company_id is not null;
create index recruiting_dates_school_idx
  on public.recruiting_dates (school_id, starts_at, id) where school_id is not null;
create unique index recruiting_dates_observation_unique_idx
  on public.recruiting_dates (public_recruiting_observation_id)
  where public_recruiting_observation_id is not null;
create unique index recruiting_dates_campus_event_unique_idx
  on public.recruiting_dates (campus_recruiting_event_id)
  where campus_recruiting_event_id is not null;

create table public.application_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  recruiting_date_id uuid references public.recruiting_dates(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  target_date date not null,
  timezone text not null default 'UTC' check (btrim(timezone) <> ''),
  status public.application_plan_status not null default 'DRAFT',
  template_version integer not null default 1 check (template_version > 0),
  plan_fingerprint text not null check (plan_fingerprint ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, plan_fingerprint),
  check ((status = 'DRAFT' and activated_at is null) or status <> 'DRAFT')
);

create index application_plans_owner_idx
  on public.application_plans (owner_id, target_date, id);
create index application_plans_company_idx
  on public.application_plans (company_id, target_date, id);

create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  company_id uuid references public.companies(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  recruiting_date_id uuid references public.recruiting_dates(id) on delete set null,
  application_plan_id uuid references public.application_plans(id) on delete cascade,
  type public.calendar_item_type not null,
  title text not null check (btrim(title) <> ''),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  starts_on date,
  ends_on date,
  all_day boolean not null default false,
  timezone text not null check (btrim(timezone) <> ''),
  status public.calendar_item_status not null default 'TODO',
  source public.calendar_item_source not null,
  sync_enabled boolean not null default false,
  completed_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (ends_on is null or starts_on is not null),
  check (ends_on is null or ends_on >= starts_on),
  check ((all_day and starts_on is not null) or (not all_day and starts_on is null)),
  check ((status = 'DONE') = (completed_at is not null)),
  check ((source = 'RECRUITING_INTELLIGENCE') = (recruiting_date_id is not null)),
  check ((source = 'APPLICATION_PLAN') = (application_plan_id is not null))
);

create index calendar_items_owner_range_idx
  on public.calendar_items (owner_id, starts_at, id) where deleted_at is null;
create index calendar_items_company_idx
  on public.calendar_items (owner_id, company_id, starts_at, id)
  where company_id is not null and deleted_at is null;
create index calendar_items_sync_idx
  on public.calendar_items (owner_id, sync_enabled, updated_at, id);
create unique index calendar_items_recruiting_date_owner_unique_idx
  on public.calendar_items (owner_id, recruiting_date_id)
  where recruiting_date_id is not null;

create table public.application_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  application_plan_id uuid not null references public.application_plans(id) on delete cascade,
  calendar_item_id uuid not null unique references public.calendar_items(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  relative_day_offset integer,
  task_type public.calendar_item_type not null,
  generated_reason text not null check (btrim(generated_reason) <> ''),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (application_plan_id, sequence)
);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider public.calendar_provider not null,
  provider_account_id text,
  provider_email text,
  selected_calendar_id text not null default 'primary' check (btrim(selected_calendar_id) <> ''),
  encrypted_refresh_token text,
  scopes text[] not null default '{}',
  connection_status public.calendar_connection_status not null default 'DISCONNECTED',
  token_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(token_metadata) = 'object'),
  sync_recruiting_dates boolean not null default true,
  sync_application_tasks boolean not null default true,
  sync_leetcode boolean not null default true,
  sync_interview_prep boolean not null default true,
  sync_career_events boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status public.calendar_sync_status,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider),
  check (
    connection_status not in ('CONNECTED', 'REAUTH_REQUIRED')
    or encrypted_refresh_token is not null
  )
);

create table public.calendar_oauth_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  provider public.calendar_provider not null,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  encrypted_code_verifier text not null,
  return_to text not null default '/settings'
    check (return_to ~ '^/[A-Za-z0-9/_?=&.-]*$' and return_to !~ '^//'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index calendar_oauth_states_expiry_idx
  on public.calendar_oauth_states (expires_at) where consumed_at is null;

create table public.calendar_external_events (
  id uuid primary key default gen_random_uuid(),
  calendar_item_id uuid not null references public.calendar_items(id) on delete cascade,
  calendar_connection_id uuid not null
    references public.calendar_connections(id) on delete cascade,
  provider public.calendar_provider not null,
  external_calendar_id text not null check (btrim(external_calendar_id) <> ''),
  external_event_id text not null check (btrim(external_event_id) <> ''),
  last_synced_hash text check (
    last_synced_hash is null or last_synced_hash ~ '^[0-9a-f]{64}$'
  ),
  last_synced_at timestamptz,
  sync_status public.calendar_sync_status not null default 'PENDING',
  provider_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_metadata) = 'object'),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_item_id, calendar_connection_id),
  unique (calendar_connection_id, external_calendar_id, external_event_id)
);

create table public.calendar_sync_requests (
  id uuid primary key default gen_random_uuid(),
  calendar_connection_id uuid not null
    references public.calendar_connections(id) on delete cascade,
  requested_by_owner_id uuid not null,
  status public.calendar_work_status not null default 'PENDING',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create unique index calendar_sync_requests_active_unique_idx
  on public.calendar_sync_requests (calendar_connection_id)
  where status in ('PENDING', 'RUNNING');
create index calendar_sync_requests_pending_idx
  on public.calendar_sync_requests (next_attempt_at, requested_at, id)
  where status = 'PENDING';

create table public.calendar_sync_runs (
  id uuid primary key default gen_random_uuid(),
  calendar_sync_request_id uuid not null
    references public.calendar_sync_requests(id) on delete cascade,
  calendar_connection_id uuid not null
    references public.calendar_connections(id) on delete cascade,
  status public.calendar_work_status not null default 'RUNNING',
  attempted_items integer not null default 0 check (attempted_items >= 0),
  created_events integer not null default 0 check (created_events >= 0),
  updated_events integer not null default 0 check (updated_events >= 0),
  deleted_events integer not null default 0 check (deleted_events >= 0),
  unchanged_events integer not null default 0 check (unchanged_events >= 0),
  failed_events integer not null default 0 check (failed_events >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index calendar_sync_runs_request_idx
  on public.calendar_sync_runs (calendar_sync_request_id, started_at desc, id desc);

create trigger recruiting_dates_set_updated_at
before update on public.recruiting_dates
for each row execute function public.set_updated_at();

create trigger application_plans_set_updated_at
before update on public.application_plans
for each row execute function public.set_updated_at();

create trigger calendar_items_set_updated_at
before update on public.calendar_items
for each row execute function public.set_updated_at();

create trigger calendar_connections_set_updated_at
before update on public.calendar_connections
for each row execute function public.set_updated_at();

create trigger calendar_external_events_set_updated_at
before update on public.calendar_external_events
for each row execute function public.set_updated_at();

comment on column public.recruiting_dates.owner_id is
  'Nullable MVP owner abstraction: null is shared intelligence; populated is user-created.';
comment on column public.calendar_items.owner_id is
  'Server-resolved MVP owner UUID. It is intentionally not a multi-user authentication model.';
comment on table public.recruiting_dates is
  'Provenance-preserving temporal intelligence. Certainty is never promoted by this projection.';
comment on table public.calendar_external_events is
  'Idempotent one-way provider mapping retained across retries and local soft deletion.';
comment on table public.calendar_sync_requests is
  'Durable finite-worker queue for one-way RecruitIntel-to-provider synchronization.';
