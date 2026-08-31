-- Milestone 13: bounded, optional AI proposals and grounded prose.
-- Prompts, raw provider responses, resume text, and browser DOM are never persisted.
create type public.model_task_type as enum ('REQUIREMENT_EXTRACT','EVIDENCE_EXTRACT','EXPLANATION_GENERATE','RESUME_SUGGEST');
create type public.model_call_status as enum ('CACHED','SUCCEEDED','ABSTAINED','REJECTED','BLOCKED','FAILED');
create type public.model_disposition as enum ('PENDING','CONFIRMED','REJECTED');

create table public.model_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  task_type public.model_task_type not null,
  provider text not null check (provider ~ '^[a-z0-9_-]{1,60}$'),
  model text not null check (length(model) between 1 and 120),
  prompt_version text not null check (length(prompt_version) between 1 and 80),
  schema_version text not null check (length(schema_version) between 1 and 80),
  redaction_version text not null check (length(redaction_version) between 1 and 80),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  cache_scope_id text not null default 'shared' check (length(cache_scope_id) between 1 and 80),
  policy_decision text not null check (policy_decision in ('DETERMINISTIC','MODEL_ALLOWED','ZERO_COST_BLOCKED','BUDGET_BLOCKED','STALE','DELETED')),
  status public.model_call_status not null,
  input_tokens integer not null default 0 check (input_tokens between 0 and 12000),
  output_tokens integer not null default 0 check (output_tokens between 0 and 2000),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 120000),
  safe_error_code text check (safe_error_code is null or length(safe_error_code) <= 100),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (cache_scope_id, cache_key)
);
create index model_calls_user_created_idx on public.model_calls (user_id, created_at desc, id);

create table public.model_outputs (
  id uuid primary key default gen_random_uuid(),
  model_call_id uuid not null references public.model_calls(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  task_type public.model_task_type not null,
  output jsonb not null check (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 32768),
  evidence_references jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_references) = 'array'),
  validation_status text not null check (validation_status in ('VALID','REJECTED','ABSTAINED')),
  disposition public.model_disposition not null default 'PENDING',
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (model_call_id)
);
create index model_outputs_user_created_idx on public.model_outputs (user_id, created_at desc, id);

create table public.model_usage_costs (
  id uuid primary key default gen_random_uuid(),
  model_call_id uuid not null unique references public.model_calls(id) on delete cascade,
  provider text not null, model text not null, task_type public.model_task_type not null,
  cached boolean not null default false,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  paid_spend_micros bigint not null default 0 check (paid_spend_micros >= 0),
  created_at timestamptz not null default now()
);

-- Private proposal history cascades with account deletion; shared requirement facts must
-- be independently validated against public source evidence before becoming canonical.
comment on table public.model_calls is 'M13 safe model metadata only; no prompts, raw text, raw DOM, provider credentials, or raw responses.';
comment on table public.model_outputs is 'M13 bounded structured proposals/prose. Model output is never authoritative evidence or score.';
