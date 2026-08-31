-- Milestone 12: owner-private browser scan provenance and selected-only intake.
-- No raw HTML, browser credentials, cookies, or DOM control values are stored.

create type public.browser_scan_status as enum (
  'REVIEWING', 'COMPLETED', 'FAILED', 'REVOKED'
);
create type public.browser_candidate_kind as enum ('GRID', 'SINGLE', 'JSON_LD');
create type public.browser_ingest_status as enum (
  'PENDING', 'RESOLVED', 'POLICY_BLOCKED', 'STALE', 'FAILED'
);

alter table public.extension_grants
  add constraint extension_grants_id_user_unique unique (id, user_id);

create table public.browser_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  extension_grant_id uuid,
  page_url text not null check (
    page_url ~ '^https?://'
    and position('?' in page_url) = 0 and position('#' in page_url) = 0
    and page_url !~* '^https?://([^/]*@)'
  ),
  page_host text not null check (
    page_host = lower(page_host) and page_host !~ '[/@: ]' and btrim(page_host) <> ''
  ),
  page_title text not null default '' check (length(page_title) <= 300),
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  protocol_version smallint not null default 1 check (protocol_version > 0),
  status public.browser_scan_status not null default 'REVIEWING',
  candidate_count integer not null default 0 check (candidate_count between 0 and 100),
  selected_count integer not null default 0 check (selected_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, snapshot_fingerprint),
  foreign key (extension_grant_id, user_id)
    references public.extension_grants(id, user_id) on delete set null (extension_grant_id),
  check ((status = 'COMPLETED') = (completed_at is not null))
);
create index browser_scan_sessions_user_created_idx
  on public.browser_scan_sessions (user_id, created_at desc, id);

create table public.page_snapshots (
  id uuid primary key default gen_random_uuid(),
  scan_session_id uuid not null,
  user_id uuid not null,
  page_url text not null check (
    page_url ~ '^https?://' and position('?' in page_url) = 0 and position('#' in page_url) = 0
  ),
  content_fingerprint text not null check (content_fingerprint ~ '^[0-9a-f]{64}$'),
  extraction_version smallint not null default 1 check (extraction_version > 0),
  json_ld_count smallint not null default 0 check (json_ld_count between 0 and 25),
  link_count smallint not null default 0 check (link_count between 0 and 250),
  summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(summary) = 'object'
    and not summary ?| array[
      'html', 'raw_html', 'dom_html', 'cookie', 'cookies', 'localstorage',
      'sessionstorage', 'authorization', 'access_token', 'refresh_token', 'password'
    ]
  ),
  created_at timestamptz not null default now(),
  unique (scan_session_id),
  unique (id, user_id),
  foreign key (scan_session_id, user_id)
    references public.browser_scan_sessions(id, user_id) on delete cascade
);

create table public.page_job_candidates (
  id uuid primary key default gen_random_uuid(),
  scan_session_id uuid not null,
  snapshot_id uuid not null,
  user_id uuid not null,
  ordinal smallint not null check (ordinal between 0 and 99),
  candidate_kind public.browser_candidate_kind not null,
  candidate_fingerprint text not null check (candidate_fingerprint ~ '^[0-9a-f]{64}$'),
  job_url text not null check (
    job_url ~ '^https?://' and position('?' in job_url) = 0 and position('#' in job_url) = 0
    and job_url !~* '^https?://([^/]*@)'
  ),
  title text not null check (btrim(title) <> '' and length(title) <= 300),
  company_name text check (company_name is null or length(company_name) <= 300),
  location_text text not null default '' check (length(location_text) <= 300),
  description_excerpt text not null default '' check (length(description_excerpt) <= 8000),
  rank_score integer not null check (rank_score between 0 and 100),
  rank_reasons text[] not null default '{}' check (cardinality(rank_reasons) <= 12),
  extraction_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(extraction_metadata) = 'object'
    and not extraction_metadata ?| array[
      'html', 'raw_html', 'dom_html', 'cookie', 'cookies', 'authorization',
      'access_token', 'refresh_token', 'password', 'instruction', 'prompt'
    ]
  ),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (scan_session_id, candidate_fingerprint),
  unique (scan_session_id, ordinal),
  foreign key (scan_session_id, user_id)
    references public.browser_scan_sessions(id, user_id) on delete cascade,
  foreign key (snapshot_id, user_id) references public.page_snapshots(id, user_id) on delete cascade
);
create index page_job_candidates_user_session_rank_idx
  on public.page_job_candidates (user_id, scan_session_id, rank_score desc, ordinal, id);

create table public.browser_ingest_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  candidate_id uuid not null,
  candidate_revision integer not null check (candidate_revision > 0),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  status public.browser_ingest_status not null default 'PENDING',
  source_policy_id uuid references public.source_policies(id) on delete set null,
  source_posting_id uuid references public.jobs(id) on delete set null,
  opportunity_id uuid references public.job_opportunities(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  application_plan_id uuid references public.application_plans(id) on delete set null,
  match_id uuid references public.resume_job_matches(id) on delete set null,
  result_code text not null default 'PENDING' check (btrim(result_code) <> '' and length(result_code) <= 100),
  result_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(result_metadata) = 'object'
    and not result_metadata ?| array[
      'html', 'raw_html', 'dom_html', 'cookie', 'cookies', 'authorization',
      'access_token', 'refresh_token', 'password', 'resume_text'
    ]
  ),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, candidate_id),
  unique (user_id, idempotency_key),
  foreign key (candidate_id, user_id)
    references public.page_job_candidates(id, user_id) on delete cascade
);
create index browser_ingest_decisions_user_created_idx
  on public.browser_ingest_decisions (user_id, created_at desc, id);
create index browser_ingest_decisions_opportunity_idx
  on public.browser_ingest_decisions (opportunity_id, id) where opportunity_id is not null;

create trigger browser_scan_sessions_set_updated_at before update on public.browser_scan_sessions
  for each row execute function public.set_updated_at();
create trigger browser_ingest_decisions_set_updated_at before update on public.browser_ingest_decisions
  for each row execute function public.set_updated_at();

comment on table public.browser_scan_sessions is
  'M12 private explicit browser scans. Contains sanitized provenance only, never HTML or credentials.';
comment on table public.page_snapshots is
  'M12 private bounded snapshot summary; raw DOM and browser state are intentionally not retained.';
comment on table public.page_job_candidates is
  'M12 private untrusted candidate extraction. Selection is required before shared-job ingestion.';
comment on table public.browser_ingest_decisions is
  'M12 private selected-only bridge to existing M8/M10/M11 records; historical targets are immutable.';
