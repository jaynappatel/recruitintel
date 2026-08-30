-- M20: durable operator-managed allowlist for a controlled private beta.
create type public.beta_access_status as enum ('ACTIVE', 'REVOKED');

create table public.beta_access_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email <> ''),
  status public.beta_access_status not null default 'ACTIVE',
  granted_by_user_id uuid references public.users(id) on delete set null,
  revoked_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (email),
  check ((status = 'ACTIVE' and revoked_at is null) or (status = 'REVOKED' and revoked_at is not null))
);
create index beta_access_grants_status_idx on public.beta_access_grants (status, email);

-- Existing accounts are already approved baseline users; preserve their access.
insert into public.beta_access_grants (email, status)
select lower(email), 'ACTIVE' from public.users
on conflict (email) do nothing;

comment on table public.beta_access_grants is 'Private-beta operator allowlist. No invitation secret, personal content, or client-controlled access state.';
