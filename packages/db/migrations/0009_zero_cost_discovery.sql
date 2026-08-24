-- Gate 7.1A.1: zero-cost discovery, durable source endpoints, and optional local search.
-- No commercial provider or metasearch upstream engine is approved by this migration.

create type public.source_discovery_method as enum (
  'CONFIGURED', 'PAGE_LINK', 'ATS_FINGERPRINT', 'COMMON_PATH', 'SEARCH',
  'GITHUB', 'UNIVERSITY', 'USER_BROWSER', 'MANUAL'
);
create type public.search_provider_cost_category as enum ('FREE', 'FREE_TIER', 'PAID');

alter table public.sources
  add column discovery_method public.source_discovery_method,
  add column first_seen_at timestamptz,
  add column last_verified_at timestamptz,
  add column discovery_confidence numeric(4, 3),
  add column discovered_from_source_id uuid references public.sources(id) on delete set null,
  add column discovery_fingerprint text,
  add column discovery_provenance jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(discovery_provenance) = 'object'
      and not discovery_provenance ?| array[
        'authorization', 'cookie', 'access_token', 'refresh_token', 'api_key',
        'raw_payload', 'raw_html', 'dom_html'
      ]
    );

update public.sources set
  discovery_method = case
    when provider = 'manual' then 'MANUAL'::public.source_discovery_method
    when source_type = 'GITHUB' then 'GITHUB'::public.source_discovery_method
    when source_type = 'UNIVERSITY' then 'UNIVERSITY'::public.source_discovery_method
    when provider in ('web_search', 'static', 'you')
      then 'SEARCH'::public.source_discovery_method
    else 'CONFIGURED'::public.source_discovery_method
  end,
  first_seen_at = created_at,
  discovery_confidence = reliability,
  discovery_fingerprint = encode(digest(
    'source:v1:' || id::text || ':' || provider || ':' || external_key, 'sha256'
  ), 'hex')
where discovery_method is null;

alter table public.sources
  alter column discovery_method set not null,
  alter column first_seen_at set not null,
  alter column first_seen_at set default now(),
  alter column discovery_confidence set not null,
  alter column discovery_confidence set default 0.500,
  alter column discovery_fingerprint set not null,
  add constraint sources_discovery_confidence_check
    check (discovery_confidence between 0 and 1),
  add constraint sources_discovery_fingerprint_key unique (discovery_fingerprint),
  add constraint sources_discovery_fingerprint_check
    check (discovery_fingerprint ~ '^[0-9a-f]{64}$');
create index sources_company_discovery_idx
  on public.sources (company_id, source_type, enabled, last_verified_at desc, id);

-- Existing source writers keep working while every new source receives deterministic,
-- bounded provenance. Direct discovery supplies its stronger fingerprint explicitly.
create function public.initialize_source_endpoint()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.discovery_method is null then
    new.discovery_method := case
      when new.provider = 'manual' then 'MANUAL'::public.source_discovery_method
      when new.source_type = 'GITHUB' then 'GITHUB'::public.source_discovery_method
      when new.source_type = 'UNIVERSITY' then 'UNIVERSITY'::public.source_discovery_method
      when new.provider in ('web_search', 'static', 'you', 'searxng')
        then 'SEARCH'::public.source_discovery_method
      else 'CONFIGURED'::public.source_discovery_method
    end;
  end if;
  new.first_seen_at := coalesce(new.first_seen_at, now());
  new.discovery_confidence := coalesce(new.discovery_confidence, new.reliability, 0.500);
  if new.discovery_fingerprint is null then
    new.discovery_fingerprint := encode(digest(
      'source:v1:' || coalesce(new.company_id::text, 'global') || ':'
        || new.provider || ':' || new.external_key,
      'sha256'
    ), 'hex');
  end if;
  return new;
end;
$$;
create trigger sources_initialize_source_endpoint
before insert on public.sources
for each row execute function public.initialize_source_endpoint();

insert into public.source_policies (
  provider, display_name, status, collection_method, official_api_available,
  authentication_mode, robots_policy, rate_policy, retention_policy,
  content_restrictions, allowed_uses, terms_status, notes
) values
  (
    'searxng', 'Operator-controlled SearXNG API', 'REVIEW_REQUIRED', 'OFFICIAL_API', true,
    'OTHER', 'NOT_APPLICABLE', '{"operator_configured":true}'::jsonb,
    '{"upstream_engine_review_required":true}'::jsonb,
    '{"public_instances_not_supported":true,"engine_allowlist_required":true}'::jsonb,
    '{}'::text[], 'NOT_REVIEWED',
    'Optional self-hosted HTTP integration. SearXNG and every enabled upstream engine require review.'
  ),
  (
    'ashby', 'Ashby recruiting endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  ),
  (
    'workday', 'Workday recruiting endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  ),
  (
    'smartrecruiters', 'SmartRecruiters endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  ),
  (
    'icims', 'iCIMS recruiting endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  ),
  (
    'successfactors', 'SAP SuccessFactors endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  ),
  (
    'bamboohr', 'BambooHR recruiting endpoint', 'REVIEW_REQUIRED', 'MANUAL_REFERENCE_ONLY', false,
    'NONE', 'NOT_APPLICABLE', '{}'::jsonb, '{}'::jsonb,
    '{"collector_not_implemented":true}'::jsonb, '{}'::text[], 'NOT_REVIEWED',
    'Deterministic URL recognition only; no collector or production approval.'
  )
on conflict (provider) do nothing;

alter table public.search_provider_budgets
  add column cost_category public.search_provider_cost_category not null default 'PAID',
  add column zero_cost_eligible boolean not null default false,
  add column monthly_request_limit bigint check (
    monthly_request_limit is null or monthly_request_limit > 0
  ),
  add column monthly_paid_spend_limit_micros bigint not null default 0 check (
    monthly_paid_spend_limit_micros >= 0
  );
alter table public.search_provider_usage_daily
  add column paid_spend_micros bigint not null default 0 check (paid_spend_micros >= 0);

update public.search_provider_budgets set
  cost_category = 'PAID', zero_cost_eligible = false,
  monthly_paid_spend_limit_micros = 0
where provider = 'you';

insert into public.search_provider_budgets (
  provider, credential_slot, daily_request_limit,
  monthly_estimated_cost_limit_micros, estimated_cost_per_call_micros,
  cost_category, zero_cost_eligible, monthly_request_limit,
  monthly_paid_spend_limit_micros, enabled
) values (
  'searxng', 'local', 1000, 0, 0, 'FREE', true, 30000, 0, false
)
on conflict (provider, credential_slot) do nothing;

drop function public.reserve_search_provider_usage(text, text, integer, bigint);
create function public.reserve_search_provider_usage(
  target_provider text,
  target_credential_slot text,
  requested_calls integer,
  requested_estimated_cost_micros bigint,
  requested_paid_spend_micros bigint,
  zero_cost_mode boolean
) returns table (
  reserved boolean,
  denial_reason text,
  retry_at timestamptz,
  daily_requests_remaining bigint,
  monthly_requests_remaining bigint,
  monthly_cost_remaining_micros bigint,
  monthly_paid_spend_remaining_micros bigint
) language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  budget public.search_provider_budgets%rowtype;
  utc_today date := (now() at time zone 'UTC')::date;
  month_start date := date_trunc('month', now() at time zone 'UTC')::date;
  current_daily bigint := 0;
  current_monthly_requests bigint := 0;
  current_monthly_cost bigint := 0;
  current_monthly_paid bigint := 0;
  next_day timestamptz := (((now() at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC');
  next_month timestamptz := ((date_trunc('month', now() at time zone 'UTC')
    + interval '1 month')::timestamp at time zone 'UTC');
begin
  if requested_calls <= 0 or requested_estimated_cost_micros < 0
      or requested_paid_spend_micros < 0
      or requested_paid_spend_micros > requested_estimated_cost_micros then
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
  if budget.cost_category = 'FREE' and (
      requested_estimated_cost_micros <> 0 or requested_paid_spend_micros <> 0
  ) then
    raise exception 'FREE_PROVIDER_COST_MISMATCH' using errcode = '22023';
  end if;
  if budget.cost_category = 'FREE_TIER' and requested_paid_spend_micros <> 0 then
    raise exception 'FREE_TIER_PAID_OVERAGE_UNSUPPORTED' using errcode = '22023';
  end if;

  select coalesce(sum(usage.request_count), 0),
    coalesce(sum(usage.estimated_cost_micros), 0),
    coalesce(sum(usage.paid_spend_micros), 0)
  into current_monthly_requests, current_monthly_cost, current_monthly_paid
  from public.search_provider_usage_daily usage
  where usage.provider = target_provider
    and usage.credential_slot = target_credential_slot
    and usage.usage_date >= month_start and usage.usage_date < month_start + interval '1 month';
  select coalesce(sum(usage.request_count), 0) into current_daily
  from public.search_provider_usage_daily usage
  where usage.provider = target_provider
    and usage.credential_slot = target_credential_slot
    and usage.usage_date = utc_today;

  if zero_cost_mode and (
    not budget.zero_cost_eligible or budget.cost_category = 'PAID'
    or requested_paid_spend_micros > 0
  ) then
    return query select false, 'ZERO_COST_MODE', null::timestamptz,
      greatest(0, budget.daily_request_limit - current_daily),
      case when budget.monthly_request_limit is null then null::bigint else
        greatest(0, budget.monthly_request_limit - current_monthly_requests) end,
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost),
      greatest(0, budget.monthly_paid_spend_limit_micros - current_monthly_paid);
    return;
  end if;
  if current_daily + requested_calls > budget.daily_request_limit then
    return query select false, 'DAILY_REQUEST_LIMIT', next_day,
      greatest(0, budget.daily_request_limit - current_daily),
      case when budget.monthly_request_limit is null then null::bigint else
        greatest(0, budget.monthly_request_limit - current_monthly_requests) end,
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost),
      greatest(0, budget.monthly_paid_spend_limit_micros - current_monthly_paid);
    return;
  end if;
  if budget.monthly_request_limit is not null
      and current_monthly_requests + requested_calls > budget.monthly_request_limit then
    return query select false, 'MONTHLY_REQUEST_LIMIT', next_month,
      greatest(0, budget.daily_request_limit - current_daily),
      greatest(0, budget.monthly_request_limit - current_monthly_requests),
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost),
      greatest(0, budget.monthly_paid_spend_limit_micros - current_monthly_paid);
    return;
  end if;
  if current_monthly_cost + requested_estimated_cost_micros
      > budget.monthly_estimated_cost_limit_micros then
    return query select false, 'MONTHLY_COST_LIMIT', next_month,
      greatest(0, budget.daily_request_limit - current_daily),
      case when budget.monthly_request_limit is null then null::bigint else
        greatest(0, budget.monthly_request_limit - current_monthly_requests) end,
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost),
      greatest(0, budget.monthly_paid_spend_limit_micros - current_monthly_paid);
    return;
  end if;
  if current_monthly_paid + requested_paid_spend_micros
      > budget.monthly_paid_spend_limit_micros then
    return query select false, 'MONTHLY_PAID_SPEND_LIMIT', next_month,
      greatest(0, budget.daily_request_limit - current_daily),
      case when budget.monthly_request_limit is null then null::bigint else
        greatest(0, budget.monthly_request_limit - current_monthly_requests) end,
      greatest(0, budget.monthly_estimated_cost_limit_micros - current_monthly_cost),
      greatest(0, budget.monthly_paid_spend_limit_micros - current_monthly_paid);
    return;
  end if;

  insert into public.search_provider_usage_daily (
    provider, credential_slot, usage_date, request_count,
    estimated_cost_micros, paid_spend_micros, last_reserved_at
  ) values (
    target_provider, target_credential_slot, utc_today, requested_calls,
    requested_estimated_cost_micros, requested_paid_spend_micros, now()
  ) on conflict (provider, credential_slot, usage_date) do update set
    request_count = public.search_provider_usage_daily.request_count + excluded.request_count,
    estimated_cost_micros = public.search_provider_usage_daily.estimated_cost_micros
      + excluded.estimated_cost_micros,
    paid_spend_micros = public.search_provider_usage_daily.paid_spend_micros
      + excluded.paid_spend_micros,
    last_reserved_at = now();

  return query select true, null::text, null::timestamptz,
    budget.daily_request_limit - current_daily - requested_calls,
    case when budget.monthly_request_limit is null then null::bigint else
      budget.monthly_request_limit - current_monthly_requests - requested_calls end,
    budget.monthly_estimated_cost_limit_micros
      - current_monthly_cost - requested_estimated_cost_micros,
    budget.monthly_paid_spend_limit_micros
      - current_monthly_paid - requested_paid_spend_micros;
end;
$$;

revoke all on function public.reserve_search_provider_usage(
  text, text, integer, bigint, bigint, boolean
) from public;
grant execute on function public.reserve_search_provider_usage(
  text, text, integer, bigint, bigint, boolean
) to recruitintel_worker_global;

alter table public.schedules
  add column public_web_candidate_id uuid
    references public.public_web_candidates(id) on delete cascade;
create index schedules_public_web_candidate_idx on public.schedules (public_web_candidate_id)
  where public_web_candidate_id is not null;

do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.schedules'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%public_web_search_query_id%'
    and pg_get_constraintdef(oid) like '%work_type%';
  if constraint_name is null then raise exception 'schedule target constraint was not found'; end if;
  execute format('alter table public.schedules drop constraint %I', constraint_name);
end;
$$;

alter table public.schedules add constraint schedules_target_check check (
  (work_type = 'ATS_COLLECT' and source_id is not null
    and github_repository_id is null and public_web_search_query_id is null
    and public_web_candidate_id is null)
  or
  (work_type = 'GITHUB_SYNC' and source_id is null
    and github_repository_id is not null and public_web_search_query_id is null
    and public_web_candidate_id is null)
  or
  (work_type = 'PUBLIC_WEB_SEARCH' and source_id is null
    and github_repository_id is null and public_web_search_query_id is not null
    and public_web_candidate_id is null)
  or
  (work_type = 'PUBLIC_WEB_FETCH' and source_id is null
    and github_repository_id is null and public_web_search_query_id is null
    and public_web_candidate_id is not null)
  or
  (work_type in ('PRIVACY_RETENTION_CLEANUP', 'SOURCE_HEALTH_ROLLUP')
    and source_id is null and github_repository_id is null
    and public_web_search_query_id is null and public_web_candidate_id is null)
);

-- Configured careers URLs are the first durable, zero-cost source graph edges.
with configured as (
  select company.id company_id, company.canonical_name, company.careers_url,
    lower(substring(company.careers_url from '^https?://([^/:]+)')) hostname,
    company.id::text || ':' || encode(digest(company.careers_url, 'sha256'), 'hex') external_key
  from public.companies company where company.careers_url is not null
)
insert into public.sources (
  company_id, source_type, provider, external_key, name, base_url,
  reliability, enabled, metadata, source_policy_id, discovery_method,
  first_seen_at, discovery_confidence, discovery_fingerprint, discovery_provenance
)
select configured.company_id, 'COMPANY_CAREERS', 'public_web', configured.external_key,
  configured.canonical_name || ' configured careers page', configured.careers_url,
  1.000, public.executable_source_policy_for_hostname(configured.hostname) is not null,
  '{"configured_company_careers_url":true}'::jsonb,
  public.executable_source_policy_for_hostname(configured.hostname), 'CONFIGURED', now(), 1.000,
  encode(digest(
    'direct-source:v1:' || configured.company_id::text || ':public_web:'
      || configured.external_key || ':' || configured.careers_url,
    'sha256'
  ), 'hex'),
  jsonb_build_object('evidence', 'company.careers_url')
from configured
on conflict (provider, external_key) do update set
  source_type = 'COMPANY_CAREERS',
  discovery_confidence = greatest(public.sources.discovery_confidence, 1.000),
  discovery_provenance = public.sources.discovery_provenance
    || '{"evidence":"company.careers_url"}'::jsonb;

insert into public.public_web_candidates (
  company_id, source_id, source_provider, original_url, canonical_url, title, snippet
)
select source.company_id, source.id, 'direct', source.base_url, source.base_url,
  source.name, 'Configured company careers URL'
from public.sources source
where source.discovery_provenance @> '{"evidence":"company.careers_url"}'::jsonb
on conflict (company_id, canonical_url) do update set source_id = excluded.source_id;

insert into public.schedules (
  name, work_type, work_class, public_web_candidate_id, enabled,
  schedule_kind, interval_seconds, anchor_at, next_run_at,
  jitter_seconds, priority, max_attempts, retry_policy
)
select 'direct-web:' || candidate.id::text, 'PUBLIC_WEB_FETCH', 'WEB_FETCH', candidate.id,
  public.source_policy_is_executable(candidate.source_id), 'INTERVAL', 21600,
  now(), now() + interval '6 hours', 900, 45, 3, 'EXPONENTIAL_V1'
from public.public_web_candidates candidate
join public.sources source on source.id = candidate.source_id
where source.discovery_method = 'CONFIGURED' and source.source_type = 'COMPANY_CAREERS'
on conflict (name) do nothing;

-- When no careers URL is configured, one known company homepage is a bounded discovery
-- seed. Its permitted fetch can reveal career/ATS links without a search provider.
with configured as (
  select company.id company_id, company.canonical_name, company.website,
    lower(substring(company.website from '^https?://([^/:]+)')) hostname,
    company.id::text || ':' || encode(digest(company.website, 'sha256'), 'hex') external_key
  from public.companies company
  where company.careers_url is null and company.website is not null
)
insert into public.sources (
  company_id, source_type, provider, external_key, name, base_url,
  reliability, enabled, metadata, source_policy_id, discovery_method,
  first_seen_at, discovery_confidence, discovery_fingerprint, discovery_provenance
)
select configured.company_id, 'PUBLIC_WEB', 'public_web', configured.external_key,
  configured.canonical_name || ' direct-discovery seed', configured.website,
  0.800, public.executable_source_policy_for_hostname(configured.hostname) is not null,
  '{"direct_discovery_seed":true}'::jsonb,
  public.executable_source_policy_for_hostname(configured.hostname), 'CONFIGURED', now(), 0.800,
  encode(digest(
    'direct-source:v1:' || configured.company_id::text || ':public_web:'
      || configured.external_key || ':' || configured.website,
    'sha256'
  ), 'hex'),
  jsonb_build_object('evidence', 'company.website')
from configured
on conflict (provider, external_key) do update set
  discovery_confidence = greatest(public.sources.discovery_confidence, 0.800),
  discovery_provenance = public.sources.discovery_provenance
    || '{"evidence":"company.website"}'::jsonb;

insert into public.public_web_candidates (
  company_id, source_id, source_provider, original_url, canonical_url, title, snippet
)
select source.company_id, source.id, 'direct', source.base_url, source.base_url,
  source.name, 'Configured company homepage discovery seed'
from public.sources source
where source.discovery_provenance @> '{"evidence":"company.website"}'::jsonb
on conflict (company_id, canonical_url) do update set source_id = excluded.source_id;

insert into public.schedules (
  name, work_type, work_class, public_web_candidate_id, enabled,
  schedule_kind, interval_seconds, anchor_at, next_run_at,
  jitter_seconds, priority, max_attempts, retry_policy
)
select 'direct-web:' || candidate.id::text, 'PUBLIC_WEB_FETCH', 'WEB_FETCH', candidate.id,
  public.source_policy_is_executable(candidate.source_id), 'INTERVAL', 604800,
  now(), now() + interval '7 days', 3600, 25, 3, 'EXPONENTIAL_V1'
from public.public_web_candidates candidate
join public.sources source on source.id = candidate.source_id
where source.discovery_method = 'CONFIGURED' and source.source_type = 'PUBLIC_WEB'
  and source.discovery_provenance @> '{"evidence":"company.website"}'::jsonb
on conflict (name) do nothing;

-- Keep company configuration and the durable source graph aligned for companies created or
-- corrected after migration 0009. This creates only one bounded seed: careers URL first, otherwise
-- the canonical company homepage. It never performs network I/O or creates recruiting facts.
create function public.refresh_company_direct_discovery_seed(target_company_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  company public.companies%rowtype;
  seed_url text;
  seed_hostname text;
  seed_external_key text;
  seed_name text;
  seed_type public.source_type;
  seed_evidence text;
  seed_confidence numeric(4, 3);
  seed_interval integer;
  seed_jitter integer;
  seed_priority smallint;
  target_source_id uuid;
  target_candidate_id uuid;
begin
  select * into company from public.companies where id = target_company_id;
  if not found then return 0; end if;

  if company.careers_url is not null then
    seed_url := company.careers_url;
    seed_name := company.canonical_name || ' configured careers page';
    seed_type := 'COMPANY_CAREERS';
    seed_evidence := 'company.careers_url';
    seed_confidence := 1.000;
    seed_interval := 21600;
    seed_jitter := 900;
    seed_priority := 45;
  elsif company.website is not null then
    seed_url := company.website;
    seed_name := company.canonical_name || ' direct-discovery seed';
    seed_type := 'PUBLIC_WEB';
    seed_evidence := 'company.website';
    seed_confidence := 0.800;
    seed_interval := 604800;
    seed_jitter := 3600;
    seed_priority := 25;
  else
    update public.sources set enabled = false
    where company_id = target_company_id and provider = 'public_web'
      and discovery_method = 'CONFIGURED'
      and discovery_provenance ->> 'evidence' in ('company.careers_url', 'company.website');
    update public.schedules schedule set enabled = false, updated_at = now()
    from public.public_web_candidates candidate
    join public.sources source on source.id = candidate.source_id
    where schedule.public_web_candidate_id = candidate.id
      and source.company_id = target_company_id
      and source.discovery_method = 'CONFIGURED'
      and source.discovery_provenance ->> 'evidence'
        in ('company.careers_url', 'company.website');
    return 0;
  end if;

  seed_hostname := lower(substring(seed_url from '^https?://([^/:]+)'));
  seed_external_key := company.id::text || ':' || encode(digest(seed_url, 'sha256'), 'hex');

  update public.sources set enabled = false
  where company_id = target_company_id and provider = 'public_web'
    and discovery_method = 'CONFIGURED' and base_url is distinct from seed_url
    and discovery_provenance ->> 'evidence' in ('company.careers_url', 'company.website');
  update public.schedules schedule set enabled = false, updated_at = now()
  from public.public_web_candidates candidate
  join public.sources source on source.id = candidate.source_id
  where schedule.public_web_candidate_id = candidate.id
    and source.company_id = target_company_id
    and source.discovery_method = 'CONFIGURED' and source.base_url is distinct from seed_url
    and source.discovery_provenance ->> 'evidence' in ('company.careers_url', 'company.website');

  insert into public.sources (
    company_id, source_type, provider, external_key, name, base_url,
    reliability, enabled, metadata, source_policy_id, discovery_method,
    first_seen_at, discovery_confidence, discovery_fingerprint, discovery_provenance
  ) values (
    company.id, seed_type, 'public_web', seed_external_key, seed_name, seed_url,
    seed_confidence,
    public.executable_source_policy_for_hostname(seed_hostname) is not null,
    jsonb_build_object('configured_direct_discovery_seed', true),
    public.executable_source_policy_for_hostname(seed_hostname), 'CONFIGURED', now(),
    seed_confidence,
    encode(digest(
      'direct-source:v1:' || company.id::text || ':public_web:'
        || seed_external_key || ':' || seed_url,
      'sha256'
    ), 'hex'),
    jsonb_build_object('evidence', seed_evidence)
  )
  on conflict (provider, external_key) do update set
    source_type = excluded.source_type,
    name = excluded.name,
    base_url = excluded.base_url,
    reliability = greatest(public.sources.reliability, excluded.reliability),
    enabled = excluded.enabled,
    metadata = public.sources.metadata || excluded.metadata,
    source_policy_id = coalesce(excluded.source_policy_id, public.sources.source_policy_id),
    last_verified_at = coalesce(excluded.last_verified_at, public.sources.last_verified_at),
    discovery_confidence = greatest(
      public.sources.discovery_confidence, excluded.discovery_confidence
    ),
    discovery_provenance = excluded.discovery_provenance
  returning id into target_source_id;

  insert into public.public_web_candidates (
    company_id, source_id, source_provider, original_url, canonical_url, title, snippet
  ) values (
    company.id, target_source_id, 'direct', seed_url, seed_url, seed_name,
    case when seed_evidence = 'company.careers_url'
      then 'Configured company careers URL'
      else 'Configured company homepage discovery seed' end
  )
  on conflict (company_id, canonical_url) do update set
    source_id = excluded.source_id, last_seen_at = excluded.last_seen_at,
    title = excluded.title, snippet = excluded.snippet
  returning id into target_candidate_id;

  insert into public.schedules (
    name, work_type, work_class, public_web_candidate_id, enabled,
    schedule_kind, interval_seconds, anchor_at, next_run_at,
    jitter_seconds, priority, max_attempts, retry_policy
  ) values (
    'direct-web:' || target_candidate_id::text, 'PUBLIC_WEB_FETCH', 'WEB_FETCH',
    target_candidate_id, public.source_policy_is_executable(target_source_id),
    'INTERVAL', seed_interval, now(), now() + make_interval(secs => seed_interval),
    seed_jitter, seed_priority, 3, 'EXPONENTIAL_V1'
  ) on conflict (name) do update set
    public_web_candidate_id = excluded.public_web_candidate_id,
    enabled = excluded.enabled,
    interval_seconds = excluded.interval_seconds,
    jitter_seconds = excluded.jitter_seconds,
    priority = excluded.priority,
    updated_at = now();
  return 1;
end;
$$;
revoke all on function public.refresh_company_direct_discovery_seed(uuid) from public;

create function public.sync_company_direct_discovery_seed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_company_direct_discovery_seed(new.id);
  return new;
end;
$$;
create trigger companies_sync_direct_discovery_seed
after insert or update of website, careers_url on public.companies
for each row execute function public.sync_company_direct_discovery_seed();
revoke all on function public.sync_company_direct_discovery_seed() from public;

do $$
declare company_record record;
begin
  for company_record in select id from public.companies loop
    perform public.refresh_company_direct_discovery_seed(company_record.id);
  end loop;
end;
$$;

create or replace function public.enqueue_due_schedules(schedule_limit integer default 100)
returns integer language plpgsql security definer set search_path = public as $$
declare
  binding public.worker_role_bindings%rowtype;
  principal public.service_principals%rowtype;
  schedule public.schedules;
  logical_due timestamptz;
  available_time timestamptz;
  fingerprint text;
  correlation uuid;
  inserted_count integer := 0;
begin
  select * into binding from public.worker_role_bindings where database_role = session_user;
  if not found or not binding.can_schedule then
    raise exception 'SCHEDULER_ROLE_NOT_BOUND' using errcode = '42501';
  end if;
  select * into principal from public.service_principals
  where id = binding.service_principal_id and kind = 'WORKER' and status = 'ACTIVE'
    and (expires_at is null or expires_at > now())
    and 'WORKER_SCHEDULER' = any(scopes);
  if not found then
    raise exception 'SCHEDULER_SERVICE_PRINCIPAL_INACTIVE' using errcode = '42501';
  end if;
  for schedule in
    select * from public.schedules where enabled and next_run_at <= now()
    order by next_run_at, priority desc, id for update skip locked limit schedule_limit
  loop
    logical_due := schedule.next_run_at;
    if schedule.source_id is not null
       and not public.source_policy_is_executable(schedule.source_id) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    if schedule.github_repository_id is not null and not exists (
      select 1 from public.github_repositories repository
      join public.sources source on source.id = repository.source_id
      where repository.id = schedule.github_repository_id
        and public.source_policy_is_executable(source.id)
    ) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    if schedule.public_web_search_query_id is not null and not exists (
      select 1 from public.public_web_search_queries query
      where query.id = schedule.public_web_search_query_id
        and public.source_policy_is_executable(query.source_id)
    ) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    if schedule.public_web_candidate_id is not null and not exists (
      select 1 from public.public_web_candidates candidate
      where candidate.id = schedule.public_web_candidate_id
        and public.source_policy_is_executable(candidate.source_id)
    ) then
      update public.schedules set enabled = false, updated_at = now() where id = schedule.id;
      continue;
    end if;
    available_time := logical_due + make_interval(secs => case when schedule.jitter_seconds = 0
      then 0 else mod(get_byte(digest(schedule.id::text || ':' || logical_due::text, 'sha256'), 0),
                        schedule.jitter_seconds + 1) end);
    fingerprint := encode(digest(
      'schedule:' || schedule.id::text || ':' || logical_due::text, 'sha256'
    ), 'hex');
    correlation := gen_random_uuid();

    if schedule.work_type = 'ATS_COLLECT' then
      insert into public.work_items (
        work_type, work_class, schedule_id, source_id, priority, scheduled_at,
        available_at, max_attempts, retry_policy, idempotency_fingerprint,
        exclusive_key, correlation_id
      ) values (
        schedule.work_type, schedule.work_class, schedule.id, schedule.source_id,
        schedule.priority, logical_due, available_time, schedule.max_attempts,
        schedule.retry_policy, fingerprint, 'ats-source:' || schedule.source_id::text,
        correlation
      ) on conflict do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    elsif schedule.work_type = 'GITHUB_SYNC' then
      insert into public.github_sync_requests (
        github_repository_id, requested_by, max_attempts, metadata
      ) values (
        schedule.github_repository_id, 'scheduler', schedule.max_attempts,
        jsonb_build_object(
          'schedule_id', schedule.id, 'scheduled_for', logical_due,
          'available_at', available_time, 'work_fingerprint', fingerprint,
          'priority', schedule.priority, 'correlation_id', correlation
        )
      ) on conflict (github_repository_id)
        where status in ('PENDING', 'RUNNING') do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    elsif schedule.work_type = 'PUBLIC_WEB_SEARCH' then
      insert into public.public_web_work_requests (
        work_type, company_id, search_query_id, requested_by, max_attempts, metadata
      ) select 'WEB_SEARCH', query.company_id, query.id, 'scheduler', schedule.max_attempts,
        jsonb_build_object(
          'schedule_id', schedule.id, 'scheduled_for', logical_due,
          'available_at', greatest(available_time, coalesce(query.next_allowed_run_at, available_time)),
          'work_fingerprint', fingerprint, 'priority', schedule.priority,
          'correlation_id', correlation
        )
      from public.public_web_search_queries query
      where query.id = schedule.public_web_search_query_id
        and coalesce(query.next_allowed_run_at, available_time) <= now()
      on conflict (work_type, search_query_id)
        where status in ('PENDING', 'RUNNING') and work_type = 'WEB_SEARCH' do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    elsif schedule.work_type = 'PUBLIC_WEB_FETCH' then
      insert into public.public_web_work_requests (
        work_type, company_id, candidate_id, requested_by, max_attempts, metadata
      ) select 'WEB_FETCH', candidate.company_id, candidate.id, 'direct-scheduler',
        schedule.max_attempts,
        jsonb_build_object(
          'schedule_id', schedule.id, 'scheduled_for', logical_due,
          'available_at', available_time, 'work_fingerprint', fingerprint,
          'priority', schedule.priority, 'correlation_id', correlation
        )
      from public.public_web_candidates candidate
      where candidate.id = schedule.public_web_candidate_id
      on conflict (work_type, candidate_id)
        where status in ('PENDING', 'RUNNING')
          and work_type in ('WEB_FETCH', 'WEB_PROCESS') do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    else
      insert into public.work_items (
        work_type, work_class, schedule_id, priority, scheduled_at, available_at,
        max_attempts, retry_policy, idempotency_fingerprint, correlation_id
      ) values (
        schedule.work_type, schedule.work_class, schedule.id, schedule.priority,
        logical_due, available_time, schedule.max_attempts, schedule.retry_policy,
        fingerprint, correlation
      ) on conflict (idempotency_fingerprint) do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    end if;

    update public.schedules set last_enqueued_for = logical_due,
      next_run_at = case when schedule.schedule_kind = 'INTERVAL'
        then logical_due + make_interval(secs => schedule.interval_seconds * (
          floor(greatest(0, extract(epoch from (now() - logical_due)))
            / schedule.interval_seconds)::integer + 1
        ))
        else public.next_daily_occurrence(
          greatest(logical_due, now()), schedule.daily_local_time, schedule.timezone
        ) end,
      updated_at = now()
    where id = schedule.id;
  end loop;
  return inserted_count;
end;
$$;

comment on column public.sources.discovery_fingerprint is
  'Idempotent durable SourceEndpoint identity; domain facts remain in domain tables.';
comment on column public.search_provider_usage_daily.paid_spend_micros is
  'Actual locally authorized paid spend. It remains zero in canonical zero-cost mode.';
