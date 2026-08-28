-- M14: privacy-safe, point-in-time analytics and non-authoritative ML research.
-- This schema deliberately stores minimized facts and version metadata, never raw resumes,
-- notes, DOM, URLs, credentials, prompts, or serialized training rows.
create type public.analytics_fact_type as enum ('RECOMMENDATION_IMPRESSION','INTERACTION','APPLICATION_STAGE','SOURCE_HEALTH','BROWSER_SCAN','RESUME_MATCH','MODEL_FALLBACK');
create type public.dataset_status as enum ('BUILDING','READY','SUPERSEDED','INVALIDATED','DELETED');
create type public.experiment_status as enum ('QUEUED','RUNNING','COMPLETED','FAILED','INVALIDATED');
create type public.model_lifecycle as enum ('OFFLINE','SHADOW','DISABLED');

create table public.analytics_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  fact_type public.analytics_fact_type not null,
  occurred_at timestamptz not null,
  observed_at timestamptz not null,
  entity_type text not null check (entity_type ~ '^[A-Z_]{1,60}$'),
  entity_id uuid,
  dimensions jsonb not null default '{}'::jsonb check (jsonb_typeof(dimensions)='object' and octet_length(dimensions::text)<=4096 and not dimensions ?| array['email','resume_text','notes','dom','html','url','authorization','cookie','token']),
  metric_value numeric check (metric_value is null or metric_value >= 0),
  source_event_id uuid,
  transformation_version text not null check (length(transformation_version) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (fact_type, source_event_id, transformation_version)
);
create index analytics_facts_user_time_idx on public.analytics_facts (user_id, occurred_at desc, id);
create index analytics_facts_type_time_idx on public.analytics_facts (fact_type, occurred_at desc, id);

create table public.feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  subject_type text not null check (subject_type in ('OPPORTUNITY','COMPANY','SOURCE','RESUME_MATCH')),
  subject_id uuid not null,
  as_of_time timestamptz not null,
  observed_cutoff_at timestamptz not null,
  feature_version text not null check (length(feature_version) between 1 and 80),
  feature_hash text not null check (feature_hash ~ '^[0-9a-f]{64}$'),
  features jsonb not null check (jsonb_typeof(features)='object' and octet_length(features::text)<=8192 and not features ?| array['email','name','resume_text','school','address','race','ethnicity','religion','sex','gender','sexual_orientation','disability','veteran_status','health','political_affiliation']),
  created_at timestamptz not null default now(),
  check (observed_cutoff_at <= as_of_time),
  unique (user_id,subject_type,subject_id,as_of_time,feature_version)
);
create index feature_snapshots_pit_idx on public.feature_snapshots (subject_type,subject_id,as_of_time,observed_cutoff_at);

create table public.training_dataset_versions (
  id uuid primary key default gen_random_uuid(),
  dataset_type text not null check (dataset_type in ('PERSONALIZED_RANKING','OPENING_FORECAST','SOURCE_ANOMALY','RESUME_OUTCOME','INTERVIEW_TOPIC')),
  status public.dataset_status not null default 'BUILDING',
  schema_version text not null check (length(schema_version) between 1 and 80),
  feature_version text not null check (length(feature_version) between 1 and 80),
  label_version text not null check (length(label_version) between 1 and 80),
  source_cutoff_at timestamptz not null,
  generated_at timestamptz not null default now(),
  row_count integer not null default 0 check (row_count >= 0),
  user_count integer not null default 0 check (user_count >= 0),
  filtering_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(filtering_rules)='object' and octet_length(filtering_rules::text)<=4096),
  exclusion_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(exclusion_counts)='object' and octet_length(exclusion_counts::text)<=4096),
  code_version text not null check (length(code_version) between 1 and 100),
  privacy_policy_version text not null check (length(privacy_policy_version) between 1 and 80),
  fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status in ('READY','SUPERSEDED')) or row_count=0 or status='INVALIDATED')
);

create table public.dataset_members (
  dataset_id uuid not null references public.training_dataset_versions(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  pseudonym text not null check (pseudonym ~ '^[a-f0-9]{64}$'),
  row_fingerprint text not null check (row_fingerprint ~ '^[a-f0-9]{64}$'),
  as_of_time timestamptz not null,
  label_name text not null check (length(label_name) between 1 and 80),
  label_value numeric not null check (label_value between 0 and 1),
  feature_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (dataset_id,row_fingerprint),
  unique (dataset_id,user_id,feature_snapshot_id,label_name),
  check (user_id is not null or pseudonym = 'public')
);
create index dataset_members_user_idx on public.dataset_members(user_id,dataset_id);

create table public.experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_key text not null check (length(experiment_key) between 1 and 100),
  user_id uuid references public.users(id) on delete cascade,
  assignment text not null check (assignment in ('CONTROL','SHADOW')),
  assigned_at timestamptz not null default now(),
  unique (experiment_key,user_id)
);
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('PERSONALIZED_RANKING','OPENING_FORECAST','SOURCE_ANOMALY','RESUME_OUTCOME','INTERVIEW_TOPIC')),
  lifecycle public.model_lifecycle not null default 'OFFLINE',
  dataset_id uuid not null references public.training_dataset_versions(id) on delete restrict,
  algorithm_version text not null check (length(algorithm_version) between 1 and 100),
  feature_version text not null check (length(feature_version) between 1 and 80),
  hyperparameters jsonb not null default '{}'::jsonb check (jsonb_typeof(hyperparameters)='object' and octet_length(hyperparameters::text)<=4096),
  artifact_uri text check (artifact_uri is null or artifact_uri ~ '^private://'),
  artifact_checksum text check (artifact_checksum is null or artifact_checksum ~ '^[a-f0-9]{64}$'),
  code_version text not null check (length(code_version) between 1 and 100),
  cost_micros bigint not null default 0 check (cost_micros=0),
  rollback_reason text,
  created_at timestamptz not null default now()
);
create table public.model_evaluations (
  id uuid primary key default gen_random_uuid(), model_version_id uuid not null references public.model_versions(id) on delete cascade,
  split_strategy text not null check (split_strategy in ('TEMPORAL','ROLLING_ORIGIN')),
  baseline_reference text not null check (length(baseline_reference) between 1 and 120),
  metrics jsonb not null check (jsonb_typeof(metrics)='object' and octet_length(metrics::text)<=8192),
  promotion_eligible boolean not null default false,
  evaluated_at timestamptz not null default now(), unique(model_version_id,split_strategy)
);
create table public.model_predictions (
  id uuid primary key default gen_random_uuid(), model_version_id uuid not null references public.model_versions(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade, subject_id uuid not null,
  as_of_time timestamptz not null, feature_snapshot_id uuid not null references public.feature_snapshots(id) on delete restrict,
  prediction numeric not null check (prediction between 0 and 1), reason_codes text[] not null default '{}', shadow boolean not null default true,
  created_at timestamptz not null default now(), unique(model_version_id,user_id,subject_id,as_of_time), check (shadow)
);
create table public.drift_metrics (
  id uuid primary key default gen_random_uuid(), model_version_id uuid not null references public.model_versions(id) on delete cascade,
  measured_at timestamptz not null, metric_name text not null, metric_value numeric not null, threshold numeric not null,
  status text not null check (status in ('OK','WARN','ROLLBACK')), created_at timestamptz not null default now(), unique(model_version_id,measured_at,metric_name)
);

comment on table public.analytics_facts is 'M14 minimized privacy-safe facts; never a raw event warehouse.';
comment on table public.feature_snapshots is 'M14 point-in-time features. Protected/sensitive and raw private content are structurally rejected.';
comment on table public.training_dataset_versions is 'M14 reproducibility metadata only; dataset rows are normalized members, never arbitrary blobs.';
comment on table public.model_predictions is 'M14 shadow predictions only; they cannot alter M9 ordering or user-visible outcomes.';
