-- Gate 7.1A: provider-neutral search governance and transactional cost budgets.
-- No production search provider is approved or enabled by this migration.

insert into public.source_policies (
  provider, display_name, status, collection_method, official_api_available,
  authentication_mode, robots_policy, rate_policy, retention_policy,
  content_restrictions, allowed_uses, terms_status, terms_url, notes
) values
  (
    'static', 'Static search fixture', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{"external_requests":0}'::jsonb,
    '{"development_only":true}'::jsonb, '{"synthetic_fixtures_only":true}'::jsonb,
    array['LOCAL_TESTING'], 'NOT_REVIEWED', null,
    'Development/test fixtures only. Production execution is not authorized.'
  ),
  (
    'you', 'You.com Web Search API', 'REVIEW_REQUIRED', 'OFFICIAL_API', true,
    'API_TOKEN', 'NOT_APPLICABLE',
    '{"default_minimum_interval_seconds":1,"default_daily_requests":200}'::jsonb,
    '{"retained_fields_require_gate_7_1b_approval":true}'::jsonb,
    '{"snippets_only":true,"full_page_content":false,"person_search":false}'::jsonb,
    '{}'::text[], 'NOT_REVIEWED', 'https://you.com/terms',
    'Gate 7.1A adapter only. Gate 7.1B written authorization and policy approval are required.'
  )
on conflict (provider) do update set
  display_name = excluded.display_name,
  collection_method = excluded.collection_method,
  official_api_available = excluded.official_api_available,
  authentication_mode = excluded.authentication_mode,
  robots_policy = excluded.robots_policy,
  rate_policy = excluded.rate_policy,
  retention_policy = excluded.retention_policy,
  content_restrictions = excluded.content_restrictions,
  notes = excluded.notes
where public.source_policies.status = 'REVIEW_REQUIRED'
  and public.source_policies.terms_status = 'NOT_REVIEWED';

-- Preserve unknown legacy provider names as fail-closed policy records. This records no
-- legal conclusion and does not make the provider schedulable.
insert into public.source_policies (
  provider, display_name, status, collection_method, official_api_available,
  authentication_mode, robots_policy, terms_status, notes
)
select distinct query.provider, initcap(replace(query.provider, '_', ' ')),
  'REVIEW_REQUIRED'::public.source_policy_status,
  'MANUAL_REFERENCE_ONLY'::public.collection_method, false, 'OTHER',
  'NOT_APPLICABLE'::public.robots_policy_mode,
  'NOT_REVIEWED', 'Legacy search-provider reference; review required before execution.'
from public.public_web_search_queries query
where not exists (
  select 1 from public.source_policies policy where policy.provider = query.provider
)
on conflict (provider) do nothing;

alter table public.source_policies
  add constraint source_policies_provider_id_key unique (provider, id);
alter table public.sources
  add constraint sources_id_source_policy_id_key unique (id, source_policy_id);

alter table public.public_web_search_queries
  add column provider_policy_id uuid;

update public.public_web_search_queries query
set provider_policy_id = policy.id
from public.source_policies policy
where policy.provider = query.provider and query.provider_policy_id is null;

do $$
begin
  if exists (
    select query.source_id
    from public.public_web_search_queries query
    group by query.source_id
    having count(distinct query.provider_policy_id) > 1
  ) then
    raise exception 'one public-web search source references multiple providers';
  end if;
end $$;

update public.sources source
set source_policy_id = query.provider_policy_id
from public.public_web_search_queries query
where query.source_id = source.id
  and source.source_policy_id is distinct from query.provider_policy_id;

alter table public.public_web_search_queries
  alter column provider_policy_id set not null,
  add constraint public_web_search_queries_provider_policy_fkey
    foreign key (provider, provider_policy_id)
    references public.source_policies(provider, id) on delete restrict,
  add constraint public_web_search_queries_source_policy_fkey
    foreign key (source_id, provider_policy_id)
    references public.sources(id, source_policy_id) on delete cascade;

create index public_web_search_queries_provider_policy_idx
  on public.public_web_search_queries (provider_policy_id, status, id);

create function public.bind_public_web_search_provider_policy()
returns trigger language plpgsql security definer set search_path = public as $$
declare expected_policy_id uuid;
begin
  select id into expected_policy_id from public.source_policies where provider = new.provider;
  if expected_policy_id is null then
    raise exception 'SEARCH_PROVIDER_POLICY_REQUIRED' using errcode = '23503';
  end if;
  if new.provider_policy_id is null then new.provider_policy_id := expected_policy_id; end if;
  if new.provider_policy_id <> expected_policy_id then
    raise exception 'SEARCH_PROVIDER_POLICY_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.sources source
    where source.id = new.source_id and source.source_policy_id = expected_policy_id
  ) then
    raise exception 'SEARCH_SOURCE_POLICY_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger public_web_search_queries_bind_provider_policy
before insert or update of provider, provider_policy_id, source_id
on public.public_web_search_queries
for each row execute function public.bind_public_web_search_provider_policy();

create function public.provider_for_work_item(target_work_item_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when work.work_type = 'PUBLIC_WEB_SEARCH' then (
      select query.provider
      from public.public_web_work_requests request
      join public.public_web_search_queries query on query.id = request.search_query_id
      where request.id = work.public_web_work_request_id
    )
    when work.work_type = 'CALENDAR_SYNC' then 'google'
    else (select source.provider from public.sources source where source.id = work.source_id)
  end
  from public.work_items work where work.id = target_work_item_id
$$;

create function public.bind_work_provider_telemetry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.provider := public.provider_for_work_item(new.work_item_id);
  return new;
end;
$$;

create trigger work_attempts_bind_provider
before insert on public.work_attempts
for each row execute function public.bind_work_provider_telemetry();
create trigger dead_letters_bind_provider
before insert on public.dead_letters
for each row execute function public.bind_work_provider_telemetry();

update public.work_attempts attempt set provider = public.provider_for_work_item(attempt.work_item_id)
where provider is distinct from public.provider_for_work_item(attempt.work_item_id);
update public.dead_letters dead_letter
set provider = public.provider_for_work_item(dead_letter.work_item_id)
where provider is distinct from public.provider_for_work_item(dead_letter.work_item_id);

alter table public.work_items add constraint work_items_no_search_api_key_diagnostics
  check (not safe_diagnostics ?| array['api_key', 'api-key', 'x-api-key']);
alter table public.work_attempts add constraint work_attempts_no_search_api_key_diagnostics
  check (not safe_diagnostics ?| array['api_key', 'api-key', 'x-api-key']);
alter table public.dead_letters add constraint dead_letters_no_search_api_key_diagnostics
  check (not safe_diagnostics ?| array['api_key', 'api-key', 'x-api-key']);
alter table public.public_web_runs add constraint public_web_runs_no_raw_search_payload
  check (not metadata ?| array[
    'api_key', 'api-key', 'x-api-key', 'raw_response', 'raw_payload', 'response_headers'
  ]);

create table public.search_provider_budgets (
  provider text not null,
  credential_slot text not null check (
    credential_slot ~ '^[a-z0-9][a-z0-9_-]{0,99}$'
  ),
  daily_request_limit integer not null check (daily_request_limit > 0),
  monthly_estimated_cost_limit_micros bigint not null
    check (monthly_estimated_cost_limit_micros >= 0),
  estimated_cost_per_call_micros bigint not null
    check (estimated_cost_per_call_micros >= 0),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, credential_slot),
  foreign key (provider) references public.source_policies(provider) on delete restrict
);

create table public.search_provider_usage_daily (
  provider text not null,
  credential_slot text not null,
  usage_date date not null,
  request_count bigint not null default 0 check (request_count >= 0),
  estimated_cost_micros bigint not null default 0 check (estimated_cost_micros >= 0),
  last_reserved_at timestamptz not null default now(),
  primary key (provider, credential_slot, usage_date),
  foreign key (provider, credential_slot)
    references public.search_provider_budgets(provider, credential_slot) on delete restrict
);
create index search_provider_usage_month_idx
  on public.search_provider_usage_daily (provider, credential_slot, usage_date);

insert into public.search_provider_budgets (
  provider, credential_slot, daily_request_limit,
  monthly_estimated_cost_limit_micros, estimated_cost_per_call_micros, enabled
) values ('you', 'default', 200, 30000000, 5000, false)
on conflict (provider, credential_slot) do nothing;

create trigger search_provider_budgets_set_updated_at
before update on public.search_provider_budgets
for each row execute function public.set_updated_at();

create function public.reserve_search_provider_usage(
  target_provider text,
  target_credential_slot text,
  requested_calls integer,
  requested_estimated_cost_micros bigint
) returns table (
  reserved boolean,
  denial_reason text,
  retry_at timestamptz,
  daily_requests_remaining bigint,
  monthly_cost_remaining_micros bigint
) language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  budget public.search_provider_budgets%rowtype;
  utc_today date := (now() at time zone 'UTC')::date;
  month_start date := date_trunc('month', now() at time zone 'UTC')::date;
  current_daily bigint := 0;
  current_monthly_cost bigint := 0;
begin
  if requested_calls <= 0 or requested_estimated_cost_micros < 0 then
    raise exception 'SEARCH_PROVIDER_USAGE_INVALID' using errcode = '22023';
  end if;
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found or not ('WEB_SEARCH'::public.work_class = any(binding.allowed_work_classes)) then
    raise exception 'SEARCH_PROVIDER_BUDGET_ROLE_NOT_BOUND' using errcode = '42501';
  end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id and kind = 'WORKER' and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
    and 'WORKER_GLOBAL' = any(scopes);
  if not found then
    raise exception 'SEARCH_PROVIDER_BUDGET_PRINCIPAL_INACTIVE' using errcode = '42501';
  end if;

  select * into budget from public.search_provider_budgets
  where provider = target_provider and credential_slot = target_credential_slot
  for update;
  if not found or not budget.enabled then
    raise exception 'SEARCH_PROVIDER_BUDGET_NOT_ENABLED' using errcode = 'P0001';
  end if;
  if requested_estimated_cost_micros
      <> requested_calls::bigint * budget.estimated_cost_per_call_micros then
    raise exception 'SEARCH_PROVIDER_COST_ESTIMATE_MISMATCH' using errcode = '22023';
  end if;

  select coalesce(sum(usage.request_count), 0) into current_daily
  from public.search_provider_usage_daily usage
  where usage.provider = target_provider
    and usage.credential_slot = target_credential_slot
    and usage.usage_date = utc_today;
  select coalesce(sum(usage.estimated_cost_micros), 0) into current_monthly_cost
  from public.search_provider_usage_daily usage
  where usage.provider = target_provider
    and usage.credential_slot = target_credential_slot
    and usage.usage_date >= month_start and usage.usage_date < month_start + interval '1 month';

  if current_daily + requested_calls > budget.daily_request_limit then
    return query select false, 'DAILY_REQUEST_LIMIT',
      ((utc_today + 1)::timestamp at time zone 'UTC'),
      greatest(0, budget.daily_request_limit - current_daily),
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost);
    return;
  end if;
  if current_monthly_cost + requested_estimated_cost_micros
      > budget.monthly_estimated_cost_limit_micros then
    return query select false, 'MONTHLY_COST_LIMIT',
      ((month_start + interval '1 month')::timestamp at time zone 'UTC'),
      greatest(0, budget.daily_request_limit - current_daily),
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost);
    return;
  end if;

  insert into public.search_provider_usage_daily (
    provider, credential_slot, usage_date, request_count,
    estimated_cost_micros, last_reserved_at
  ) values (
    target_provider, target_credential_slot, utc_today, requested_calls,
    requested_estimated_cost_micros, now()
  ) on conflict (provider, credential_slot, usage_date) do update set
    request_count = public.search_provider_usage_daily.request_count + excluded.request_count,
    estimated_cost_micros = public.search_provider_usage_daily.estimated_cost_micros
      + excluded.estimated_cost_micros,
    last_reserved_at = now();

  return query select true, null::text, null::timestamptz,
    budget.daily_request_limit - current_daily - requested_calls,
    budget.monthly_estimated_cost_limit_micros
      - current_monthly_cost - requested_estimated_cost_micros;
end;
$$;

revoke all on function public.reserve_search_provider_usage(text, text, integer, bigint)
  from public;
grant execute on function public.reserve_search_provider_usage(text, text, integer, bigint)
  to recruitintel_worker_global;

grant select on table public.search_provider_budgets, public.search_provider_usage_daily
  to recruitintel_worker_global;
grant select, insert, update, delete on table
  public.search_provider_budgets, public.search_provider_usage_daily
  to recruitintel_web_app;

comment on table public.search_provider_budgets is
  'Per-provider/credential-slot hard request and estimated-cost controls. You remains disabled.';
comment on table public.search_provider_usage_daily is
  'Atomic pre-call reservations. Reservations are never released after transport uncertainty.';
comment on column public.public_web_search_queries.provider_policy_id is
  'The fail-closed policy for the selected SearchProvider, distinct from candidate fetch policy.';
