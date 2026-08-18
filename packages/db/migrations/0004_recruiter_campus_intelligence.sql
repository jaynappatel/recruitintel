alter type public.recruiting_event_type add value if not exists 'SCHOOL_RECRUITING_SIGNAL';

create type public.recruiter_profile_status as enum (
  'ACTIVE', 'UNVERIFIED', 'STALE', 'INACTIVE'
);

create type public.recruiter_role_category as enum (
  'UNIVERSITY_RECRUITING', 'EARLY_CAREER', 'TECHNICAL_RECRUITING',
  'TALENT_ACQUISITION', 'CAMPUS_PROGRAMS', 'UNIVERSITY_PROGRAMS',
  'EMERGING_TALENT', 'GENERAL_RECRUITING', 'OTHER'
);

create type public.recruiter_evidence_type as enum (
  'EMPLOYMENT', 'UNIVERSITY_RECRUITING', 'SCHOOL_CONNECTION', 'ROLE_FOCUS',
  'CAMPUS_EVENT', 'RECRUITING_ANNOUNCEMENT', 'PUBLIC_PROFILE', 'OTHER'
);

create type public.relationship_strength as enum (
  'HIGH', 'MEDIUM', 'LOW', 'LIMITED_EVIDENCE'
);

create type public.relationship_status as enum (
  'ACTIVE', 'UNVERIFIED', 'STALE', 'INACTIVE'
);

create type public.campus_recruiting_event_type as enum (
  'CAREER_FAIR', 'INFO_SESSION', 'COMPANY_VISIT', 'TECH_TALK', 'COFFEE_CHAT',
  'HACKATHON', 'RECRUITING_EVENT', 'INTERVIEW_EVENT', 'OTHER'
);

create type public.unresolved_recruiter_reason as enum (
  'UNKNOWN_PERSON', 'AMBIGUOUS_PERSON', 'UNKNOWN_SCHOOL', 'AMBIGUOUS_SCHOOL',
  'AMBIGUOUS_COMPANY', 'INSUFFICIENT_EVIDENCE', 'UNSUPPORTED_FORMAT'
);

create type public.unresolved_recruiter_status as enum ('PENDING', 'RESOLVED', 'IGNORED');

alter table public.schools
  add column city text,
  add column state_region text,
  add column country text;

alter table public.public_web_runs
  add column recruiter_profiles_created integer not null default 0
    check (recruiter_profiles_created >= 0),
  add column campus_events_created integer not null default 0
    check (campus_events_created >= 0),
  add column unresolved_recruiter_references integer not null default 0
    check (unresolved_recruiter_references >= 0);

create table public.school_aliases (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  alias text not null check (btrim(alias) <> ''),
  normalized_alias text not null unique check (btrim(normalized_alias) <> ''),
  created_at timestamptz not null default now(),
  unique (school_id, alias)
);

create index school_aliases_school_idx on public.school_aliases (school_id, normalized_alias);

insert into public.school_aliases (school_id, alias, normalized_alias)
select id, canonical_name,
       btrim(regexp_replace(lower(canonical_name), '[^a-z0-9]+', ' ', 'g'))
from public.schools
on conflict (normalized_alias) do nothing;

insert into public.school_aliases (school_id, alias, normalized_alias)
select s.id, value,
       btrim(regexp_replace(lower(value), '[^a-z0-9]+', ' ', 'g'))
from public.schools s
cross join lateral unnest(s.aliases) value
where btrim(value) <> ''
on conflict (normalized_alias) do nothing;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (btrim(canonical_name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_normalized_name_idx on public.people (normalized_name, id);

create table public.recruiter_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (btrim(title) <> ''),
  normalized_title text not null check (btrim(normalized_title) <> ''),
  categories public.recruiter_role_category[] not null default '{OTHER}',
  location text,
  public_profile_url text check (
    public_profile_url is null or public_profile_url ~ '^https?://'
  ),
  source_id uuid not null references public.sources(id) on delete restrict,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_verified_at timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  status public.recruiter_profile_status not null default 'UNVERIFIED',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, company_id),
  check (last_seen_at >= first_seen_at),
  check (last_verified_at >= first_seen_at),
  check (array_length(categories, 1) is not null),
  check (array_position(categories, null) is null)
);

create index recruiter_profiles_public_profile_url_idx
  on public.recruiter_profiles (lower(public_profile_url))
  where public_profile_url is not null;
create index recruiter_profiles_company_idx
  on public.recruiter_profiles (company_id, last_verified_at desc, id);
create index recruiter_profiles_person_idx on public.recruiter_profiles (person_id, company_id);
create index recruiter_profiles_categories_idx on public.recruiter_profiles using gin (categories);

create table public.recruiter_evidence (
  id uuid primary key default gen_random_uuid(),
  recruiter_profile_id uuid not null references public.recruiter_profiles(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  public_recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  role_family public.role_family,
  source_url text not null check (source_url ~ '^https?://'),
  evidence_type public.recruiter_evidence_type not null,
  evidence_text text not null check (btrim(evidence_text) <> ''),
  observed_at timestamptz not null,
  published_at timestamptz,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  reliability public.source_reliability_level not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index recruiter_evidence_profile_idx
  on public.recruiter_evidence (recruiter_profile_id, observed_at desc, id desc);
create index recruiter_evidence_observation_idx
  on public.recruiter_evidence (public_recruiting_observation_id, id)
  where public_recruiting_observation_id is not null;
create index recruiter_evidence_school_idx
  on public.recruiter_evidence (school_id, observed_at desc)
  where school_id is not null;

create table public.recruiter_school_relationships (
  id uuid primary key default gen_random_uuid(),
  recruiter_profile_id uuid not null references public.recruiter_profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  strength public.relationship_strength not null default 'LIMITED_EVIDENCE',
  strength_reasons text[] not null default '{}',
  status public.relationship_status not null default 'UNVERIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recruiter_profile_id, school_id),
  check (last_seen_at >= first_seen_at)
);

create index recruiter_school_school_idx
  on public.recruiter_school_relationships (school_id, last_seen_at desc, id);

create table public.recruiter_school_evidence (
  relationship_id uuid not null
    references public.recruiter_school_relationships(id) on delete cascade,
  evidence_id uuid not null references public.recruiter_evidence(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (relationship_id, evidence_id),
  unique (evidence_id, relationship_id)
);

create table public.recruiter_role_focus (
  id uuid primary key default gen_random_uuid(),
  recruiter_profile_id uuid not null references public.recruiter_profiles(id) on delete cascade,
  role_family public.role_family not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  evidence_count integer not null default 0 check (evidence_count >= 0),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  strength public.relationship_strength not null default 'LIMITED_EVIDENCE',
  strength_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recruiter_profile_id, role_family),
  check (last_seen_at >= first_seen_at)
);

create index recruiter_role_focus_role_idx
  on public.recruiter_role_focus (role_family, last_seen_at desc, id);

create table public.recruiter_role_evidence (
  role_focus_id uuid not null references public.recruiter_role_focus(id) on delete cascade,
  evidence_id uuid not null references public.recruiter_evidence(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_focus_id, evidence_id),
  unique (evidence_id, role_focus_id)
);

create table public.campus_recruiting_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  event_type public.campus_recruiting_event_type not null,
  description text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  date_start date,
  date_end date,
  date_precision public.date_precision not null default 'UNKNOWN',
  date_certainty public.date_certainty not null default 'CLAIMED',
  location text,
  is_virtual boolean not null default false,
  registration_url text check (registration_url is null or registration_url ~ '^https?://'),
  source_id uuid not null references public.sources(id) on delete restrict,
  public_recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  source_url text not null check (source_url ~ '^https?://'),
  first_seen_at timestamptz not null,
  last_verified_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is not null),
  check (ends_at is null or ends_at >= starts_at),
  check (date_end is null or date_start is not null),
  check (date_end is null or date_end >= date_start),
  check (last_verified_at >= first_seen_at)
);

create index campus_events_company_idx
  on public.campus_recruiting_events (
    company_id, starts_at desc, date_start desc, first_seen_at desc, id desc
  );
create index campus_events_school_idx
  on public.campus_recruiting_events (
    school_id, starts_at desc, date_start desc, first_seen_at desc, id desc
  ) where school_id is not null;

create table public.campus_recruiting_event_evidence (
  campus_event_id uuid not null
    references public.campus_recruiting_events(id) on delete cascade,
  public_recruiting_observation_id uuid not null
    references public.public_recruiting_observations(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (campus_event_id, public_recruiting_observation_id)
);

create index campus_event_evidence_source_idx
  on public.campus_recruiting_event_evidence (source_id, observed_at desc);

create table public.campus_event_recruiters (
  campus_event_id uuid not null references public.campus_recruiting_events(id) on delete cascade,
  recruiter_profile_id uuid not null references public.recruiter_profiles(id) on delete cascade,
  evidence_id uuid not null references public.recruiter_evidence(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campus_event_id, recruiter_profile_id),
  unique (campus_event_id, evidence_id)
);

create table public.unresolved_recruiter_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  public_recruiting_observation_id uuid
    references public.public_recruiting_observations(id) on delete set null,
  raw_person_name text,
  raw_company_name text,
  raw_school_name text,
  raw_title text,
  reason public.unresolved_recruiter_reason not null,
  source_url text not null check (source_url ~ '^https?://'),
  evidence_text text not null check (btrim(evidence_text) <> ''),
  observed_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  status public.unresolved_recruiter_status not null default 'PENDING',
  resolved_recruiter_profile_id uuid
    references public.recruiter_profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'RESOLVED') = (resolved_recruiter_profile_id is not null))
);

create index unresolved_recruiter_pending_idx
  on public.unresolved_recruiter_observations (reason, observed_at desc, id)
  where status = 'PENDING';

alter table public.recruiting_events
  add column recruiter_profile_id uuid
    references public.recruiter_profiles(id) on delete set null,
  add column school_id uuid references public.schools(id) on delete set null,
  add column campus_recruiting_event_id uuid
    references public.campus_recruiting_events(id) on delete set null;

create index recruiting_events_recruiter_idx
  on public.recruiting_events (recruiter_profile_id, occurred_at desc, id desc)
  where recruiter_profile_id is not null;
create index recruiting_events_school_idx
  on public.recruiting_events (school_id, occurred_at desc, id desc)
  where school_id is not null;
create index recruiting_events_campus_event_idx
  on public.recruiting_events (campus_recruiting_event_id, occurred_at desc, id desc)
  where campus_recruiting_event_id is not null;

create trigger people_set_updated_at
before update on public.people
for each row execute function public.set_updated_at();

create trigger recruiter_profiles_set_updated_at
before update on public.recruiter_profiles
for each row execute function public.set_updated_at();

create trigger recruiter_school_relationships_set_updated_at
before update on public.recruiter_school_relationships
for each row execute function public.set_updated_at();

create trigger recruiter_role_focus_set_updated_at
before update on public.recruiter_role_focus
for each row execute function public.set_updated_at();

create trigger campus_recruiting_events_set_updated_at
before update on public.campus_recruiting_events
for each row execute function public.set_updated_at();

create trigger unresolved_recruiter_observations_set_updated_at
before update on public.unresolved_recruiter_observations
for each row execute function public.set_updated_at();

comment on table public.recruiter_evidence is
  'Immutable evidence for recruiter claims; confidence and reliability are ranking metadata.';
comment on table public.recruiter_school_relationships is
  'Derived recruiter-school projection. Evidence remains authoritative and is never collapsed.';
comment on table public.unresolved_recruiter_observations is
  'Ambiguous recruiter/school/person references retained for reviewed resolution.';
