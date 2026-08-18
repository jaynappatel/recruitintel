create type public.web_search_status as enum (
  'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED', 'DISABLED'
);

create type public.web_candidate_fetch_status as enum (
  'PENDING', 'FETCHED', 'UNCHANGED', 'FAILED', 'BLOCKED'
);

create type public.web_relevance_status as enum (
  'UNKNOWN', 'RELEVANT', 'POSSIBLY_RELEVANT', 'NOT_RELEVANT'
);

create type public.web_source_classification as enum (
  'COMPANY_CAREERS', 'COMPANY_BLOG', 'COMPANY_PUBLIC_PAGE', 'UNIVERSITY',
  'FORUM', 'GITHUB', 'PUBLIC_WEB', 'RECRUITER_PUBLIC_PAGE', 'OTHER'
);

create type public.source_reliability_level as enum (
  'OFFICIAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'
);

create type public.public_recruiting_observation_type as enum (
  'INTERNSHIP_OPENING_SIGNAL', 'NEW_GRAD_OPENING_SIGNAL', 'APPLICATION_DATE',
  'APPLICATION_DEADLINE', 'CAREER_FAIR', 'CAMPUS_VISIT', 'EARLY_CAREER_PROGRAM',
  'INTERVIEW_EXPERIENCE', 'RECRUITING_ANNOUNCEMENT', 'ROLE_FAMILY_SIGNAL',
  'SCHOOL_RECRUITING_SIGNAL', 'GENERAL_RECRUITING_SIGNAL'
);

create type public.date_precision as enum (
  'EXACT', 'RANGE', 'MONTH', 'APPROXIMATE', 'UNKNOWN'
);

create type public.date_certainty as enum (
  'CONFIRMED', 'ESTIMATED', 'HISTORICAL', 'CLAIMED'
);

create type public.public_web_work_type as enum ('WEB_SEARCH', 'WEB_FETCH', 'WEB_PROCESS');
create type public.public_web_work_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);
create type public.recruiting_claim_status as enum (
  'SINGLE_SOURCE', 'SUPPORTED', 'CONFLICTING'
);

alter table public.sources drop constraint sources_base_url_check;
alter table public.sources add constraint sources_base_url_check
  check (base_url is null or base_url ~ '^https?://');

alter table public.recruiting_events drop constraint recruiting_events_source_url_check;
alter table public.recruiting_events add constraint recruiting_events_source_url_check
  check (source_url ~ '^https?://');

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique check (btrim(canonical_name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  website text check (website is null or website ~ '^https?://'),
  domains text[] not null default '{}',
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (array_position(domains, '') is null),
  check (array_position(aliases, '') is null)
);

create table public.public_web_search_queries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_-]+$'),
  template_key text not null check (template_key ~ '^[a-z0-9_-]+$'),
  query text not null check (btrim(query) <> ''),
  role_family public.role_family,
  school_id uuid references public.schools(id) on delete set null,
  graduation_year integer check (graduation_year is null or graduation_year between 2020 and 2040),
  focus text check (focus is null or focus in ('INTERNSHIP', 'NEW_GRAD', 'BOTH')),
  minimum_interval_seconds integer not null default 86400
    check (minimum_interval_seconds between 60 and 2592000),
  max_results integer not null default 10 check (max_results between 1 and 100),
  max_fetches integer not null default 5 check (max_fetches between 0 and max_results),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_result_count integer not null default 0 check (last_result_count >= 0),
  next_allowed_run_at timestamptz,
  status public.web_search_status not null default 'READY',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, query)
);

create index public_web_search_queries_due_idx
  on public.public_web_search_queries (next_allowed_run_at, id)
  where status in ('READY', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED');
create index public_web_search_queries_company_idx
  on public.public_web_search_queries (company_id, created_at desc, id);

create table public.public_web_candidates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  source_provider text not null check (source_provider ~ '^[a-z0-9_-]+$'),
  original_url text not null check (original_url ~ '^https?://'),
  canonical_url text not null check (canonical_url ~ '^https?://'),
  title text,
  snippet text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  fetch_status public.web_candidate_fetch_status not null default 'PENDING',
  http_status integer check (http_status is null or http_status between 100 and 599),
  content_type text,
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  relevance_status public.web_relevance_status not null default 'UNKNOWN',
  source_classification public.web_source_classification not null default 'PUBLIC_WEB',
  reliability_level public.source_reliability_level not null default 'UNKNOWN',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, canonical_url),
  unique (source_id),
  check (last_seen_at >= first_seen_at)
);

create index public_web_candidates_company_idx
  on public.public_web_candidates (company_id, last_seen_at desc, id);
create index public_web_candidates_pending_idx
  on public.public_web_candidates (first_seen_at, id) where fetch_status = 'PENDING';
create index public_web_candidates_hash_idx
  on public.public_web_candidates (content_hash) where content_hash is not null;

create table public.public_web_candidate_discoveries (
  candidate_id uuid not null references public.public_web_candidates(id) on delete cascade,
  search_query_id uuid not null references public.public_web_search_queries(id) on delete cascade,
  result_rank integer check (result_rank is null or result_rank > 0),
  discovered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (candidate_id, search_query_id)
);

create table public.public_web_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.public_web_candidates(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz not null,
  final_url text not null check (final_url ~ '^https?://'),
  http_status integer not null check (http_status between 200 and 299),
  content_type text not null,
  title text,
  meta_description text,
  canonical_url text check (canonical_url is null or canonical_url ~ '^https?://'),
  published_at timestamptz,
  headings text[] not null default '{}',
  extracted_text text not null check (btrim(extracted_text) <> ''),
  structured_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(structured_metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (candidate_id, content_hash)
);

create index public_web_documents_candidate_idx
  on public.public_web_documents (candidate_id, fetched_at desc, id desc);

create table public.public_recruiting_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  candidate_id uuid not null references public.public_web_candidates(id) on delete cascade,
  document_id uuid not null references public.public_web_documents(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  observation_type public.public_recruiting_observation_type not null,
  title text not null check (btrim(title) <> ''),
  summary text not null check (btrim(summary) <> ''),
  evidence_text text not null check (btrim(evidence_text) <> ''),
  source_url text not null check (source_url ~ '^https?://'),
  source_classification public.web_source_classification not null,
  reliability_level public.source_reliability_level not null,
  occurred_at timestamptz,
  date_start date,
  date_end date,
  date_precision public.date_precision not null default 'UNKNOWN',
  date_certainty public.date_certainty not null default 'CLAIMED',
  discovered_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (date_end is null or date_start is not null),
  check (date_end is null or date_end >= date_start)
);

create index public_recruiting_observations_company_idx
  on public.public_recruiting_observations (
    company_id, coalesce(occurred_at, discovered_at) desc, id desc
  );
create index public_recruiting_observations_candidate_idx
  on public.public_recruiting_observations (candidate_id, last_verified_at desc, id desc);
create index public_recruiting_observations_type_idx
  on public.public_recruiting_observations (company_id, observation_type, last_verified_at desc);

create table public.public_recruiting_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  claim_type public.public_recruiting_observation_type not null,
  title text not null check (btrim(title) <> ''),
  normalized_subject text not null check (btrim(normalized_subject) <> ''),
  status public.recruiting_claim_status not null default 'SINGLE_SOURCE',
  preferred_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  last_verified_at timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, claim_type, normalized_subject)
);

create index public_recruiting_claims_company_idx
  on public.public_recruiting_claims (company_id, last_verified_at desc, id desc);

create table public.public_recruiting_claim_observations (
  claim_id uuid not null references public.public_recruiting_claims(id) on delete cascade,
  observation_id uuid not null
    references public.public_recruiting_observations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (claim_id, observation_id),
  unique (observation_id)
);

create table public.public_web_work_requests (
  id uuid primary key default gen_random_uuid(),
  work_type public.public_web_work_type not null,
  status public.public_web_work_status not null default 'PENDING',
  company_id uuid not null references public.companies(id) on delete cascade,
  search_query_id uuid references public.public_web_search_queries(id) on delete cascade,
  candidate_id uuid references public.public_web_candidates(id) on delete cascade,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  requested_by text not null default 'api' check (btrim(requested_by) <> ''),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (
    (work_type = 'WEB_SEARCH' and search_query_id is not null and candidate_id is null)
    or (work_type in ('WEB_FETCH', 'WEB_PROCESS') and candidate_id is not null)
  ),
  check (
    (status = 'PENDING' and started_at is null and finished_at is null)
    or (status = 'RUNNING' and started_at is not null and finished_at is null)
    or (status in ('SUCCEEDED', 'FAILED', 'CANCELLED') and finished_at is not null)
  )
);

create unique index public_web_work_requests_active_search_idx
  on public.public_web_work_requests (work_type, search_query_id)
  where status in ('PENDING', 'RUNNING') and work_type = 'WEB_SEARCH';
create unique index public_web_work_requests_active_candidate_idx
  on public.public_web_work_requests (work_type, candidate_id)
  where status in ('PENDING', 'RUNNING') and work_type in ('WEB_FETCH', 'WEB_PROCESS');
create index public_web_work_requests_pending_idx
  on public.public_web_work_requests (next_attempt_at, requested_at, id)
  where status = 'PENDING';

create table public.public_web_runs (
  collector_run_id uuid primary key references public.collector_runs(id) on delete cascade,
  work_request_id uuid not null unique
    references public.public_web_work_requests(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text,
  query text,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  relevant_count integer not null default 0 check (relevant_count >= 0),
  observations_created integer not null default 0 check (observations_created >= 0),
  events_created integer not null default 0 check (events_created >= 0),
  errors integer not null default 0 check (errors >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.recruiting_events
  add column public_recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  add column public_web_candidate_id uuid
    references public.public_web_candidates(id) on delete set null;

create index recruiting_events_public_observation_idx
  on public.recruiting_events (public_recruiting_observation_id, occurred_at desc, id desc)
  where public_recruiting_observation_id is not null;
create index recruiting_events_public_candidate_idx
  on public.recruiting_events (public_web_candidate_id, occurred_at desc, id desc)
  where public_web_candidate_id is not null;

create trigger schools_set_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

create trigger public_web_search_queries_set_updated_at
before update on public.public_web_search_queries
for each row execute function public.set_updated_at();

create trigger public_web_candidates_set_updated_at
before update on public.public_web_candidates
for each row execute function public.set_updated_at();

create trigger public_recruiting_claims_set_updated_at
before update on public.public_recruiting_claims
for each row execute function public.set_updated_at();

comment on table public.public_web_documents is
  'Immutable normalized text snapshots. Raw HTML is neither trusted nor retained.';
comment on table public.public_recruiting_observations is
  'Source-specific public recruiting evidence. Independent sources are intentionally preserved.';
comment on table public.public_recruiting_claims is
  'Lightweight aggregates over observations; CONFLICTING preserves disagreement rather than resolving it.';
comment on column public.public_recruiting_observations.reliability_level is
  'Transparent ranking metadata, not a statement that the observation is true.';
