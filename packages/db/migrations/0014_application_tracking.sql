-- Milestone 10: private application projection and append-only outcome ledger.
-- No external provider, model, or paid dependency is introduced.

create type public.application_status as enum (
  'SAVED', 'PLANNING', 'APPLIED', 'IN_PROCESS', 'OFFER', 'REJECTED', 'WITHDRAWN', 'CLOSED'
);
create type public.application_stage as enum (
  'NONE', 'OA', 'RECRUITER_SCREEN', 'TECHNICAL_INTERVIEW', 'ONSITE', 'FINAL_ROUND'
);
create type public.application_event_type as enum (
  'APPLICATION_CREATED', 'APPLICATION_SUBMITTED', 'STATUS_CHANGED', 'STAGE_CHANGED',
  'OA_RECEIVED', 'OA_COMPLETED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_RESCHEDULED',
  'INTERVIEW_COMPLETED', 'OFFER_RECEIVED', 'REJECTION_RECEIVED', 'WITHDRAWN',
  'REOPENED', 'APPLICATION_TARGET_CORRECTED', 'ARCHIVED'
);
create type public.application_event_source as enum ('USER', 'SYSTEM', 'IMPORT', 'CALENDAR');
create type public.application_assessment_type as enum (
  'OA', 'CODING_CHALLENGE', 'TAKE_HOME', 'RECRUITER_SCREEN', 'BEHAVIORAL',
  'TECHNICAL', 'SYSTEM_DESIGN', 'OTHER'
);
create type public.application_assessment_status as enum (
  'EXPECTED', 'RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED'
);
create type public.application_interview_status as enum (
  'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'
);
create type public.application_recruiter_role as enum (
  'RELEVANT_RECRUITER', 'CONTACTED_RECRUITER', 'ASSIGNED_RECRUITER', 'INTERVIEWER'
);
create type public.application_next_action_type as enum (
  'NONE', 'COMPLETE_OA', 'PREPARE_FOR_INTERVIEW', 'REVIEW_OFFER',
  'FOLLOW_UP_OR_WAIT', 'PREPARE_APPLICATION', 'DECIDE_OR_PLAN'
);

alter type public.alert_type add value if not exists 'APPLICATION_ACTION_DUE';
alter type public.alert_type add value if not exists 'OA_DEADLINE_APPROACHING';
alter type public.alert_type add value if not exists 'INTERVIEW_UPCOMING';
alter type public.product_event_type add value if not exists 'APPLICATION_STAGE_CHANGED';
alter type public.product_event_type add value if not exists 'OA_RECEIVED';
alter type public.product_event_type add value if not exists 'OA_COMPLETED';
alter type public.product_event_type add value if not exists 'INTERVIEW_SCHEDULED';
alter type public.product_event_type add value if not exists 'INTERVIEW_COMPLETED';
alter type public.product_event_type add value if not exists 'OFFER_RECEIVED';
alter type public.product_event_type add value if not exists 'REJECTION_RECEIVED';
alter type public.product_event_type add value if not exists 'WITHDRAWN';

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete restrict,
  source_posting_id uuid references public.jobs(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete restrict,
  cycle_key text not null check (btrim(cycle_key) <> '' and length(cycle_key) <= 80),
  current_status public.application_status not null default 'SAVED',
  current_stage public.application_stage not null default 'NONE',
  applied_at timestamptz,
  application_url_used text check (application_url_used is null or (length(application_url_used) <= 2000 and application_url_used ~ '^https://')),
  application_plan_id uuid,
  origin_recommendation_impression_id uuid,
  target_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(target_snapshot) = 'object'),
  next_action_type public.application_next_action_type not null default 'NONE',
  next_action_at timestamptz,
  next_action_reason text,
  archived_at timestamptz,
  projection_version integer not null default 1 check (projection_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (application_plan_id, user_id) references public.application_plans(id, user_id) on delete set null,
  foreign key (origin_recommendation_impression_id, user_id)
    references public.recommendation_impressions(id, user_id) on delete set null
);
create unique index applications_active_cycle_unique_idx
  on public.applications (user_id, opportunity_id, cycle_key)
  where archived_at is null;
create index applications_user_updated_idx on public.applications (user_id, updated_at desc, id desc);
create index applications_user_status_idx on public.applications (user_id, current_status, updated_at desc, id desc)
  where archived_at is null;
create index applications_user_next_action_idx on public.applications (user_id, next_action_at, id)
  where archived_at is null and next_action_at is not null;

alter table public.application_plans add column application_id uuid;
alter table public.application_plans add constraint application_plans_application_owner_fkey
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete set null;
create unique index application_plans_application_unique_idx
  on public.application_plans (application_id) where application_id is not null;

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  event_type public.application_event_type not null,
  from_status public.application_status,
  to_status public.application_status,
  from_stage public.application_stage,
  to_stage public.application_stage,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  source public.application_event_source not null,
  reason_code text check (reason_code is null or (btrim(reason_code) <> '' and length(reason_code) <= 100)),
  assessment_id uuid,
  interview_id uuid,
  recruiter_profile_id uuid references public.recruiter_profiles(id) on delete restrict,
  calendar_item_id uuid,
  schema_version integer not null default 1 check (schema_version > 0),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade,
  foreign key (calendar_item_id, user_id) references public.calendar_items(id, user_id) on delete restrict
);
create index application_events_timeline_idx on public.application_events (application_id, occurred_at, recorded_at, id);
create index application_events_user_time_idx on public.application_events (user_id, occurred_at desc, id desc);
create trigger application_events_append_only
before update or delete on public.application_events
for each row execute function public.reject_product_event_mutation();

create table public.application_assessments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  type public.application_assessment_type not null,
  status public.application_assessment_status not null default 'EXPECTED',
  received_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  score numeric,
  provider_name text check (provider_name is null or length(provider_name) <= 200),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, application_id, idempotency_key),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade,
  check (completed_at is null or received_at is not null)
);
create index application_assessments_due_idx on public.application_assessments (user_id, due_at, id)
  where due_at is not null;

create table public.application_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  interview_type text not null check (btrim(interview_type) <> '' and length(interview_type) <= 100),
  status public.application_interview_status not null default 'SCHEDULED',
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'UTC',
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  recruiter_profile_id uuid references public.recruiter_profiles(id) on delete restrict,
  interviewer_label text check (interviewer_label is null or length(interviewer_label) <= 200),
  calendar_item_id uuid,
  result_code text check (result_code is null or length(result_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade,
  foreign key (calendar_item_id, user_id) references public.calendar_items(id, user_id) on delete set null,
  check (ends_at is null or ends_at >= starts_at)
);
create index application_interviews_upcoming_idx on public.application_interviews (user_id, starts_at, id)
  where status = 'SCHEDULED';

create table public.application_recruiters (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  recruiter_profile_id uuid not null references public.recruiter_profiles(id) on delete restrict,
  role public.application_recruiter_role not null,
  source public.application_event_source not null default 'USER',
  active boolean not null default true,
  first_associated_at timestamptz not null default now(),
  last_associated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade
);
create unique index application_recruiters_active_unique_idx on public.application_recruiters
  (user_id, application_id, recruiter_profile_id, role) where active;

alter table public.calendar_items add column application_id uuid;
alter table public.calendar_items add column application_assessment_id uuid;
alter table public.calendar_items add column application_interview_id uuid;
alter table public.calendar_items add constraint calendar_items_application_owner_fkey
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade;
create index calendar_items_application_idx on public.calendar_items (user_id, application_id, starts_at)
  where application_id is not null and deleted_at is null;

alter table public.alerts add column application_id uuid;
alter table public.alerts add column application_assessment_id uuid;
alter table public.alerts add column application_interview_id uuid;
alter table public.alerts add constraint alerts_application_owner_fkey
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade;
alter table public.alerts add constraint alerts_application_assessment_owner_fkey
  foreign key (application_assessment_id, user_id)
  references public.application_assessments(id, user_id) on delete cascade;
alter table public.alerts add constraint alerts_application_interview_owner_fkey
  foreign key (application_interview_id, user_id)
  references public.application_interviews(id, user_id) on delete cascade;
create index alerts_application_idx on public.alerts (user_id, application_id, created_at desc)
  where application_id is not null;

create trigger applications_set_updated_at before update on public.applications
for each row execute function public.set_updated_at();
create trigger application_assessments_set_updated_at before update on public.application_assessments
for each row execute function public.set_updated_at();
create trigger application_interviews_set_updated_at before update on public.application_interviews
for each row execute function public.set_updated_at();
