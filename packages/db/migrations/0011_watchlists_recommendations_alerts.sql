-- Milestone 9: private watchlists/preferences, deterministic recommendation evidence,
-- material-change suppression, and transactional in-app alerts. No external provider,
-- model, embedding, or paid service is introduced by this migration.

create type public.watch_entity_type as enum (
  'COMPANY', 'OPPORTUNITY', 'RECRUITER', 'SCHOOL'
);
create type public.watchlist_item_state as enum ('ACTIVE', 'REMOVED', 'SUPERSEDED');
create type public.watchlist_origin as enum (
  'USER', 'MIGRATED_SOURCE_POSTING', 'SUCCESSOR_FOLLOW'
);
create type public.watchlist_reason as enum (
  'SAVED_FOR_LATER', 'TARGET_COMPANY', 'RECRUITING_CONTACT', 'TARGET_SCHOOL', 'OTHER'
);
create type public.watch_notification_override as enum ('INHERIT', 'ENABLED', 'DISABLED');
create type public.watch_successor_policy as enum ('MANUAL', 'AUTO_FOLLOW_DIRECT');
create type public.early_career_track as enum ('INTERNSHIP', 'NEW_GRAD');
create type public.preferred_location_kind as enum (
  'CITY_REGION_COUNTRY', 'REGION_COUNTRY', 'COUNTRY', 'REMOTE_REGION'
);
create type public.opportunity_change_event_type as enum (
  'BASELINE', 'CREATED', 'OPENED', 'REOPENED', 'CLOSED',
  'MATERIAL_FACTS_CHANGED', 'DEADLINE_CHANGED', 'MERGED', 'SPLIT'
);
create type public.recommendation_eligibility as enum (
  'ELIGIBLE', 'NOT_ELIGIBLE', 'UNKNOWN'
);
create type public.recommendation_category as enum (
  'HIGH_PRIORITY', 'MEDIUM_PRIORITY', 'LOW_PRIORITY', 'NOT_ELIGIBLE'
);
create type public.evidence_coverage as enum ('HIGH', 'MEDIUM', 'LOW');
create type public.alert_type as enum (
  'WATCHED_COMPANY_OPPORTUNITY_OPENED',
  'RECOMMENDED_OPPORTUNITY_OPENED',
  'APPLICATION_DEADLINE_APPROACHING',
  'OPENING_WINDOW_STARTED',
  'WATCHED_RECRUITER_DISCOVERED',
  'WATCHED_RECRUITER_ACTIVITY',
  'CAMPUS_EVENT_DISCOVERED',
  'INTERVIEW_INTELLIGENCE_UPDATED',
  'CALENDAR_ACTION_DUE'
);
create type public.alert_reminder_window as enum (
  'NONE', 'SEVEN_DAY', 'THREE_DAY', 'ONE_DAY', 'DUE'
);
create type public.alert_evaluation_trigger as enum (
  'OPPORTUNITY_CHANGE', 'RECRUITING_EVENT', 'RECRUITING_DATE',
  'RECRUITER', 'CAMPUS_EVENT', 'INTERVIEW_INTELLIGENCE',
  'CALENDAR_ITEM', 'SCHEDULED_DUE_SCAN'
);
create type public.alert_evaluation_status as enum (
  'PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

-- Evolve the dormant M6 watch placeholder in place. The old source-posting id is
-- retained only as migration provenance; every active M9 watch targets a canonical entity.
alter table public.watchlist_items
  rename column job_id to legacy_job_id;
alter table public.watchlist_items
  rename column metadata to legacy_metadata;
alter table public.watchlist_items
  add column entity_type public.watch_entity_type,
  add column opportunity_id uuid references public.job_opportunities(id) on delete restrict,
  add column recruiter_profile_id uuid references public.recruiter_profiles(id) on delete restrict,
  add column school_id uuid references public.schools(id) on delete restrict,
  add column state public.watchlist_item_state not null default 'ACTIVE',
  add column origin public.watchlist_origin not null default 'USER',
  add column watch_reason public.watchlist_reason not null default 'OTHER',
  add column notification_override public.watch_notification_override not null default 'INHERIT',
  add column successor_policy public.watch_successor_policy not null default 'MANUAL',
  add column superseded_by_watchlist_item_id uuid,
  add column removed_at timestamptz,
  add column superseded_at timestamptz,
  add column updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from public.watchlist_items watch
    where watch.item_type = 'JOB'
      and not exists (
        select 1 from public.job_opportunity_postings membership
        where membership.job_id = watch.legacy_job_id and membership.valid_to is null
      )
  ) then
    raise exception 'M9_WATCH_MIGRATION_MISSING_ACTIVE_OPPORTUNITY';
  end if;
end;
$$;

update public.watchlist_items
set entity_type = 'COMPANY',
    watch_reason = 'TARGET_COMPANY'
where item_type = 'COMPANY';

update public.watchlist_items watch
set entity_type = 'OPPORTUNITY',
    opportunity_id = membership.opportunity_id,
    origin = 'MIGRATED_SOURCE_POSTING',
    watch_reason = 'SAVED_FOR_LATER'
from public.job_opportunity_postings membership
where watch.item_type = 'JOB'
  and membership.job_id = watch.legacy_job_id
  and membership.valid_to is null;

drop index public.watchlist_company_unique_idx;
drop index public.watchlist_job_unique_idx;
alter table public.watchlist_items drop constraint watchlist_items_check;
alter table public.watchlist_items drop constraint watchlist_items_company_id_fkey;
alter table public.watchlist_items drop constraint watchlist_items_job_id_fkey;

alter table public.watchlist_items
  add constraint watchlist_items_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete restrict,
  add constraint watchlist_items_legacy_job_id_fkey foreign key (legacy_job_id)
    references public.jobs(id) on delete set null;

alter table public.watchlist_items drop column item_type;
drop type public.watchlist_item_type;
alter table public.watchlist_items rename column entity_type to item_type;
alter table public.watchlist_items alter column item_type set not null;
alter table public.watchlist_items add constraint watchlist_items_typed_target_check check (
  (item_type = 'COMPANY' and company_id is not null and opportunity_id is null
    and recruiter_profile_id is null and school_id is null)
  or
  (item_type = 'OPPORTUNITY' and company_id is null and opportunity_id is not null
    and recruiter_profile_id is null and school_id is null)
  or
  (item_type = 'RECRUITER' and company_id is null and opportunity_id is null
    and recruiter_profile_id is not null and school_id is null)
  or
  (item_type = 'SCHOOL' and company_id is null and opportunity_id is null
    and recruiter_profile_id is null and school_id is not null)
);

-- Multiple old source-posting watches can resolve to one canonical opportunity.
-- Preserve every row and select the oldest one as the active canonical watch.
with ranked as (
  select id, user_id, opportunity_id,
    first_value(id) over (
      partition by user_id, opportunity_id order by created_at, id
    ) as primary_id,
    row_number() over (
      partition by user_id, opportunity_id order by created_at, id
    ) as position
  from public.watchlist_items where item_type = 'OPPORTUNITY'
)
update public.watchlist_items watch set
  state = 'SUPERSEDED',
  superseded_at = now(),
  superseded_by_watchlist_item_id = ranked.primary_id
from ranked where watch.id = ranked.id and ranked.position > 1;

alter table public.watchlist_items
  add constraint watchlist_items_id_user_unique unique (id, user_id),
  add constraint watchlist_items_successor_owner_fkey
    foreign key (superseded_by_watchlist_item_id, user_id)
    references public.watchlist_items(id, user_id) on delete restrict,
  add constraint watchlist_items_state_check check (
    (state = 'ACTIVE' and removed_at is null and superseded_at is null
      and superseded_by_watchlist_item_id is null)
    or (state = 'REMOVED' and removed_at is not null and superseded_at is null
      and superseded_by_watchlist_item_id is null)
    or (state = 'SUPERSEDED' and removed_at is null and superseded_at is not null
      and superseded_by_watchlist_item_id is not null)
  );

create unique index watchlist_company_active_unique_idx
  on public.watchlist_items (user_id, company_id)
  where state = 'ACTIVE' and company_id is not null;
create unique index watchlist_opportunity_active_unique_idx
  on public.watchlist_items (user_id, opportunity_id)
  where state = 'ACTIVE' and opportunity_id is not null;
create unique index watchlist_recruiter_active_unique_idx
  on public.watchlist_items (user_id, recruiter_profile_id)
  where state = 'ACTIVE' and recruiter_profile_id is not null;
create unique index watchlist_school_active_unique_idx
  on public.watchlist_items (user_id, school_id)
  where state = 'ACTIVE' and school_id is not null;
create index watchlist_items_user_state_idx
  on public.watchlist_items (user_id, state, created_at desc, id);
create index watchlist_items_company_fanout_idx
  on public.watchlist_items (company_id, user_id)
  where state = 'ACTIVE' and company_id is not null;
create index watchlist_items_opportunity_fanout_idx
  on public.watchlist_items (opportunity_id, user_id)
  where state = 'ACTIVE' and opportunity_id is not null;
create index watchlist_items_recruiter_fanout_idx
  on public.watchlist_items (recruiter_profile_id, user_id)
  where state = 'ACTIVE' and recruiter_profile_id is not null;
create index watchlist_items_school_fanout_idx
  on public.watchlist_items (school_id, user_id)
  where state = 'ACTIVE' and school_id is not null;
create trigger watchlist_items_set_updated_at before update on public.watchlist_items
for each row execute function public.set_updated_at();

-- Compact, explicit recruiting preferences. Absence of a row/set means unset, not false.
create table public.user_recruiting_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  graduation_year integer check (graduation_year is null or graduation_year between 2020 and 2050),
  us_work_authorized boolean,
  requires_employer_sponsorship boolean,
  preference_version integer not null default 1 check (preference_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_recruiting_preferences_set_updated_at
before update on public.user_recruiting_preferences
for each row execute function public.set_updated_at();

create table public.user_preferred_role_families (
  user_id uuid not null references public.users(id) on delete cascade,
  role_family public.role_family not null check (role_family <> 'OTHER'),
  created_at timestamptz not null default now(),
  primary key (user_id, role_family)
);
create index user_preferred_role_families_fanout_idx
  on public.user_preferred_role_families (role_family, user_id);

create table public.user_preferred_early_career_tracks (
  user_id uuid not null references public.users(id) on delete cascade,
  track public.early_career_track not null,
  created_at timestamptz not null default now(),
  primary key (user_id, track)
);
create index user_preferred_early_career_tracks_fanout_idx
  on public.user_preferred_early_career_tracks (track, user_id);

create table public.user_preferred_experience_levels (
  user_id uuid not null references public.users(id) on delete cascade,
  experience_level public.experience_level not null check (experience_level <> 'UNKNOWN'),
  created_at timestamptz not null default now(),
  primary key (user_id, experience_level)
);
create index user_preferred_experience_levels_fanout_idx
  on public.user_preferred_experience_levels (experience_level, user_id);

create table public.user_preferred_workplace_modes (
  user_id uuid not null references public.users(id) on delete cascade,
  workplace_mode public.workplace_mode not null check (workplace_mode in ('REMOTE', 'HYBRID', 'ONSITE')),
  created_at timestamptz not null default now(),
  primary key (user_id, workplace_mode)
);
create index user_preferred_workplace_modes_fanout_idx
  on public.user_preferred_workplace_modes (workplace_mode, user_id);

create table public.user_preferred_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind public.preferred_location_kind not null,
  city text,
  region text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  remote_region text,
  normalized_key text not null check (btrim(normalized_key) <> '' and length(normalized_key) <= 300),
  display_label text not null check (btrim(display_label) <> '' and length(display_label) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, normalized_key),
  check (
    (kind = 'CITY_REGION_COUNTRY' and btrim(city) <> '' and btrim(region) <> ''
      and country_code is not null and remote_region is null)
    or (kind = 'REGION_COUNTRY' and city is null and btrim(region) <> ''
      and country_code is not null and remote_region is null)
    or (kind = 'COUNTRY' and city is null and region is null
      and country_code is not null and remote_region is null)
    or (kind = 'REMOTE_REGION' and city is null and region is null
      and country_code is null and btrim(remote_region) <> '')
  )
);
create index user_preferred_locations_fanout_idx
  on public.user_preferred_locations (kind, country_code, region, city, user_id);

create table public.user_target_schools (
  user_id uuid not null references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, school_id)
);
create index user_target_schools_fanout_idx
  on public.user_target_schools (school_id, user_id);

-- Canonical, bounded material-change evidence used by freshness, alerts, and dismissals.
create table public.opportunity_change_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type public.opportunity_change_event_type not null,
  change_version integer not null check (change_version > 0),
  previous_lifecycle public.opportunity_lifecycle_status,
  current_lifecycle public.opportunity_lifecycle_status,
  material_fingerprint text not null check (material_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_codes text[] not null check (cardinality(reason_codes) between 1 and 16),
  resolution_decision_id uuid references public.job_resolution_decisions(id) on delete set null,
  correlation_id uuid,
  idempotency_fingerprint text not null unique check (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (opportunity_id, change_version),
  foreign key (opportunity_id, company_id)
    references public.job_opportunities(id, company_id) on delete cascade
);
create index opportunity_change_events_timeline_idx
  on public.opportunity_change_events (opportunity_id, change_version desc, id);
create index opportunity_change_events_trigger_idx
  on public.opportunity_change_events (event_type, occurred_at, id);

create function public.job_opportunity_material_fingerprint(target_opportunity_id uuid)
returns text language sql stable set search_path = public as $$
  select encode(digest(coalesce((
    select jsonb_build_object(
      'status', opportunity.status::text,
      'successor', opportunity.superseded_by_id,
      'canonicalSource', opportunity.canonical_source_posting_id,
      'roleFamily', opportunity.role_family::text,
      'experienceLevel', opportunity.experience_level::text,
      'internship', opportunity.is_internship,
      'newGrad', opportunity.is_new_grad,
      'graduationYears', opportunity.graduation_years,
      'workplaceMode', opportunity.workplace_mode::text,
      'deadline', opportunity.deadline_at,
      'lifecycle', opportunity.lifecycle_status::text,
      'authority', coalesce(capability.authority::text, 'UNREVIEWED'),
      'authorityReviewed', coalesce(capability.reviewed, false),
      'locations', coalesce((
        select jsonb_agg(jsonb_build_array(
          lower(coalesce(location.city, '')), lower(coalesce(location.region, '')),
          coalesce(location.country_code, ''), lower(coalesce(location.remote_region, '')),
          location.workplace_mode::text
        ) order by lower(coalesce(location.city, '')), lower(coalesce(location.region, '')),
          coalesce(location.country_code, ''), lower(coalesce(location.remote_region, '')),
          location.workplace_mode::text)
        from public.job_opportunity_postings membership
        join public.job_locations location on location.job_id = membership.job_id
        where membership.opportunity_id = opportunity.id and membership.valid_to is null
      ), '[]'::jsonb),
      'constraints', coalesce((
        select jsonb_agg(jsonb_build_array(
          constraint_row.constraint_type::text, constraint_row.value
        ) order by constraint_row.constraint_type::text, constraint_row.value::text)
        from public.job_opportunity_postings membership
        join public.job_constraints constraint_row on constraint_row.job_id = membership.job_id
        where membership.opportunity_id = opportunity.id and membership.valid_to is null
      ), '[]'::jsonb),
      'requirements', coalesce((
        select jsonb_agg(jsonb_build_array(
          requirement.requirement_type::text, requirement.normalized_value
        ) order by requirement.requirement_type::text, requirement.normalized_value::text)
        from public.job_opportunity_postings membership
        join public.job_requirements requirement on requirement.job_id = membership.job_id
        where membership.opportunity_id = opportunity.id and membership.valid_to is null
      ), '[]'::jsonb)
    )::text
    from public.job_opportunities opportunity
    left join public.jobs canonical on canonical.id = opportunity.canonical_source_posting_id
    left join public.source_job_capabilities capability on capability.source_id = canonical.source_id
    where opportunity.id = target_opportunity_id
  ), target_opportunity_id::text), 'sha256'), 'hex')
$$;

insert into public.opportunity_change_events (
  opportunity_id, company_id, event_type, change_version, current_lifecycle,
  material_fingerprint, reason_codes, idempotency_fingerprint, occurred_at
)
select opportunity.id, opportunity.company_id, 'BASELINE', 1,
  opportunity.lifecycle_status,
  public.job_opportunity_material_fingerprint(opportunity.id),
  array['M9_BASELINE_NO_ALERT'],
  encode(digest('m9-baseline:' || opportunity.id::text, 'sha256'), 'hex'),
  opportunity.created_at
from public.job_opportunities opportunity;

create function public.record_job_opportunity_change()
returns trigger language plpgsql set search_path = public as $$
declare
  fingerprint text;
  previous_fingerprint text;
  next_version integer;
  change_type public.opportunity_change_event_type;
  reasons text[];
begin
  perform pg_advisory_xact_lock(hashtextextended('opportunity-change:' || new.id::text, 0));
  fingerprint := public.job_opportunity_material_fingerprint(new.id);
  select event.material_fingerprint, event.change_version
  into previous_fingerprint, next_version
  from public.opportunity_change_events event
  where event.opportunity_id = new.id
  order by event.change_version desc limit 1;
  next_version := coalesce(next_version, 0) + 1;

  if tg_op = 'INSERT' then
    change_type := 'CREATED'; reasons := array['CANONICAL_OPPORTUNITY_CREATED'];
  elsif old.status = 'ACTIVE' and new.status = 'SUPERSEDED' then
    change_type := 'MERGED'; reasons := array['CANONICAL_OPPORTUNITY_SUPERSEDED'];
  elsif old.status = 'SUPERSEDED' and new.status = 'ACTIVE' then
    change_type := 'SPLIT'; reasons := array['CANONICAL_OPPORTUNITY_REACTIVATED_BY_SPLIT'];
  elsif old.lifecycle_status = 'CLOSED' and new.lifecycle_status = 'OPEN' then
    change_type := 'REOPENED'; reasons := array['CANONICAL_OPPORTUNITY_REOPENED'];
  elsif old.lifecycle_status <> 'OPEN' and new.lifecycle_status = 'OPEN' then
    change_type := 'OPENED'; reasons := array['CANONICAL_OPPORTUNITY_OPENED'];
  elsif old.lifecycle_status <> 'CLOSED' and new.lifecycle_status = 'CLOSED' then
    change_type := 'CLOSED'; reasons := array['CANONICAL_OPPORTUNITY_CLOSED'];
  elsif old.deadline_at is distinct from new.deadline_at then
    change_type := 'DEADLINE_CHANGED'; reasons := array['CANONICAL_DEADLINE_CHANGED'];
  else
    change_type := 'MATERIAL_FACTS_CHANGED'; reasons := array['SCORING_FACTS_CHANGED'];
  end if;

  if tg_op = 'UPDATE' and fingerprint = previous_fingerprint
      and old.status = new.status and old.lifecycle_status = new.lifecycle_status
      and old.deadline_at is not distinct from new.deadline_at then
    return new;
  end if;

  insert into public.opportunity_change_events (
    opportunity_id, company_id, event_type, change_version,
    previous_lifecycle, current_lifecycle, material_fingerprint,
    reason_codes, idempotency_fingerprint
  ) values (
    new.id, new.company_id, change_type, next_version,
    case when tg_op = 'UPDATE' then old.lifecycle_status end,
    new.lifecycle_status, fingerprint, reasons,
    encode(digest(new.id::text || ':' || next_version::text || ':' ||
      change_type::text || ':' || fingerprint, 'sha256'), 'hex')
  ) on conflict (idempotency_fingerprint) do nothing;
  return new;
end;
$$;
create trigger job_opportunities_record_material_change
after insert or update on public.job_opportunities
for each row execute function public.record_job_opportunity_change();

create function public.reject_opportunity_change_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.companies where id = old.company_id
  ) then return old; end if;
  raise exception 'opportunity change events are append-only' using errcode = '55000';
end;
$$;
create trigger opportunity_change_events_append_only
before update or delete on public.opportunity_change_events
for each row execute function public.reject_opportunity_change_mutation();

-- M6 remains the only recommendation decision/impression ledger.
alter table public.ranking_decisions
  add column as_of timestamptz,
  add column preference_version integer check (preference_version is null or preference_version >= 0),
  add column filter_fingerprint text check (
    filter_fingerprint is null or filter_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add column request_id uuid;
create index ranking_decisions_user_time_idx
  on public.ranking_decisions (user_id, created_at desc, id);

alter table public.recommendation_impressions
  add column opportunity_id uuid references public.job_opportunities(id) on delete restrict,
  add column eligibility public.recommendation_eligibility,
  add column category public.recommendation_category,
  add column evidence_coverage public.evidence_coverage,
  add column available_weight integer check (available_weight is null or available_weight between 0 and 100),
  add column reason_codes text[] not null default '{}',
  add column mismatch_codes text[] not null default '{}',
  add column hard_constraint_codes text[] not null default '{}',
  add column factor_values jsonb not null default '[]'::jsonb check (
    jsonb_typeof(factor_values) = 'array'
    and not factor_values::text ~* '(description|resume|authorization|raw)'
  ),
  add column opened_at timestamptz;
alter table public.recommendation_impressions
  add constraint recommendation_impressions_id_user_unique unique (id, user_id);
alter table public.recommendation_impressions
  disable trigger recommendation_impressions_append_only;
update public.recommendation_impressions impression
set opportunity_id = opportunity.id
from public.job_opportunities opportunity
where impression.item_type = 'OPPORTUNITY' and impression.item_id = opportunity.id;
alter table public.recommendation_impressions
  enable trigger recommendation_impressions_append_only;
create index recommendation_impressions_user_opportunity_idx
  on public.recommendation_impressions (user_id, opportunity_id, shown_at desc)
  where opportunity_id is not null;

create table public.opportunity_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete restrict,
  suppression_rule_version text not null default 'material-change-suppression-v1'
    check (suppression_rule_version = 'material-change-suppression-v1'),
  basis_change_version integer not null check (basis_change_version > 0),
  basis_material_fingerprint text not null check (basis_material_fingerprint ~ '^[0-9a-f]{64}$'),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  dismissed_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (release_reason is null or release_reason ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  expires_at timestamptz,
  check ((released_at is null) = (release_reason is null))
);
create unique index opportunity_suppressions_one_active_idx
  on public.opportunity_suppressions (user_id, opportunity_id)
  where released_at is null;
create index opportunity_suppressions_user_time_idx
  on public.opportunity_suppressions (user_id, dismissed_at desc, id);

create table public.user_notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  activated_at timestamptz not null default now(),
  settings_version integer not null default 1 check (settings_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_notification_preferences_set_updated_at
before update on public.user_notification_preferences
for each row execute function public.set_updated_at();

create table public.user_alert_type_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  alert_type public.alert_type not null,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, alert_type)
);
create trigger user_alert_type_preferences_set_updated_at
before update on public.user_alert_type_preferences
for each row execute function public.set_updated_at();

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  alert_type public.alert_type not null,
  opportunity_id uuid references public.job_opportunities(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  recruiter_profile_id uuid references public.recruiter_profiles(id) on delete restrict,
  school_id uuid references public.schools(id) on delete restrict,
  campus_recruiting_event_id uuid references public.campus_recruiting_events(id) on delete restrict,
  recruiting_date_id uuid references public.recruiting_dates(id) on delete restrict,
  company_interview_question_id uuid
    references public.company_interview_questions(id) on delete restrict,
  calendar_item_id uuid,
  opportunity_change_event_id uuid
    references public.opportunity_change_events(id) on delete restrict,
  recommendation_impression_id uuid,
  reminder_window public.alert_reminder_window not null default 'NONE',
  rule_version text not null check (btrim(rule_version) <> '' and length(rule_version) <= 100),
  algorithm_version text check (algorithm_version is null or length(algorithm_version) <= 100),
  reason_codes text[] not null check (cardinality(reason_codes) between 1 and 16),
  title text not null check (btrim(title) <> '' and length(title) <= 240),
  body text not null check (btrim(body) <> '' and length(body) <= 1000),
  dedupe_contract_version smallint not null default 1 check (dedupe_contract_version > 0),
  dedupe_fingerprint text not null check (dedupe_fingerprint ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  shown_at timestamptz,
  opened_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz,
  superseded_by_alert_id uuid,
  unique (id, user_id),
  unique (user_id, dedupe_fingerprint),
  foreign key (calendar_item_id, user_id)
    references public.calendar_items(id, user_id) on delete restrict,
  foreign key (recommendation_impression_id, user_id)
    references public.recommendation_impressions(id, user_id) on delete restrict,
  foreign key (superseded_by_alert_id, user_id)
    references public.alerts(id, user_id) on delete restrict,
  check (opened_at is null or read_at is not null),
  check (dismissed_at is null or read_at is not null)
);
create index alerts_user_mailbox_idx
  on public.alerts (user_id, created_at desc, id desc);
create index alerts_user_unread_idx
  on public.alerts (user_id, created_at desc, id desc)
  where read_at is null and dismissed_at is null and superseded_by_alert_id is null;
create index alerts_user_state_idx
  on public.alerts (user_id, dismissed_at, read_at, expires_at, created_at desc, id desc);
create index alerts_opportunity_reconcile_idx
  on public.alerts (opportunity_id, alert_type, created_at desc, id)
  where opportunity_id is not null;
create index alerts_deadline_scan_idx
  on public.alerts (opportunity_id, reminder_window, created_at desc)
  where alert_type = 'APPLICATION_DEADLINE_APPROACHING';

create table public.alert_evaluation_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  parent_request_id uuid references public.alert_evaluation_requests(id) on delete cascade,
  trigger_type public.alert_evaluation_trigger not null,
  opportunity_change_event_id uuid
    references public.opportunity_change_events(id) on delete cascade,
  recruiting_event_id uuid references public.recruiting_events(id) on delete cascade,
  recruiting_date_id uuid references public.recruiting_dates(id) on delete cascade,
  recruiter_profile_id uuid references public.recruiter_profiles(id) on delete cascade,
  campus_recruiting_event_id uuid
    references public.campus_recruiting_events(id) on delete cascade,
  company_interview_question_id uuid
    references public.company_interview_questions(id) on delete cascade,
  calendar_item_id uuid,
  status public.alert_evaluation_status not null default 'PENDING',
  request_fingerprint text not null unique check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  safe_context jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_context) = 'object'
    and not safe_context ?| array[
      'authorization', 'cookie', 'access_token', 'refresh_token', 'id_token',
      'oauth_code', 'email', 'url', 'resume_text', 'dom_html', 'raw_payload', 'preferences'
    ]
  ),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,99}$'),
  created_at timestamptz not null default now(),
  foreign key (calendar_item_id, user_id)
    references public.calendar_items(id, user_id) on delete cascade,
  check (
    (trigger_type = 'OPPORTUNITY_CHANGE' and opportunity_change_event_id is not null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is null and calendar_item_id is null)
    or (trigger_type = 'RECRUITING_EVENT' and opportunity_change_event_id is null
      and recruiting_event_id is not null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is null and calendar_item_id is null)
    or (trigger_type = 'RECRUITING_DATE' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is not null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is null and calendar_item_id is null)
    or (trigger_type = 'RECRUITER' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is not null and campus_recruiting_event_id is null
      and company_interview_question_id is null and calendar_item_id is null)
    or (trigger_type = 'CAMPUS_EVENT' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is not null
      and company_interview_question_id is null and calendar_item_id is null)
    or (trigger_type = 'INTERVIEW_INTELLIGENCE' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is not null and calendar_item_id is null)
    or (trigger_type = 'CALENDAR_ITEM' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is null
      and calendar_item_id is not null and user_id is not null)
    or (trigger_type = 'SCHEDULED_DUE_SCAN' and opportunity_change_event_id is null
      and recruiting_event_id is null and recruiting_date_id is null
      and recruiter_profile_id is null and campus_recruiting_event_id is null
      and company_interview_question_id is null and calendar_item_id is null)
  )
);
create index alert_evaluation_requests_status_idx
  on public.alert_evaluation_requests (status, created_at, id);
create index alert_evaluation_requests_user_idx
  on public.alert_evaluation_requests (user_id, status, created_at, id)
  where user_id is not null;

-- Explicit successor following is traceable; manual watches remain on their original target.
create function public.reconcile_private_opportunity_successor()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'ACTIVE' or new.status <> 'SUPERSEDED' or new.superseded_by_id is null then
    return new;
  end if;

  insert into public.watchlist_items (
    user_id, item_type, opportunity_id, state, origin, watch_reason,
    notification_override, successor_policy, created_at
  )
  select watch.user_id, 'OPPORTUNITY', new.superseded_by_id, 'ACTIVE',
    'SUCCESSOR_FOLLOW', watch.watch_reason, watch.notification_override,
    watch.successor_policy, now()
  from public.watchlist_items watch
  where watch.item_type = 'OPPORTUNITY' and watch.opportunity_id = new.id
    and watch.state = 'ACTIVE' and watch.successor_policy = 'AUTO_FOLLOW_DIRECT'
  on conflict (user_id, opportunity_id)
    where state = 'ACTIVE' and opportunity_id is not null do nothing;

  update public.watchlist_items watch set
    state = 'SUPERSEDED', superseded_at = now(),
    superseded_by_watchlist_item_id = successor.id
  from public.watchlist_items successor
  where watch.item_type = 'OPPORTUNITY' and watch.opportunity_id = new.id
    and watch.state = 'ACTIVE' and watch.successor_policy = 'AUTO_FOLLOW_DIRECT'
    and successor.user_id = watch.user_id and successor.item_type = 'OPPORTUNITY'
    and successor.opportunity_id = new.superseded_by_id and successor.state = 'ACTIVE';

  update public.alerts alert set
    expires_at = least(coalesce(alert.expires_at, now()), now()),
    superseded_by_alert_id = (
      select successor.id from public.alerts successor
      where successor.user_id = alert.user_id
        and successor.opportunity_id = new.superseded_by_id
        and successor.alert_type = alert.alert_type
      order by successor.created_at, successor.id limit 1
    )
  where alert.opportunity_id = new.id
    and alert.dismissed_at is null and alert.superseded_by_alert_id is null;
  return new;
end;
$$;
create trigger job_opportunities_reconcile_private_successor
after update of status, superseded_by_id on public.job_opportunities
for each row execute function public.reconcile_private_opportunity_successor();

-- Extend M7's typed subject union. New enum values become usable after this migration commits;
-- enqueue functions and the schedule are installed in 0012.
alter table public.work_items
  add column alert_evaluation_request_id uuid
    references public.alert_evaluation_requests(id) on delete cascade,
  add column fanout_after_user_id uuid references public.users(id) on delete set null;
create index work_items_alert_evaluation_request_idx
  on public.work_items (alert_evaluation_request_id)
  where alert_evaluation_request_id is not null;

do $$
declare constraint_row record;
begin
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.schedules'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%work_type%'
  loop
    execute format('alter table public.schedules drop constraint %I', constraint_row.conname);
  end loop;
  for constraint_row in
    select conname from pg_constraint
    where conrelid = 'public.work_items'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%work_type%'
  loop
    execute format('alter table public.work_items drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.schedules add constraint schedules_typed_subject_check check (
  (work_type::text = 'ATS_COLLECT' and source_id is not null
    and github_repository_id is null and public_web_search_query_id is null
    and public_web_candidate_id is null)
  or (work_type::text = 'GITHUB_SYNC' and source_id is null
    and github_repository_id is not null and public_web_search_query_id is null
    and public_web_candidate_id is null)
  or (work_type::text = 'PUBLIC_WEB_SEARCH' and source_id is null
    and github_repository_id is null and public_web_search_query_id is not null
    and public_web_candidate_id is null)
  or (work_type::text in (
      'PUBLIC_WEB_FETCH', 'PUBLIC_WEB_PROCESS', 'PRIVACY_RETENTION_CLEANUP',
      'SOURCE_HEALTH_ROLLUP', 'ALERT_FANOUT'
    ) and source_id is null and github_repository_id is null
    and public_web_search_query_id is null
    and ((work_type::text in ('PUBLIC_WEB_FETCH', 'PUBLIC_WEB_PROCESS')
      and public_web_candidate_id is not null)
      or (work_type::text not in ('PUBLIC_WEB_FETCH', 'PUBLIC_WEB_PROCESS')
        and public_web_candidate_id is null)))
);

alter table public.work_items add constraint work_items_typed_subject_check check (
  (work_type::text = 'ATS_COLLECT' and source_id is not null
    and github_sync_request_id is null and public_web_work_request_id is null
    and calendar_sync_request_id is null and recruiting_observation_id is null
    and alert_evaluation_request_id is null and fanout_after_user_id is null
    and user_id is null)
  or (work_type::text = 'GITHUB_SYNC' and source_id is not null
    and github_sync_request_id is not null and public_web_work_request_id is null
    and calendar_sync_request_id is null and recruiting_observation_id is null
    and alert_evaluation_request_id is null and fanout_after_user_id is null
    and user_id is null)
  or (work_type::text in ('PUBLIC_WEB_SEARCH', 'PUBLIC_WEB_FETCH', 'PUBLIC_WEB_PROCESS')
    and source_id is not null and public_web_work_request_id is not null
    and github_sync_request_id is null and calendar_sync_request_id is null
    and recruiting_observation_id is null and alert_evaluation_request_id is null
    and fanout_after_user_id is null
    and user_id is null)
  or (work_type::text = 'RECRUITER_CAMPUS_PROJECT'
    and recruiting_observation_id is not null and github_sync_request_id is null
    and public_web_work_request_id is null and calendar_sync_request_id is null
    and alert_evaluation_request_id is null and fanout_after_user_id is null
    and user_id is null)
  or (work_type::text = 'CALENDAR_SYNC' and calendar_sync_request_id is not null
    and user_id is not null and github_sync_request_id is null
    and public_web_work_request_id is null and recruiting_observation_id is null
    and alert_evaluation_request_id is null and fanout_after_user_id is null
    and source_id is null)
  or (work_type::text in ('PRIVACY_RETENTION_CLEANUP', 'SOURCE_HEALTH_ROLLUP')
    and source_id is null and github_sync_request_id is null
    and public_web_work_request_id is null and calendar_sync_request_id is null
    and recruiting_observation_id is null and alert_evaluation_request_id is null
    and fanout_after_user_id is null
    and user_id is null)
  or (work_type::text = 'ALERT_FANOUT' and source_id is null
    and github_sync_request_id is null and public_web_work_request_id is null
    and calendar_sync_request_id is null and recruiting_observation_id is null
    and user_id is null)
  or (work_type::text = 'ALERT_EVALUATE' and source_id is null
    and github_sync_request_id is null and public_web_work_request_id is null
    and calendar_sync_request_id is null and recruiting_observation_id is null
    and alert_evaluation_request_id is not null and user_id is not null)
);

alter type public.work_type add value 'ALERT_FANOUT';
alter type public.work_type add value 'ALERT_EVALUATE';
alter type public.work_class add value 'PERSONALIZATION';
alter type public.service_scope add value 'WORKER_PERSONALIZATION';

alter type public.product_event_type add value 'OPPORTUNITY_SAVED';
alter type public.product_event_type add value 'OPPORTUNITY_DISMISSED';
alter type public.product_event_type add value 'RECOMMENDATION_SHOWN';
alter type public.product_event_type add value 'RECOMMENDATION_OPENED';
alter type public.product_event_type add value 'WATCHLIST_ADDED';
alter type public.product_event_type add value 'WATCHLIST_REMOVED';

comment on table public.watchlist_items is
  'Private typed watch history. Canonical correction never rewrites the original target.';
comment on table public.user_recruiting_preferences is
  'Compact explicit private recruiting constraints; no inferred attributes.';
comment on table public.opportunity_change_events is
  'Append-only canonical material-change/open-cycle ledger; excludes raw descriptions.';
comment on table public.opportunity_suppressions is
  'Private versioned dismissal basis; material canonical change permits rediscovery.';
comment on table public.alerts is
  'Private transactional IN_APP alert ledger with semantic database deduplication.';

grant select, insert, update, delete on all tables in schema public to recruitintel_web_app;
