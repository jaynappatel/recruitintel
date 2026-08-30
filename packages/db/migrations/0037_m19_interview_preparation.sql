-- Milestone 19: private, application-linked interview preparation state.
-- Public question observations remain immutable and are never copied here.

create table public.interview_prep_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  application_id uuid not null,
  interview_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, interview_id),
  foreign key (application_id, user_id) references public.applications(id, user_id) on delete cascade,
  foreign key (interview_id, user_id) references public.application_interviews(id, user_id) on delete cascade
);

create table public.interview_prep_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  prep_plan_id uuid not null,
  item_key text not null check (item_key ~ '^[a-z0-9_-]{1,80}$'),
  title text not null check (btrim(title) <> '' and length(title) <= 240),
  rationale text not null check (btrim(rationale) <> '' and length(rationale) <= 1000),
  item_kind text not null check (item_kind in ('COMPANY','ROLE','REQUIREMENT','EVIDENCE','GAP','TOPIC','QUESTION_PROMPT')),
  completed_at timestamptz,
  version integer not null default 1 check (version > 0),
  calendar_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prep_plan_id, item_key),
  foreign key (prep_plan_id, user_id) references public.interview_prep_plans(id, user_id) on delete cascade,
  foreign key (calendar_item_id, user_id) references public.calendar_items(id, user_id) on delete set null
);

create index interview_prep_plans_application_idx on public.interview_prep_plans (user_id, application_id);
create index interview_prep_items_plan_idx on public.interview_prep_items (user_id, prep_plan_id, created_at);
create trigger interview_prep_plans_set_updated_at before update on public.interview_prep_plans for each row execute function public.set_updated_at();
create trigger interview_prep_items_set_updated_at before update on public.interview_prep_items for each row execute function public.set_updated_at();

comment on table public.interview_prep_plans is 'Private application-interview preparation metadata. Cascades on application, interview, and user deletion.';
comment on table public.interview_prep_items is 'Private deterministic checklist state; no private notes, answers, or third-party question text.';
