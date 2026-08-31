-- Milestone 8: additive canonical opportunity graph.
-- `jobs` remain immutable-identity, provenance-bearing source postings. Canonical
-- opportunities are a projection over temporal memberships; no source row is renamed,
-- replaced, or deleted by this migration.

create type public.job_opportunity_status as enum ('ACTIVE', 'SUPERSEDED');
create type public.opportunity_lifecycle_status as enum ('OPEN', 'CLOSED', 'UNKNOWN');
create type public.opportunity_resolution_outcome as enum (
  'MATCH', 'NO_MATCH', 'REVIEW_REQUIRED'
);
create type public.opportunity_resolution_action as enum (
  'INITIAL_SINGLETON', 'AUTO_RESOLUTION', 'MANUAL_MERGE', 'MANUAL_SPLIT',
  'MANUAL_NO_MATCH', 'DERIVATION_RECOMPUTED'
);
create type public.opportunity_decision_source as enum ('MIGRATION', 'SYSTEM', 'MANUAL');
create type public.opportunity_membership_method as enum (
  'SINGLETON', 'PROVIDER_NATIVE_ID', 'OFFICIAL_APPLICATION_URL',
  'EXPLICIT_OFFICIAL_CROSS_REFERENCE', 'MANUAL_MERGE', 'MANUAL_SPLIT'
);
create type public.opportunity_review_status as enum ('PENDING', 'RESOLVED', 'DISMISSED');
create type public.job_identity_key_type as enum (
  'PROVIDER_NATIVE_ID', 'OFFICIAL_APPLICATION_URL', 'EXPLICIT_OFFICIAL_CROSS_REFERENCE'
);
create type public.source_job_authority as enum (
  'UNREVIEWED', 'COMMUNITY', 'REVIEWED_DIRECT', 'OFFICIAL_COMPANY', 'OFFICIAL_ATS'
);
create type public.source_listing_coverage as enum (
  'UNKNOWN', 'ITEM_ONLY', 'PARTIAL', 'COMPLETE'
);
create type public.workplace_mode as enum ('REMOTE', 'HYBRID', 'ONSITE', 'MIXED', 'UNKNOWN');
create type public.job_skill_requirement as enum ('REQUIRED', 'PREFERRED', 'MENTIONED');
create type public.job_constraint_type as enum (
  'SPONSORSHIP_AVAILABLE', 'SPONSORSHIP_UNAVAILABLE', 'CITIZENSHIP_REQUIRED',
  'WORK_AUTHORIZATION_REQUIRED', 'GRADUATION_ELIGIBILITY'
);
create type public.job_requirement_type as enum (
  'YEARS_EXPERIENCE', 'EDUCATION', 'DEGREE_FIELD', 'GRADUATION_YEAR', 'OTHER'
);
create type public.compensation_interval as enum ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR', 'OTHER');
create type public.job_derivation_event_type as enum (
  'BASELINE_MIGRATED', 'DERIVATION_RECOMPUTED', 'SOURCE_HASH_RECOMPUTED'
);

-- `content_hash` remains as a compatibility alias for source content. New writers use
-- the explicitly named columns and never include classifier output in the source hash.
alter table public.jobs
  add column source_content_hash text,
  add column source_content_version smallint,
  add column derivation_hash text,
  add column derivation_version smallint;

update public.jobs set
  source_content_hash = content_hash,
  source_content_version = fingerprint_version,
  derivation_hash = encode(digest(
    concat_ws(E'\x1f',
      role_family::text, experience_level::text, employment_type::text,
      is_internship::text, is_new_grad::text, coalesce(season, ''),
      array_to_string(graduation_years, ','), classification_version::text
    ), 'sha256'
  ), 'hex'),
  derivation_version = classification_version;

alter table public.jobs
  alter column source_content_hash set not null,
  alter column source_content_version set not null,
  alter column derivation_hash set not null,
  alter column derivation_version set not null,
  add constraint jobs_source_content_hash_check
    check (source_content_hash ~ '^[0-9a-f]{64}$'),
  add constraint jobs_source_content_version_check check (source_content_version > 0),
  add constraint jobs_derivation_hash_check check (derivation_hash ~ '^[0-9a-f]{64}$'),
  add constraint jobs_derivation_version_check check (derivation_version > 0),
  add constraint jobs_id_company_unique unique (id, company_id);

comment on column public.jobs.content_hash is
  'Compatibility alias for source_content_hash. Excludes derived classification beginning with source hash v2.';
comment on column public.jobs.derivation_hash is
  'Hash of versioned parser/classifier output. A derivation-only change is not a source change.';

create table public.job_opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  origin_job_id uuid not null unique references public.jobs(id) on delete restrict,
  canonical_source_posting_id uuid references public.jobs(id) on delete set null,
  status public.job_opportunity_status not null default 'ACTIVE',
  superseded_by_id uuid references public.job_opportunities(id) on delete restrict,
  normalized_title text not null check (btrim(normalized_title) <> ''),
  title_block text not null check (btrim(title_block) <> ''),
  role_family public.role_family not null default 'OTHER',
  experience_level public.experience_level not null default 'UNKNOWN',
  employment_type public.employment_type not null default 'UNKNOWN',
  is_internship boolean not null default false,
  is_new_grad boolean not null default false,
  season text,
  graduation_years integer[] not null default '{}',
  location_summary text not null default '',
  workplace_mode public.workplace_mode not null default 'UNKNOWN',
  canonical_application_url text check (
    canonical_application_url is null or canonical_application_url ~ '^https://'
  ),
  earliest_first_seen_at timestamptz not null,
  latest_last_seen_at timestamptz not null,
  published_at timestamptz,
  deadline_at timestamptz,
  lifecycle_status public.opportunity_lifecycle_status not null default 'UNKNOWN',
  lifecycle_evaluated_at timestamptz,
  lifecycle_reason jsonb not null default '{}'::jsonb check (
    jsonb_typeof(lifecycle_reason) = 'object'
    and not lifecycle_reason ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'raw_payload', 'raw_html'
    ]
  ),
  merge_confidence numeric(4, 3) not null default 1.000 check (merge_confidence between 0 and 1),
  canonicalization_version smallint not null default 1 check (canonicalization_version > 0),
  projection_version smallint not null default 1 check (projection_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  check (
    (status = 'ACTIVE' and superseded_by_id is null)
    or (status = 'SUPERSEDED' and superseded_by_id is not null and superseded_by_id <> id)
  ),
  check (latest_last_seen_at >= earliest_first_seen_at),
  check (not is_internship or experience_level = 'INTERNSHIP')
);

alter table public.job_opportunities
  add constraint job_opportunities_canonical_posting_company_fkey
  foreign key (canonical_source_posting_id, company_id)
  references public.jobs(id, company_id) on delete restrict;

create index job_opportunities_company_active_idx
  on public.job_opportunities (company_id, lifecycle_status, latest_last_seen_at desc, id)
  where status = 'ACTIVE';
create index job_opportunities_open_role_idx
  on public.job_opportunities (role_family, is_internship, is_new_grad, latest_last_seen_at desc, id)
  where status = 'ACTIVE' and lifecycle_status = 'OPEN';
create index job_opportunities_title_block_idx
  on public.job_opportunities (company_id, title_block, id) where status = 'ACTIVE';
create index job_opportunities_deadline_idx
  on public.job_opportunities (deadline_at, id)
  where status = 'ACTIVE' and deadline_at is not null;

create table public.job_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subject_job_id uuid references public.jobs(id) on delete restrict,
  from_opportunity_id uuid references public.job_opportunities(id) on delete restrict,
  to_opportunity_id uuid references public.job_opportunities(id) on delete restrict,
  action public.opportunity_resolution_action not null,
  outcome public.opportunity_resolution_outcome not null,
  decision_source public.opportunity_decision_source not null,
  algorithm_version smallint not null default 1 check (algorithm_version > 0),
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
    and not evidence ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'raw_payload', 'raw_html'
    ]
  ),
  manual_reason text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  actor_kind public.actor_kind not null default 'SYSTEM',
  actor_user_id uuid references public.users(id) on delete set null,
  actor_service_principal_id uuid references public.service_principals(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (decision_source, idempotency_key),
  check (
    decision_source <> 'MANUAL'
    or (btrim(manual_reason) <> '' and actor_kind in ('USER', 'ADMIN'))
  ),
  check (
    (actor_kind in ('USER', 'ADMIN') and actor_user_id is not null)
    or (actor_kind = 'SERVICE' and actor_service_principal_id is not null)
    or actor_kind = 'SYSTEM'
  )
);
create index job_resolution_decisions_job_idx
  on public.job_resolution_decisions (subject_job_id, created_at desc, id);
create index job_resolution_decisions_opportunities_idx
  on public.job_resolution_decisions (from_opportunity_id, to_opportunity_id, created_at desc);

create table public.job_opportunity_postings (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  job_id uuid not null,
  company_id uuid not null,
  decision_id uuid not null references public.job_resolution_decisions(id) on delete restrict,
  membership_method public.opportunity_membership_method not null,
  pinned boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  foreign key (opportunity_id, company_id)
    references public.job_opportunities(id, company_id) on delete restrict,
  foreign key (job_id, company_id)
    references public.jobs(id, company_id) on delete cascade,
  check (valid_to is null or valid_to >= valid_from)
);
create unique index job_opportunity_postings_one_active_job_idx
  on public.job_opportunity_postings (job_id) where valid_to is null;
create unique index job_opportunity_postings_one_active_pair_idx
  on public.job_opportunity_postings (opportunity_id, job_id) where valid_to is null;
create index job_opportunity_postings_active_opportunity_idx
  on public.job_opportunity_postings (opportunity_id, job_id) where valid_to is null;

create table public.job_identity_keys (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  company_id uuid not null,
  key_type public.job_identity_key_type not null,
  provider text check (provider is null or provider ~ '^[a-z0-9_-]+$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  safe_value_hint text check (safe_value_hint is null or length(safe_value_hint) <= 200),
  validator_version smallint not null default 1 check (validator_version > 0),
  validated boolean not null default false,
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
    and not evidence ?| array['authorization', 'cookie', 'access_token', 'refresh_token']
  ),
  created_at timestamptz not null default now(),
  foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  unique (job_id, key_type, key_hash, validator_version)
);
create index job_identity_keys_match_idx
  on public.job_identity_keys (company_id, key_type, key_hash, job_id)
  where validated;

create table public.job_resolution_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  left_job_id uuid not null references public.jobs(id) on delete restrict,
  right_job_id uuid not null references public.jobs(id) on delete restrict,
  status public.opportunity_review_status not null default 'PENDING',
  algorithm_version smallint not null check (algorithm_version > 0),
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  resolution_decision_id uuid references public.job_resolution_decisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (left_job_id < right_job_id),
  check (
    (status = 'PENDING' and resolved_at is null and resolution_decision_id is null)
    or (status <> 'PENDING' and resolved_at is not null and resolution_decision_id is not null)
  )
);
create unique index job_resolution_reviews_pending_pair_idx
  on public.job_resolution_reviews (left_job_id, right_job_id, algorithm_version)
  where status = 'PENDING';
create index job_resolution_reviews_queue_idx
  on public.job_resolution_reviews (status, created_at, id);

-- Authority is an explicit, reviewed capability record. No existing provider is promoted by
-- this migration; operators/tests must populate reviewed capability fields deliberately.
create table public.source_job_capabilities (
  source_id uuid primary key references public.sources(id) on delete cascade,
  source_policy_id uuid not null references public.source_policies(id) on delete restrict,
  authority public.source_job_authority not null default 'UNREVIEWED',
  capability_version smallint not null default 1 check (capability_version > 0),
  reviewed boolean not null default false,
  reviewed_at timestamptz,
  reviewed_by text,
  supports_posting_status boolean not null default false,
  supports_complete_listing boolean not null default false,
  absence_can_close boolean not null default false,
  freshness_seconds integer not null default 86400 check (freshness_seconds between 300 and 2592000),
  validated_application_hosts text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (reviewed and reviewed_at is not null and btrim(reviewed_by) <> '')
    or (not reviewed and reviewed_at is null and reviewed_by is null
      and authority = 'UNREVIEWED' and not absence_can_close)
  ),
  check (not absence_can_close or (reviewed and supports_complete_listing))
);

insert into public.source_job_capabilities (source_id, source_policy_id)
select source.id, source.source_policy_id
from public.sources source where source.source_policy_id is not null
on conflict (source_id) do nothing;

create function public.initialize_source_job_capability()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.source_policy_id is not null then
    insert into public.source_job_capabilities (source_id, source_policy_id)
    values (new.id, new.source_policy_id)
    on conflict (source_id) do update set
      source_policy_id = excluded.source_policy_id,
      authority = case
        when public.source_job_capabilities.source_policy_id = excluded.source_policy_id
          then public.source_job_capabilities.authority
        else 'UNREVIEWED'::public.source_job_authority
      end,
      reviewed = case
        when public.source_job_capabilities.source_policy_id = excluded.source_policy_id
          then public.source_job_capabilities.reviewed
        else false
      end,
      reviewed_at = case
        when public.source_job_capabilities.source_policy_id = excluded.source_policy_id
          then public.source_job_capabilities.reviewed_at
        else null
      end,
      reviewed_by = case
        when public.source_job_capabilities.source_policy_id = excluded.source_policy_id
          then public.source_job_capabilities.reviewed_by
        else null
      end,
      absence_can_close = case
        when public.source_job_capabilities.source_policy_id = excluded.source_policy_id
          then public.source_job_capabilities.absence_can_close
        else false
      end;
  end if;
  return new;
end;
$$;
create trigger sources_initialize_job_capability
after insert or update of source_policy_id on public.sources
for each row execute function public.initialize_source_job_capability();

create table public.source_collection_evidence (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  collector_run_id uuid references public.collector_runs(id) on delete restrict,
  coverage public.source_listing_coverage not null,
  successful boolean not null,
  absence_evidence_valid boolean not null default false,
  capability_version smallint not null check (capability_version > 0),
  observed_at timestamptz not null default now(),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  safe_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_metadata) = 'object'
    and not safe_metadata ?| array['authorization', 'cookie', 'access_token', 'refresh_token']
  ),
  check (not absence_evidence_valid or (successful and coverage = 'COMPLETE'))
);
create index source_collection_evidence_source_idx
  on public.source_collection_evidence (source_id, observed_at desc, id);

create table public.job_opportunity_lifecycle_evidence (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  collection_evidence_id uuid references public.source_collection_evidence(id) on delete restrict,
  observed_state public.opportunity_lifecycle_status not null,
  authoritative boolean not null,
  capability_version smallint not null check (capability_version > 0),
  observed_at timestamptz not null,
  reason_code text not null check (btrim(reason_code) <> ''),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index job_opportunity_lifecycle_evidence_opportunity_idx
  on public.job_opportunity_lifecycle_evidence (opportunity_id, observed_at desc, id);

create table public.job_derivation_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  event_type public.job_derivation_event_type not null,
  previous_derivation_hash text check (
    previous_derivation_hash is null or previous_derivation_hash ~ '^[0-9a-f]{64}$'
  ),
  derivation_hash text not null check (derivation_hash ~ '^[0-9a-f]{64}$'),
  derivation_version smallint not null check (derivation_version > 0),
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  reason_code text not null check (btrim(reason_code) <> ''),
  created_at timestamptz not null default now(),
  unique (job_id, event_type, derivation_hash, derivation_version)
);

insert into public.job_derivation_events (
  job_id, event_type, derivation_hash, derivation_version, source_content_hash, reason_code
)
select id, 'BASELINE_MIGRATED', derivation_hash, derivation_version,
  source_content_hash, 'M8_HASH_DOMAIN_SEPARATION'
from public.jobs on conflict do nothing;

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique check (btrim(canonical_name) <> ''),
  normalized_name text not null unique check (btrim(normalized_name) <> ''),
  created_at timestamptz not null default now()
);
create table public.skill_aliases (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null unique check (btrim(normalized_alias) <> ''),
  created_at timestamptz not null default now()
);

insert into public.skills (canonical_name, normalized_name) values
  ('JavaScript', 'javascript'), ('TypeScript', 'typescript'), ('PostgreSQL', 'postgresql'),
  ('React', 'react'), ('Python', 'python'), ('Java', 'java'), ('C++', 'c++'),
  ('SQL', 'sql'), ('AWS', 'aws')
on conflict do nothing;
insert into public.skill_aliases (skill_id, alias, normalized_alias)
select skill.id, alias.alias, alias.normalized_alias
from (values
  ('JavaScript', 'JS', 'js'), ('TypeScript', 'TS', 'ts'),
  ('PostgreSQL', 'Postgres', 'postgres'), ('React', 'React.js', 'react.js'),
  ('C++', 'CPP', 'cpp'), ('AWS', 'Amazon Web Services', 'amazon web services')
) as alias(canonical_name, alias, normalized_alias)
join public.skills skill on skill.canonical_name = alias.canonical_name
on conflict do nothing;

create table public.job_structured_derivations (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  parser_version smallint not null check (parser_version > 0),
  derivation_hash text not null check (derivation_hash ~ '^[0-9a-f]{64}$'),
  parsed_at timestamptz not null default now(),
  evidence_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_summary) = 'object')
);
create table public.job_locations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  raw_location text not null check (btrim(raw_location) <> ''),
  city text,
  region text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  remote_region text,
  workplace_mode public.workplace_mode not null default 'UNKNOWN',
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint)
);
create index job_locations_filter_idx
  on public.job_locations (country_code, region, city, workplace_mode, job_id);
create table public.job_skills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  skill_id uuid references public.skills(id) on delete restrict,
  raw_mention text not null check (btrim(raw_mention) <> '' and length(raw_mention) <= 200),
  requirement public.job_skill_requirement not null,
  explicit boolean not null default true,
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint)
);
create index job_skills_skill_idx on public.job_skills (skill_id, requirement, job_id);
create table public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  requirement_type public.job_requirement_type not null,
  normalized_value jsonb not null check (jsonb_typeof(normalized_value) = 'object'),
  raw_evidence text not null check (btrim(raw_evidence) <> '' and length(raw_evidence) <= 1000),
  explicit boolean not null default true,
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint)
);
create table public.job_constraints (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  constraint_type public.job_constraint_type not null,
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  raw_evidence text not null check (btrim(raw_evidence) <> '' and length(raw_evidence) <= 1000),
  explicit boolean not null default true check (explicit),
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint)
);
create table public.job_compensation (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  minimum_amount numeric check (minimum_amount is null or minimum_amount >= 0),
  maximum_amount numeric check (maximum_amount is null or maximum_amount >= 0),
  interval public.compensation_interval not null,
  raw_evidence text not null check (btrim(raw_evidence) <> '' and length(raw_evidence) <= 1000),
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint),
  check (minimum_amount is null or maximum_amount is null or minimum_amount <= maximum_amount)
);
create table public.job_application_deadlines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  deadline_at timestamptz not null,
  explicit boolean not null default true check (explicit),
  source_field text not null check (btrim(source_field) <> ''),
  parser_version smallint not null check (parser_version > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, evidence_fingerprint)
);
create index job_application_deadlines_at_idx
  on public.job_application_deadlines (deadline_at, job_id);

-- Private M5/M6 references remain untouched. New opportunity targets are optional and
-- explicitly chosen; merge/split code never updates these columns.
alter table public.recruiting_dates
  add column opportunity_id uuid references public.job_opportunities(id) on delete set null;
alter table public.application_plans
  add column opportunity_id uuid references public.job_opportunities(id) on delete set null;
alter table public.calendar_items
  add column opportunity_id uuid references public.job_opportunities(id) on delete set null;
create index recruiting_dates_opportunity_idx on public.recruiting_dates (opportunity_id)
  where opportunity_id is not null;
create index application_plans_user_opportunity_idx
  on public.application_plans (user_id, opportunity_id) where opportunity_id is not null;
create index calendar_items_user_opportunity_idx
  on public.calendar_items (user_id, opportunity_id) where opportunity_id is not null;

-- One singleton is created in the same transaction as every new source posting. The trigger
-- does not attempt cross-source matching, so a failed resolver can never hide a new posting.
create function public.normalize_opportunity_title(value text)
returns text language sql immutable strict as $$
  select lower(btrim(regexp_replace(value, '[^[:alnum:]+#.-]+', ' ', 'g')))
$$;

create function public.opportunity_title_block(value text)
returns text language sql immutable strict as $$
  select left(public.normalize_opportunity_title(value), 120)
$$;

-- Compatibility for seeds and older source-posting writers during an atomic deploy. New M8
-- writers provide both hash domains explicitly; this trigger prevents a transient NOT NULL
-- failure without classifying an old writer's content hash as a derivation hash.
create function public.initialize_job_hash_domains()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.source_content_hash is null then
    new.source_content_hash := new.content_hash;
    new.source_content_version := coalesce(new.source_content_version, new.fingerprint_version);
  end if;
  if new.derivation_hash is null then
    new.derivation_hash := encode(digest(
      concat_ws(E'\x1f',
        new.role_family::text, new.experience_level::text, new.employment_type::text,
        new.is_internship::text, new.is_new_grad::text, coalesce(new.season, ''),
        array_to_string(new.graduation_years, ','), new.classification_version::text
      ), 'sha256'
    ), 'hex');
    new.derivation_version := coalesce(new.derivation_version, new.classification_version);
  end if;
  return new;
end;
$$;
create trigger jobs_initialize_hash_domains
before insert on public.jobs for each row execute function public.initialize_job_hash_domains();

create function public.create_singleton_opportunity_for_job()
returns trigger language plpgsql set search_path = public as $$
declare
  opportunity_id uuid;
  decision_id uuid;
begin
  insert into public.job_opportunities (
    company_id, origin_job_id, canonical_source_posting_id, normalized_title, title_block,
    role_family, experience_level, employment_type, is_internship, is_new_grad, season,
    graduation_years, location_summary, canonical_application_url,
    earliest_first_seen_at, latest_last_seen_at, published_at, lifecycle_status,
    lifecycle_evaluated_at, lifecycle_reason
  ) values (
    new.company_id, new.id, new.id, public.normalize_opportunity_title(new.title),
    public.opportunity_title_block(new.title), new.role_family, new.experience_level,
    new.employment_type, new.is_internship, new.is_new_grad, new.season,
    new.graduation_years, new.location, new.application_url, new.first_seen_at,
    new.last_seen_at, new.published_at,
    case when new.closed_at is null then 'OPEN'::public.opportunity_lifecycle_status
         else 'UNKNOWN'::public.opportunity_lifecycle_status end,
    now(), jsonb_build_object('rule', 'SINGLETON_SOURCE_POSTING', 'version', 1)
  ) returning id into opportunity_id;

  insert into public.job_resolution_decisions (
    company_id, subject_job_id, to_opportunity_id, action, outcome, decision_source,
    algorithm_version, reason_codes, evidence, idempotency_key, actor_kind
  ) values (
    new.company_id, new.id, opportunity_id, 'INITIAL_SINGLETON', 'MATCH', 'SYSTEM', 1,
    array['NEW_SOURCE_POSTING_SINGLETON'],
    jsonb_build_object('sourceContentHash', new.source_content_hash),
    'singleton:' || new.id::text, 'SYSTEM'
  ) returning id into decision_id;

  insert into public.job_opportunity_postings (
    opportunity_id, job_id, company_id, decision_id, membership_method
  ) values (opportunity_id, new.id, new.company_id, decision_id, 'SINGLETON');
  return new;
end;
$$;

create trigger jobs_create_singleton_opportunity
after insert on public.jobs for each row execute function public.create_singleton_opportunity_for_job();

-- Conservative one-to-one migration. No fuzzy or medium-strength merge runs here.
insert into public.job_opportunities (
  company_id, origin_job_id, canonical_source_posting_id, normalized_title, title_block,
  role_family, experience_level, employment_type, is_internship, is_new_grad, season,
  graduation_years, location_summary, canonical_application_url,
  earliest_first_seen_at, latest_last_seen_at, published_at, lifecycle_status,
  lifecycle_evaluated_at, lifecycle_reason
)
select job.company_id, job.id, job.id, public.normalize_opportunity_title(job.title),
  public.opportunity_title_block(job.title), job.role_family, job.experience_level,
  job.employment_type, job.is_internship, job.is_new_grad, job.season,
  job.graduation_years, job.location, job.application_url, job.first_seen_at,
  job.last_seen_at, job.published_at,
  case when job.closed_at is null then 'OPEN'::public.opportunity_lifecycle_status
       else 'UNKNOWN'::public.opportunity_lifecycle_status end,
  now(), jsonb_build_object('rule', 'MIGRATION_SINGLETON', 'version', 1)
from public.jobs job
where not exists (
  select 1 from public.job_opportunities opportunity where opportunity.origin_job_id = job.id
);

insert into public.job_resolution_decisions (
  company_id, subject_job_id, to_opportunity_id, action, outcome, decision_source,
  algorithm_version, reason_codes, evidence, idempotency_key, actor_kind
)
select job.company_id, job.id, opportunity.id, 'INITIAL_SINGLETON', 'MATCH', 'MIGRATION', 1,
  array['LEGACY_SOURCE_POSTING_SINGLETON'],
  jsonb_build_object('sourceContentHash', job.source_content_hash),
  'singleton:' || job.id::text, 'SYSTEM'
from public.jobs job join public.job_opportunities opportunity on opportunity.origin_job_id = job.id
on conflict (decision_source, idempotency_key) do nothing;

insert into public.job_opportunity_postings (
  opportunity_id, job_id, company_id, decision_id, membership_method
)
select opportunity.id, job.id, job.company_id, decision.id, 'SINGLETON'
from public.jobs job
join public.job_opportunities opportunity on opportunity.origin_job_id = job.id
join public.job_resolution_decisions decision
  on decision.subject_job_id = job.id and decision.to_opportunity_id = opportunity.id
  and decision.action = 'INITIAL_SINGLETON'
where not exists (
  select 1 from public.job_opportunity_postings membership
  where membership.job_id = job.id and membership.valid_to is null
);

create function public.reject_job_resolution_decision_mutation()
returns trigger language plpgsql as $$
begin
  -- Preserve the pre-M8 company deletion contract. Cascading deletion of the entire
  -- company graph is distinct from mutating correction lineage in place.
  if not exists (select 1 from public.companies where id = old.company_id) then
    return old;
  end if;
  raise exception 'job resolution decisions are append-only' using errcode = '55000';
end;
$$;
create trigger job_resolution_decisions_append_only
before update or delete on public.job_resolution_decisions
for each row execute function public.reject_job_resolution_decision_mutation();

create function public.reject_job_membership_delete()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.companies where id = old.company_id) then
    return old;
  end if;
  raise exception 'job opportunity memberships cannot be deleted' using errcode = '55000';
end;
$$;
create trigger job_opportunity_postings_no_delete
before delete on public.job_opportunity_postings
for each row execute function public.reject_job_membership_delete();

create function public.reject_job_membership_identity_mutation()
returns trigger language plpgsql as $$
begin
  if new.opportunity_id is distinct from old.opportunity_id
    or new.job_id is distinct from old.job_id
    or new.company_id is distinct from old.company_id
    or new.decision_id is distinct from old.decision_id
    or new.membership_method is distinct from old.membership_method
    or new.valid_from is distinct from old.valid_from
    or new.created_at is distinct from old.created_at
    or (old.valid_to is not null and new.valid_to is distinct from old.valid_to)
    or (old.pinned and not new.pinned) then
    raise exception 'job opportunity membership history is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger job_opportunity_postings_immutable_identity
before update on public.job_opportunity_postings
for each row execute function public.reject_job_membership_identity_mutation();

create function public.recompute_job_opportunity(target_opportunity_id uuid)
returns public.job_opportunities language plpgsql set search_path = public as $$
declare
  selected_job record;
  computed_lifecycle public.opportunity_lifecycle_status;
  fresh_open_count integer;
  fresh_authoritative_count integer;
  fresh_authoritative_open_count integer;
  authoritative_close_count integer;
  result public.job_opportunities;
begin
  select
    job.*,
    coalesce(capability.authority, 'UNREVIEWED'::public.source_job_authority) as authority,
    coalesce(capability.reviewed, false) as authority_reviewed,
    coalesce(capability.capability_version, 1) as capability_version
  into selected_job
  from public.job_opportunity_postings membership
  join public.jobs job on job.id = membership.job_id
  join public.sources source on source.id = job.source_id
  left join public.source_job_capabilities capability on capability.source_id = source.id
  where membership.opportunity_id = target_opportunity_id and membership.valid_to is null
  order by
    case when capability.reviewed then
      case capability.authority
        when 'OFFICIAL_ATS' then 500
        when 'OFFICIAL_COMPANY' then 400
        when 'REVIEWED_DIRECT' then 300
        when 'COMMUNITY' then 100
        else 0
      end
    else 0 end desc,
    source.reliability desc,
    job.published_at nulls last,
    job.first_seen_at,
    job.id
  limit 1;

  if selected_job.id is null then
    select * into result from public.job_opportunities where id = target_opportunity_id;
    return result;
  end if;

  select
    count(*) filter (
      where job.closed_at is null
        and job.last_seen_at >= now() - make_interval(
          secs => coalesce(capability.freshness_seconds, 86400)
        )
    ),
    count(*) filter (
      where capability.reviewed
        and capability.authority in ('OFFICIAL_ATS', 'OFFICIAL_COMPANY', 'REVIEWED_DIRECT')
        and job.last_seen_at >= now() - make_interval(secs => capability.freshness_seconds)
    ),
    count(*) filter (
      where capability.reviewed
        and capability.authority in ('OFFICIAL_ATS', 'OFFICIAL_COMPANY', 'REVIEWED_DIRECT')
        and job.closed_at is null
        and job.last_seen_at >= now() - make_interval(secs => capability.freshness_seconds)
    ),
    count(*) filter (
      where capability.reviewed
        and capability.authority in ('OFFICIAL_ATS', 'OFFICIAL_COMPANY', 'REVIEWED_DIRECT')
        and job.closed_at is not null
        and job.last_seen_at >= now() - make_interval(secs => capability.freshness_seconds)
        and exists (
          select 1 from public.source_collection_evidence evidence
          where evidence.source_id = job.source_id
            and evidence.successful and evidence.coverage = 'COMPLETE'
            and evidence.absence_evidence_valid
            and evidence.capability_version = capability.capability_version
            and evidence.observed_at >= job.closed_at
        )
    )
  into fresh_open_count, fresh_authoritative_count,
    fresh_authoritative_open_count, authoritative_close_count
  from public.job_opportunity_postings membership
  join public.jobs job on job.id = membership.job_id
  left join public.source_job_capabilities capability on capability.source_id = job.source_id
  where membership.opportunity_id = target_opportunity_id and membership.valid_to is null;

  computed_lifecycle := case
    when fresh_open_count > 0 then 'OPEN'::public.opportunity_lifecycle_status
    when fresh_authoritative_count > 0
      and fresh_authoritative_open_count = 0
      and authoritative_close_count = fresh_authoritative_count
      then 'CLOSED'::public.opportunity_lifecycle_status
    else 'UNKNOWN'::public.opportunity_lifecycle_status
  end;

  insert into public.job_opportunity_lifecycle_evidence (
    opportunity_id, job_id, source_id, collection_evidence_id, observed_state,
    authoritative, capability_version, observed_at, reason_code, fingerprint
  )
  select target_opportunity_id, job.id, job.source_id,
    case when job.closed_at is null then null else (
      select evidence.id from public.source_collection_evidence evidence
      where evidence.source_id = job.source_id and evidence.successful
        and evidence.coverage = 'COMPLETE' and evidence.absence_evidence_valid
        and evidence.observed_at >= job.closed_at
      order by evidence.observed_at desc, evidence.id desc limit 1
    ) end,
    case
      when job.last_seen_at < now() - make_interval(
        secs => coalesce(capability.freshness_seconds, 86400)
      ) then 'UNKNOWN'::public.opportunity_lifecycle_status
      when job.closed_at is null then 'OPEN'::public.opportunity_lifecycle_status
      else 'CLOSED'::public.opportunity_lifecycle_status
    end,
    coalesce(capability.reviewed, false) and capability.authority in (
      'OFFICIAL_ATS', 'OFFICIAL_COMPANY', 'REVIEWED_DIRECT'
    ),
    coalesce(capability.capability_version, 1), job.last_seen_at,
    case
      when job.last_seen_at < now() - make_interval(
        secs => coalesce(capability.freshness_seconds, 86400)
      ) then 'STALE_SOURCE_EVIDENCE'
      when job.closed_at is null then 'SOURCE_POSTING_OPEN'
      when coalesce(capability.reviewed, false) then 'SOURCE_POSTING_CLOSED'
      else 'WEAK_SOURCE_CLOSED'
    end,
    encode(digest(
      target_opportunity_id::text || ':' || job.id::text || ':' ||
      job.source_content_hash || ':' || coalesce(job.closed_at::text, 'open') || ':' ||
      coalesce(capability.capability_version, 1)::text,
      'sha256'
    ), 'hex')
  from public.job_opportunity_postings membership
  join public.jobs job on job.id = membership.job_id
  left join public.source_job_capabilities capability on capability.source_id = job.source_id
  where membership.opportunity_id = target_opportunity_id and membership.valid_to is null
  on conflict (fingerprint) do nothing;

  update public.job_opportunities opportunity set
    canonical_source_posting_id = selected_job.id,
    normalized_title = public.normalize_opportunity_title(selected_job.title),
    title_block = public.opportunity_title_block(selected_job.title),
    role_family = selected_job.role_family,
    experience_level = selected_job.experience_level,
    employment_type = selected_job.employment_type,
    is_internship = selected_job.is_internship,
    is_new_grad = selected_job.is_new_grad,
    season = selected_job.season,
    graduation_years = selected_job.graduation_years,
    location_summary = selected_job.location,
    canonical_application_url = selected_job.application_url,
    earliest_first_seen_at = aggregate.earliest_seen,
    latest_last_seen_at = aggregate.latest_seen,
    published_at = aggregate.earliest_published,
    deadline_at = aggregate.earliest_deadline,
    lifecycle_status = computed_lifecycle,
    lifecycle_evaluated_at = now(),
    lifecycle_reason = jsonb_build_object(
      'rule', 'CONSERVATIVE_AUTHORITY_V1',
      'freshOpenSources', fresh_open_count,
      'freshAuthoritativeSources', fresh_authoritative_count,
      'freshAuthoritativeOpenSources', fresh_authoritative_open_count,
      'authoritativeCompleteClosures', authoritative_close_count
    ),
    projection_version = 1
  from (
    select min(job.first_seen_at) earliest_seen, max(job.last_seen_at) latest_seen,
      min(job.published_at) earliest_published, min(deadline.deadline_at) earliest_deadline
    from public.job_opportunity_postings membership
    join public.jobs job on job.id = membership.job_id
    left join public.job_application_deadlines deadline on deadline.job_id = job.id
    where membership.opportunity_id = target_opportunity_id and membership.valid_to is null
  ) aggregate
  where opportunity.id = target_opportunity_id
  returning opportunity.* into result;
  return result;
end;
$$;

create function public.validate_private_opportunity_company()
returns trigger language plpgsql set search_path = public as $$
declare expected_company uuid;
begin
  if new.opportunity_id is null then return new; end if;
  -- Company deletion can SET NULL on a private row's company/job/opportunity FKs in
  -- separate internal trigger steps. Allow that existing cascade to complete.
  if new.company_id is null and old.company_id is not null
    and not exists (select 1 from public.companies where id = old.company_id) then
    return new;
  end if;
  select company_id into expected_company from public.job_opportunities
  where id = new.opportunity_id;
  if expected_company is null then raise exception 'OPPORTUNITY_NOT_FOUND' using errcode = '23503'; end if;
  if new.company_id is null or new.company_id <> expected_company then
    raise exception 'OPPORTUNITY_COMPANY_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger recruiting_dates_opportunity_company_guard
before insert or update of opportunity_id, company_id on public.recruiting_dates
for each row execute function public.validate_private_opportunity_company();
create trigger application_plans_opportunity_company_guard
before insert or update of opportunity_id, company_id on public.application_plans
for each row execute function public.validate_private_opportunity_company();
create trigger calendar_items_opportunity_company_guard
before insert or update of opportunity_id, company_id on public.calendar_items
for each row execute function public.validate_private_opportunity_company();

create trigger job_opportunities_set_updated_at
before update on public.job_opportunities for each row execute function public.set_updated_at();
create trigger source_job_capabilities_set_updated_at
before update on public.source_job_capabilities for each row execute function public.set_updated_at();

-- M8 instrumentation is defined now but emitted only by real opportunity/source actions.
alter type public.product_event_type add value 'OPPORTUNITY_VIEWED';
alter type public.product_event_type add value 'SOURCE_POSTING_SELECTED';
alter type public.product_event_type add value 'OPPORTUNITY_MERGED';
alter type public.product_event_type add value 'OPPORTUNITY_SPLIT';

comment on table public.job_opportunities is
  'Canonical, recomputable user-facing opportunity projection. Source evidence remains in jobs.';
comment on table public.job_opportunity_postings is
  'Temporal, non-deleting source-posting membership. Exactly one active membership exists per job.';
comment on table public.job_resolution_decisions is
  'Append-only, versioned resolution and manual correction lineage.';
comment on table public.source_job_capabilities is
  'Reviewed, versioned source authority and completeness; defaults fail closed to UNREVIEWED.';

grant select, insert, update on table
  public.job_opportunities, public.job_opportunity_postings,
  public.job_resolution_decisions, public.job_resolution_reviews,
  public.job_identity_keys, public.source_job_capabilities,
  public.source_collection_evidence, public.job_opportunity_lifecycle_evidence,
  public.job_derivation_events, public.job_structured_derivations,
  public.job_locations, public.job_skills, public.job_requirements,
  public.job_constraints, public.job_compensation, public.job_application_deadlines
to recruitintel_worker_global;

grant select on table public.skills, public.skill_aliases to recruitintel_worker_global;
grant delete on table
  public.job_locations, public.job_skills, public.job_requirements, public.job_constraints
to recruitintel_worker_global;
grant select, insert, update, delete on all tables in schema public to recruitintel_web_app;
