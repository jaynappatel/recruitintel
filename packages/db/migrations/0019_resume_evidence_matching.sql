-- Milestone 11: private resume evidence and deterministic exact-job matching.
create type public.resume_document_status as enum ('PENDING', 'READY', 'FAILED', 'DELETED');
create type public.resume_parse_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABSTAINED');
create type public.evidence_source as enum ('DETERMINISTIC_PARSE', 'USER_CONFIRMED', 'USER_CORRECTED', 'GITHUB_CONSENTED', 'MODEL_PROPOSAL');
create type public.evidence_review_status as enum ('EXTRACTED', 'CONFIRMED', 'REJECTED', 'SUPERSEDED', 'UNKNOWN');
create type public.match_eligibility as enum ('ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN');
create type public.match_relation as enum ('SATISFIES', 'PARTIAL', 'MISSING', 'UNKNOWN', 'CONFLICT');

create table public.resume_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  storage_object_key text not null check (btrim(storage_object_key) <> '' and length(storage_object_key) <= 500),
  original_filename text not null check (length(original_filename) between 1 and 255),
  media_type text not null check (media_type in ('application/pdf', 'text/plain')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count is null or page_count between 1 and 50),
  status public.resume_document_status not null default 'PENDING',
  failure_code text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  unique (user_id, content_hash)
);
create index resume_documents_user_idx on public.resume_documents (user_id, created_at desc, id desc);

create table public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  parser_version smallint not null default 1 check (parser_version > 0),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (id, user_id),
  unique (user_id, document_id, version_number),
  foreign key (document_id, user_id) references public.resume_documents(id, user_id) on delete cascade
);
create index resume_versions_user_idx on public.resume_versions (user_id, created_at desc, id desc);

create table public.resume_parse_runs (
  id uuid primary key default gen_random_uuid(),
  resume_version_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  status public.resume_parse_status not null default 'QUEUED',
  parser_version smallint not null check (parser_version > 0),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  error_code text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, resume_version_id, idempotency_key),
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete cascade
);
create index resume_parse_runs_version_idx on public.resume_parse_runs (user_id, resume_version_id, created_at desc);

create table public.candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  resume_version_id uuid,
  evidence_type text not null check (btrim(evidence_type) <> '' and length(evidence_type) <= 60),
  normalized_value jsonb not null check (jsonb_typeof(normalized_value) = 'object'),
  source public.evidence_source not null,
  review_status public.evidence_review_status not null default 'EXTRACTED',
  page_number integer check (page_number is null or page_number between 1 and 50),
  section text check (section is null or length(section) <= 100),
  source_span text check (source_span is null or length(source_span) <= 500),
  parser_version smallint not null default 1 check (parser_version > 0),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (id, user_id),
  unique (user_id, evidence_hash),
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete cascade
);
create index candidate_evidence_user_idx on public.candidate_evidence (user_id, review_status, evidence_type, id);

create table public.evidence_confirmations (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  disposition public.evidence_review_status not null check (disposition in ('CONFIRMED', 'REJECTED', 'SUPERSEDED')),
  replacement_evidence_id uuid,
  reason_code text check (reason_code is null or length(reason_code) <= 100),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (evidence_id, user_id) references public.candidate_evidence(id, user_id) on delete cascade,
  foreign key (replacement_evidence_id, user_id) references public.candidate_evidence(id, user_id) on delete set null
);
create index evidence_confirmations_user_idx on public.evidence_confirmations (user_id, created_at desc);

create table public.role_rubrics (
  id uuid primary key default gen_random_uuid(),
  role_family text not null,
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  algorithm_version text not null,
  created_at timestamptz not null default now(),
  unique (role_family, version)
);

create table public.job_requirement_sets (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.job_opportunities(id) on delete restrict,
  version integer not null check (version > 0),
  requirements jsonb not null check (jsonb_typeof(requirements) = 'object'),
  source_version text not null,
  algorithm_version text not null,
  created_at timestamptz not null default now(),
  unique (opportunity_id, version)
);
create index job_requirement_sets_opportunity_idx on public.job_requirement_sets (opportunity_id, version desc);

create table public.resume_job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  resume_version_id uuid not null,
  opportunity_id uuid not null references public.job_opportunities(id) on delete restrict,
  requirement_set_id uuid not null references public.job_requirement_sets(id) on delete restrict,
  eligibility public.match_eligibility not null,
  score numeric check (score is null or score between 0 and 100),
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  algorithm_version text not null,
  generated_at timestamptz not null default now(),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  unique (id, user_id),
  unique (user_id, resume_version_id, opportunity_id, requirement_set_id, algorithm_version),
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete cascade
);
create index resume_job_matches_user_idx on public.resume_job_matches (user_id, generated_at desc, id desc);
create index resume_job_matches_opportunity_idx on public.resume_job_matches (opportunity_id, generated_at desc, id);

create table public.match_evidence (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  requirement_key text not null,
  relation public.match_relation not null,
  evidence_id uuid,
  reason_code text not null,
  citation jsonb not null default '{}'::jsonb check (jsonb_typeof(citation) = 'object'),
  unique (id, user_id),
  unique (match_id, requirement_key),
  foreign key (match_id, user_id) references public.resume_job_matches(id, user_id) on delete cascade,
  foreign key (evidence_id, user_id) references public.candidate_evidence(id, user_id) on delete set null
);
create index match_evidence_match_idx on public.match_evidence (match_id, relation, id);

alter table public.applications add column resume_version_id uuid;
alter table public.applications add constraint applications_resume_version_owner_fkey
  foreign key (resume_version_id, user_id) references public.resume_versions(id, user_id) on delete set null;
create index applications_resume_version_idx on public.applications (user_id, resume_version_id)
  where resume_version_id is not null;
