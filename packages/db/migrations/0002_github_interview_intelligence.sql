create type public.github_repository_type as enum (
  'INTERNSHIP_LIST', 'NEW_GRAD_LIST', 'INTERVIEW_QUESTIONS',
  'COMPANY_REPOSITORY', 'OTHER'
);

create type public.github_parser_type as enum (
  'AUTO', 'MARKDOWN_TABLE', 'CSV', 'JSON',
  'INTERNSHIP_LIST', 'INTERVIEW_QUESTIONS'
);

create type public.question_difficulty as enum ('EASY', 'MEDIUM', 'HARD');
create type public.github_sync_request_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null unique references public.sources(id) on delete cascade,
  owner text not null check (
    owner = lower(owner) and owner ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$'
  ),
  repository_name text not null check (
    repository_name = lower(repository_name)
    and repository_name ~ '^[a-z0-9._-]{1,100}$'
  ),
  repository_url text not null check (
    repository_url ~ '^https://github[.]com/[a-z0-9-]+/[a-z0-9._-]+$'
  ),
  default_branch text check (default_branch is null or btrim(default_branch) <> ''),
  repository_type public.github_repository_type not null,
  parser_type public.github_parser_type not null default 'AUTO',
  enabled boolean not null default true,
  last_seen_commit_sha text check (
    last_seen_commit_sha is null
    or last_seen_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  last_processed_commit_sha text check (
    last_processed_commit_sha is null
    or last_processed_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  last_checked_at timestamptz,
  rate_limit_remaining integer check (
    rate_limit_remaining is null or rate_limit_remaining >= 0
  ),
  rate_limit_reset_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, repository_name)
);

create table public.github_repository_company_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  github_repository_id uuid not null references public.github_repositories(id) on delete cascade,
  watched_paths text[] not null default '{}',
  company_mapping_rules jsonb not null default '{}'::jsonb
    check (jsonb_typeof(company_mapping_rules) = 'object'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, github_repository_id),
  check (array_position(watched_paths, '') is null)
);

create index github_repository_links_repository_idx
  on public.github_repository_company_links (github_repository_id, company_id)
  where enabled;

create table public.github_sync_requests (
  id uuid primary key default gen_random_uuid(),
  github_repository_id uuid not null references public.github_repositories(id) on delete cascade,
  status public.github_sync_request_status not null default 'PENDING',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  requested_by text not null default 'api' check (btrim(requested_by) <> ''),
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (
    (status = 'PENDING' and started_at is null and finished_at is null)
    or (status = 'RUNNING' and started_at is not null and finished_at is null)
    or (status in ('SUCCEEDED', 'FAILED', 'CANCELLED') and finished_at is not null)
  )
);

create unique index github_sync_requests_one_active_idx
  on public.github_sync_requests (github_repository_id)
  where status in ('PENDING', 'RUNNING');
create index github_sync_requests_pending_idx
  on public.github_sync_requests (requested_at, id) where status = 'PENDING';

create table public.github_sync_runs (
  collector_run_id uuid primary key references public.collector_runs(id) on delete cascade,
  github_repository_id uuid not null references public.github_repositories(id) on delete cascade,
  sync_request_id uuid references public.github_sync_requests(id) on delete set null,
  previous_commit_sha text check (
    previous_commit_sha is null
    or previous_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  current_commit_sha text check (
    current_commit_sha is null
    or current_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  files_inspected integer not null default 0 check (files_inspected >= 0),
  records_parsed integer not null default 0 check (records_parsed >= 0),
  records_new integer not null default 0 check (records_new >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_unchanged integer not null default 0 check (records_unchanged >= 0),
  unresolved_records integer not null default 0 check (unresolved_records >= 0),
  skipped_unchanged_sha boolean not null default false,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  rate_limit_remaining integer check (
    rate_limit_remaining is null or rate_limit_remaining >= 0
  ),
  rate_limit_reset_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index github_sync_runs_repository_idx
  on public.github_sync_runs (github_repository_id, created_at desc);

create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  canonical_title text not null check (btrim(canonical_title) <> ''),
  normalized_title text not null unique check (btrim(normalized_title) <> ''),
  leetcode_slug text check (
    leetcode_slug is null or leetcode_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  leetcode_number integer check (leetcode_number is null or leetcode_number > 0),
  difficulty public.question_difficulty,
  topics text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index interview_questions_leetcode_slug_idx
  on public.interview_questions (leetcode_slug) where leetcode_slug is not null;
create unique index interview_questions_leetcode_number_idx
  on public.interview_questions (leetcode_number) where leetcode_number is not null;

create table public.company_interview_questions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  interview_question_id uuid not null references public.interview_questions(id) on delete cascade,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  observation_count integer not null default 1 check (observation_count > 0),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  role_family public.role_family,
  interview_stage text check (interview_stage is null or btrim(interview_stage) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, interview_question_id),
  check (last_seen_at >= first_seen_at)
);

create index company_interview_questions_company_rank_idx
  on public.company_interview_questions (
    company_id, observation_count desc, last_seen_at desc, id
  );

create table public.interview_question_observations (
  id uuid primary key default gen_random_uuid(),
  company_interview_question_id uuid not null
    references public.company_interview_questions(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  github_repository_id uuid references public.github_repositories(id) on delete set null,
  source_url text not null check (source_url ~ '^https://'),
  source_path text not null check (btrim(source_path) <> ''),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  observed_at timestamptz not null default now(),
  raw_title text not null check (btrim(raw_title) <> ''),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$')
);

create index interview_question_observations_association_idx
  on public.interview_question_observations (
    company_interview_question_id, observed_at desc, id desc
  );
create index interview_question_observations_repository_idx
  on public.interview_question_observations (
    github_repository_id, commit_sha, source_path
  ) where github_repository_id is not null;

create table public.unresolved_github_observations (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  github_repository_id uuid not null references public.github_repositories(id) on delete cascade,
  source_url text not null check (source_url ~ '^https://'),
  source_path text not null check (btrim(source_path) <> ''),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  record_type text not null check (record_type in ('INTERVIEW_QUESTION', 'JOB')),
  raw_company_name text,
  raw_title text,
  reason text not null check (btrim(reason) <> ''),
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$')
);

create index unresolved_github_observations_repository_idx
  on public.unresolved_github_observations (
    github_repository_id, observed_at desc, id desc
  );

create view public.company_interview_question_analytics as
select
  ciq.id as company_interview_question_id,
  ciq.company_id,
  iq.id as interview_question_id,
  iq.canonical_title,
  iq.normalized_title,
  iq.leetcode_slug,
  iq.leetcode_number,
  iq.difficulty,
  iq.topics,
  ciq.role_family,
  ciq.interview_stage,
  ciq.confidence,
  count(iqo.id)::integer as observation_count,
  count(distinct iqo.source_id)::integer as source_count,
  min(iqo.observed_at) as first_observed_at,
  max(iqo.observed_at) as last_observed_at
from public.company_interview_questions ciq
join public.interview_questions iq on iq.id = ciq.interview_question_id
left join public.interview_question_observations iqo
  on iqo.company_interview_question_id = ciq.id
group by ciq.id, iq.id;

alter table public.recruiting_events
  add column github_repository_id uuid
    references public.github_repositories(id) on delete set null,
  add column interview_question_id uuid
    references public.interview_questions(id) on delete set null;

create index recruiting_events_github_repository_idx
  on public.recruiting_events (github_repository_id, occurred_at desc, id desc)
  where github_repository_id is not null;
create index recruiting_events_interview_question_idx
  on public.recruiting_events (interview_question_id, occurred_at desc, id desc)
  where interview_question_id is not null;

create trigger github_repositories_set_updated_at
before update on public.github_repositories
for each row execute function public.set_updated_at();

create trigger github_repository_company_links_set_updated_at
before update on public.github_repository_company_links
for each row execute function public.set_updated_at();

create trigger interview_questions_set_updated_at
before update on public.interview_questions
for each row execute function public.set_updated_at();

create trigger company_interview_questions_set_updated_at
before update on public.company_interview_questions
for each row execute function public.set_updated_at();

comment on table public.github_repositories is
  'Current GitHub repository sync state. Repository contents remain untrusted input.';
comment on table public.interview_question_observations is
  'Commit-specific question provenance. Fingerprints make retry writes idempotent.';
comment on table public.unresolved_github_observations is
  'GitHub records retained when deterministic company/question resolution is not safe.';
comment on view public.company_interview_question_analytics is
  'Stable backend projection for deterministic question counts, recency, and provenance.';
