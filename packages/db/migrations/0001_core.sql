create extension if not exists pgcrypto;

create type public.ats_type as enum (
  'GREENHOUSE', 'LEVER', 'ASHBY', 'WORKDAY', 'SMARTRECRUITERS',
  'ICIMS', 'SUCCESSFACTORS', 'BAMBOOHR', 'OTHER'
);

create type public.source_type as enum (
  'ATS', 'COMPANY_CAREERS', 'GITHUB', 'PUBLIC_WEB', 'UNIVERSITY',
  'FORUM', 'COMPANY_BLOG', 'RECRUITER_PUBLIC_PAGE', 'MANUAL', 'OTHER'
);

create type public.employment_type as enum (
  'FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'CO_OP', 'OTHER', 'UNKNOWN'
);

create type public.role_family as enum (
  'SOFTWARE_ENGINEERING', 'AI_ML', 'DATA_SCIENCE', 'DATA_ENGINEERING',
  'PRODUCT', 'DESIGN', 'SECURITY', 'CLOUD_DEVOPS', 'QUANT', 'HARDWARE', 'OTHER'
);

create type public.experience_level as enum (
  'INTERNSHIP', 'ENTRY_LEVEL', 'MID_LEVEL', 'SENIOR', 'LEADERSHIP', 'UNKNOWN'
);

create type public.recruiting_event_type as enum (
  'JOB_OPENED', 'JOB_CHANGED', 'JOB_CLOSED',
  'RECRUITER_DISCOVERED', 'RECRUITER_ACTIVITY',
  'GITHUB_REPOSITORY_UPDATED',
  'INTERVIEW_QUESTION_ADDED', 'INTERVIEW_QUESTION_UPDATED',
  'INTERVIEW_REPORT_DISCOVERED', 'CAREER_PAGE_CHANGED',
  'CAMPUS_EVENT_DISCOVERED', 'RECRUITING_ARTICLE_DISCOVERED',
  'APPLICATION_DATE_SIGNAL', 'HIRING_SIGNAL'
);

create type public.collector_run_status as enum ('RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED');
create type public.observation_entity_type as enum ('JOB');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (btrim(canonical_name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  website text check (website is null or website ~ '^https://'),
  careers_url text check (careers_url is null or careers_url ~ '^https://'),
  description text,
  industry text,
  logo_url text check (logo_url is null or logo_url ~ '^https://'),
  ats_type public.ats_type,
  ats_identifier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ats_type, ats_identifier)
);

create table public.company_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null unique check (btrim(normalized_alias) <> ''),
  created_at timestamptz not null default now()
);

create table public.company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null unique check (domain = lower(domain) and domain !~ '[/@: ]'),
  created_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  source_type public.source_type not null,
  provider text not null check (provider ~ '^[a-z0-9_-]+$'),
  external_key text not null check (btrim(external_key) <> ''),
  name text not null check (btrim(name) <> ''),
  base_url text check (base_url is null or base_url ~ '^https://'),
  reliability numeric(4, 3) not null default 0.500 check (reliability between 0 and 1),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_key),
  check (source_type <> 'ATS' or company_id is not null)
);

create table public.collector_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  collector text not null check (btrim(collector) <> ''),
  status public.collector_run_status not null default 'RUNNING',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_discovered integer not null default 0 check (items_discovered >= 0),
  items_new integer not null default 0 check (items_new >= 0),
  items_changed integer not null default 0 check (items_changed >= 0),
  items_unchanged integer not null default 0 check (items_unchanged >= 0),
  items_closed integer not null default 0 check (items_closed >= 0),
  errors integer not null default 0 check (errors >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check ((status = 'RUNNING' and finished_at is null) or (status <> 'RUNNING' and finished_at is not null))
);

create unique index collector_runs_one_running_per_source_idx
  on public.collector_runs (source_id) where status = 'RUNNING';
create index collector_runs_source_started_idx on public.collector_runs (source_id, started_at desc);

create table public.collector_errors (
  id uuid primary key default gen_random_uuid(),
  collector_run_id uuid not null references public.collector_runs(id) on delete cascade,
  stage text not null check (stage in ('DISCOVER', 'FETCH', 'NORMALIZE', 'FINGERPRINT', 'PERSIST', 'FINALIZE')),
  error_type text not null check (btrim(error_type) <> ''),
  message text not null check (btrim(message) <> ''),
  retryable boolean not null default false,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  occurred_at timestamptz not null default now()
);

create index collector_errors_run_idx on public.collector_errors (collector_run_id, occurred_at);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  external_id text not null check (btrim(external_id) <> ''),
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  location text not null default '',
  employment_type public.employment_type not null default 'UNKNOWN',
  role_family public.role_family not null default 'OTHER',
  experience_level public.experience_level not null default 'UNKNOWN',
  is_internship boolean not null default false,
  is_new_grad boolean not null default false,
  season text,
  graduation_years integer[] not null default '{}',
  application_url text not null check (application_url ~ '^https://'),
  source_url text not null check (source_url ~ '^https://'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  published_at timestamptz,
  closed_at timestamptz,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fingerprint_version smallint not null default 1 check (fingerprint_version > 0),
  classification_version smallint not null default 1 check (classification_version > 0),
  last_seen_run_id uuid references public.collector_runs(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id),
  check (not is_internship or experience_level = 'INTERNSHIP'),
  check (closed_at is null or closed_at >= first_seen_at)
);

create index jobs_company_open_idx
  on public.jobs (company_id, coalesce(published_at, first_seen_at) desc, id)
  where closed_at is null;
create index jobs_open_recent_idx
  on public.jobs (coalesce(published_at, first_seen_at) desc, id)
  where closed_at is null;
create index jobs_source_open_idx on public.jobs (source_id, id) where closed_at is null;
create index jobs_role_family_open_idx on public.jobs (role_family, id) where closed_at is null;

create table public.job_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  collector_run_id uuid not null references public.collector_runs(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fingerprint_version smallint not null check (fingerprint_version > 0),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  raw_payload jsonb not null,
  observed_at timestamptz not null default now(),
  unique (job_id, content_hash)
);

create index job_snapshots_job_observed_idx on public.job_snapshots (job_id, observed_at desc);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  collector_run_id uuid not null references public.collector_runs(id) on delete cascade,
  entity_type public.observation_entity_type not null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  source_url text not null check (source_url ~ '^https://'),
  collected_at timestamptz not null default now(),
  published_at timestamptz,
  raw_text text,
  normalized_text text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (entity_type = 'JOB')
);

create index observations_job_collected_idx on public.observations (job_id, collected_at desc);
create index observations_source_collected_idx on public.observations (source_id, collected_at desc);

create table public.recruiting_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  event_type public.recruiting_event_type not null,
  occurred_at timestamptz not null,
  discovered_at timestamptz not null default now(),
  source_url text not null check (source_url ~ '^https://'),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  check (event_type not in ('JOB_OPENED', 'JOB_CHANGED', 'JOB_CLOSED') or job_id is not null)
);

create index recruiting_events_company_timeline_idx
  on public.recruiting_events (company_id, occurred_at desc, id desc);
create index recruiting_events_recent_idx on public.recruiting_events (occurred_at desc, id desc);
create index recruiting_events_job_idx on public.recruiting_events (job_id, occurred_at desc) where job_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();

comment on table public.jobs is 'Current job projection. History lives in job_snapshots, observations, and recruiting_events.';
comment on table public.recruiting_events is 'Immutable recruiting transitions. UPDATE and DELETE are reserved for administrative repair.';
comment on column public.sources.reliability is 'Internal source-ranking signal, not a statement that a claim is true.';

