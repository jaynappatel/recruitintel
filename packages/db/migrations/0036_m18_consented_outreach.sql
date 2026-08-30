-- M18: private, user-consented outreach.  Public recruiter facts remain in
-- recruiter_profiles/recruiter_evidence; no address or relationship is copied there.
create table public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  recruiter_profile_id uuid references public.recruiter_profiles(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  company_name text,
  title text,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_truth text not null check (contact_truth in ('VERIFIED_PUBLIC','USER_PROVIDED','UNVERIFIED','UNKNOWN')),
  provenance_class text not null check (provenance_class in ('OFFICIAL_COMPANY','OFFICIAL_RECRUITING','PUBLIC_EVENT','PUBLIC_AUTHOR','USER_ENTERED','PREVIOUSLY_VERIFIED')),
  source_url text check (source_url is null or source_url ~ '^https://'),
  source_label text not null check (length(btrim(source_label)) between 1 and 160),
  consent_at timestamptz not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (user_id, email)
);
create index outreach_contacts_owner_idx on public.outreach_contacts(user_id, updated_at desc, id);

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  contact_id uuid not null references public.outreach_contacts(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  subject text not null check (length(btrim(subject)) between 1 and 200),
  body text not null check (length(btrim(body)) between 1 and 5000),
  grounding jsonb not null default '[]'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','REVIEW','APPROVED','SEND_ELIGIBLE','SENT','FAILED','CANCELLED')),
  version integer not null default 1 check (version > 0),
  approved_version integer,
  approved_at timestamptz,
  sent_at timestamptz,
  follow_up_due_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((approved_version is null and approved_at is null) or (approved_version is not null and approved_at is not null))
);
create index outreach_drafts_owner_idx on public.outreach_drafts(user_id, updated_at desc, id);

create table public.outreach_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  draft_id uuid not null references public.outreach_drafts(id) on delete cascade,
  draft_version integer not null check (draft_version > 0),
  recipient_email text not null,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  channel text not null check (channel in ('MANUAL_COPY')),
  status text not null check (status in ('PREPARED','RECORDED','REVOKED')),
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (draft_id, draft_version, recipient_email)
);
create index outreach_attempts_owner_idx on public.outreach_attempts(user_id, created_at desc, id);

create trigger outreach_contacts_set_updated_at before update on public.outreach_contacts
for each row execute function public.set_updated_at();
create trigger outreach_drafts_set_updated_at before update on public.outreach_drafts
for each row execute function public.set_updated_at();

comment on table public.outreach_contacts is 'M18 private, consented contact methods; public recruiter evidence is never copied into this table.';
comment on table public.outreach_attempts is 'M18 immutable manual-copy delivery ledger; no mail transport or provider credential is used.';
