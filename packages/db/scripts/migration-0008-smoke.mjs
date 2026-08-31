import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
parsed.pathname = "/postgres";
const databaseName = `recruitintel_m8_migration_test_${process.pid}`;
if (!/^recruitintel_m8_migration_test_\d+$/.test(databaseName)) {
  throw new Error("Unsafe migration test database name");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "migrations");
const admin = postgres(parsed.toString(), { max: 1 });
let database;
let concurrentDatabase;

async function apply(databaseClient, names) {
  for (const name of names) {
    await databaseClient.unsafe(await readFile(resolve(migrationsRoot, name), "utf8"));
  }
}

try {
  await admin.unsafe(`create database "${databaseName}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  database = postgres(testUrl.toString(), { max: 4, onnotice: () => {} });
  concurrentDatabase = postgres(testUrl.toString(), { max: 2, onnotice: () => {} });

  await apply(database, [
    "0001_core.sql",
    "0002_github_interview_intelligence.sql",
    "0003_public_web_intelligence.sql",
    "0004_recruiter_campus_intelligence.sql",
    "0005_recruiting_calendar.sql",
    "0006_identity_privacy_audit_instrumentation.sql",
    "0007_durable_orchestration_source_governance.sql",
  ]);

  const [company] = await database`
    insert into public.companies (canonical_name, slug)
    values ('Gate 7.1A migration fixture', 'gate-7-1a-migration-fixture')
    returning id
  `;
  const [source] = await database`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, enabled, source_policy_id
    ) values (
      ${company.id}, 'PUBLIC_WEB', 'web_search', 'static:gate-7-1a',
      'Static search migration fixture', true,
      (select id from public.source_policies where provider = 'web_search')
    ) returning id
  `;
  const [query] = await database`
    insert into public.public_web_search_queries (
      company_id, source_id, provider, template_key, query
    ) values (
      ${company.id}, ${source.id}, 'static', 'migration', 'migration fixture query'
    ) returning id
  `;

  await apply(database, ["0008_search_provider_foundation.sql"]);

  const [linkage] = await database`
    select query.provider, policy.provider as policy_provider,
      source.source_policy_id = query.provider_policy_id as source_matches
    from public.public_web_search_queries query
    join public.source_policies policy on policy.id = query.provider_policy_id
    join public.sources source on source.id = query.source_id
    where query.id = ${query.id}
  `;
  if (linkage.provider !== "static" || linkage.policy_provider !== "static") {
    throw new Error("search query was not migrated to its selected provider policy");
  }
  if (!linkage.source_matches) throw new Error("search source/provider policy linkage diverged");

  const [youPolicy] = await database`
    select status::text, terms_status, reviewed_at
    from public.source_policies where provider = 'you'
  `;
  if (
    youPolicy.status !== "REVIEW_REQUIRED" ||
    youPolicy.terms_status !== "NOT_REVIEWED" ||
    youPolicy.reviewed_at !== null
  ) {
    throw new Error("You.com policy was incorrectly approved by migration 0008");
  }
  const [youBudget] = await database`
    select enabled from public.search_provider_budgets
    where provider = 'you' and credential_slot = 'default'
  `;
  if (youBudget.enabled) throw new Error("You.com production budget was enabled");

  const [principal] = await database`
    insert into public.service_principals (
      name, kind, token_prefix, token_hash, scopes, status
    ) values (
      'Gate 7.1A migration worker', 'WORKER', 'ri_worker_SearchSmoke',
      encode(digest('gate-7-1a-search-smoke', 'sha256'), 'hex'),
      array['WORKER_INGEST', 'WORKER_GLOBAL']::public.service_scope[], 'ACTIVE'
    ) returning id
  `;
  await database`
    insert into public.worker_role_bindings (
      database_role, service_principal_id, allowed_work_classes, can_schedule
    ) values (current_user, ${principal.id}, array['WEB_SEARCH']::public.work_class[], false)
    on conflict (database_role) do update set
      service_principal_id = excluded.service_principal_id,
      allowed_work_classes = excluded.allowed_work_classes,
      can_schedule = false
  `;
  await database`
    insert into public.search_provider_budgets (
      provider, credential_slot, daily_request_limit,
      monthly_estimated_cost_limit_micros, estimated_cost_per_call_micros, enabled
    ) values ('you', 'smoke', 1, 10000, 5000, true)
  `;
  const reservations = await Promise.all([
    database`select * from public.reserve_search_provider_usage('you', 'smoke', 1, 5000)`,
    concurrentDatabase`select * from public.reserve_search_provider_usage('you', 'smoke', 1, 5000)`,
  ]);
  const outcomes = reservations.flat();
  if (outcomes.filter((item) => item.reserved).length !== 1) {
    throw new Error("concurrent daily budget allowed more than one reservation");
  }
  if (outcomes.filter((item) => item.denial_reason === "DAILY_REQUEST_LIMIT").length !== 1) {
    throw new Error("concurrent daily budget did not return a deterministic denial");
  }

  await database`
    update public.source_policies set
      status = 'ALLOWED_WITH_LIMITS', terms_status = 'REVIEWED',
      reviewed_at = now(), reviewed_by = 'migration-smoke'
    where provider = 'static'
  `;
  const [request] = await database`
    insert into public.public_web_work_requests (
      work_type, company_id, search_query_id, requested_by
    ) values ('WEB_SEARCH', ${company.id}, ${query.id}, 'migration-smoke')
    returning id
  `;
  const [claimed] = await database`
    select * from public.claim_work_items(
      'search-provider-smoke', array['WEB_SEARCH']::public.work_class[], 1, 300
    )
  `;
  const [attempt] = await database`
    select provider from public.work_attempts
    where work_item_id = ${claimed.id} and work_item_id = (
      select id from public.work_items where public_web_work_request_id = ${request.id}
    )
  `;
  if (attempt.provider !== "static") {
    throw new Error("search attempt telemetry did not use the selected provider");
  }

  let mismatchRejected = false;
  try {
    await database`
      update public.public_web_search_queries set provider = 'you' where id = ${query.id}
    `;
  } catch (error) {
    mismatchRejected = error?.code === "23514";
  }
  if (!mismatchRejected) throw new Error("query/provider policy mismatch was accepted");

  console.log(
    JSON.stringify({
      status: "ok",
      migration: "0007 -> 0008",
      providerPolicyLinked: true,
      youPolicyReviewRequired: true,
      youBudgetDisabled: true,
      concurrentBudgetSafe: true,
      selectedProviderTelemetry: true,
      providerMismatchRejected: true,
    }),
  );
} finally {
  if (concurrentDatabase) await concurrentDatabase.end({ timeout: 5 });
  if (database) await database.end({ timeout: 5 });
  await admin`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${databaseName} and pid <> pg_backend_pid()
  `;
  await admin.unsafe(`drop database if exists "${databaseName}"`);
  await admin.end({ timeout: 5 });
}
