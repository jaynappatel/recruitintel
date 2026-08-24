import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
parsed.pathname = "/postgres";
const databaseName = `recruitintel_m9_migration_test_${process.pid}`;
if (!/^recruitintel_m9_migration_test_\d+$/.test(databaseName)) {
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
    "0008_search_provider_foundation.sql",
  ]);

  const [company] = await database`
    insert into public.companies (
      canonical_name, slug, website, careers_url, ats_type, ats_identifier
    ) values (
      'Zero Cost Migration Fixture', 'zero-cost-migration-fixture',
      'https://example.com', 'https://example.com/careers', 'GREENHOUSE', 'zero-cost-fixture'
    ) returning id
  `;
  const [legacySource] = await database`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, base_url,
      enabled, source_policy_id
    ) values (
      ${company.id}, 'ATS', 'greenhouse', 'zero-cost-fixture',
      'Existing Greenhouse source', 'https://boards.greenhouse.io/zero-cost-fixture',
      true, (select id from public.source_policies where provider = 'greenhouse')
    ) returning id, created_at
  `;

  await apply(database, ["0009_zero_cost_discovery.sql"]);

  const [legacyAfter] = await database`
    select discovery_method::text, first_seen_at, discovery_confidence,
      discovery_fingerprint
    from public.sources where id = ${legacySource.id}
  `;
  if (
    legacyAfter.discovery_method !== "CONFIGURED" ||
    legacyAfter.first_seen_at.toISOString() !== legacySource.created_at.toISOString() ||
    !/^[0-9a-f]{64}$/.test(legacyAfter.discovery_fingerprint)
  ) {
    throw new Error("legacy source provenance was not preserved/backfilled");
  }

  const [careerGraph] = await database`
    select source.id, source.discovery_method::text, source.discovery_provenance,
      candidate.id as candidate_id, schedule.id as schedule_id
    from public.sources source
    join public.public_web_candidates candidate on candidate.source_id = source.id
    join public.schedules schedule on schedule.public_web_candidate_id = candidate.id
    where source.company_id = ${company.id}
      and source.source_type = 'COMPANY_CAREERS'
      and source.discovery_provenance @> '{"evidence":"company.careers_url"}'::jsonb
  `;
  if (
    careerGraph.discovery_method !== "CONFIGURED" ||
    !careerGraph.candidate_id ||
    !careerGraph.schedule_id
  ) {
    throw new Error("configured careers URL did not become durable source knowledge");
  }

  const [compatibleSource] = await database`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, enabled, source_policy_id
    ) values (
      ${company.id}, 'MANUAL', 'manual', 'post-0009-source-writer',
      'Existing source-writer compatibility fixture', false,
      (select id from public.source_policies where provider = 'manual')
    ) returning discovery_method::text, discovery_fingerprint
  `;
  if (
    compatibleSource.discovery_method !== "MANUAL" ||
    !/^[0-9a-f]{64}$/.test(compatibleSource.discovery_fingerprint)
  ) {
    throw new Error("legacy source writers do not receive safe source-graph defaults");
  }

  const [postMigrationCompany] = await database`
    insert into public.companies (canonical_name, slug, website)
    values ('Post Migration Source Fixture', 'post-migration-source-fixture',
      'https://post-migration.example')
    returning id
  `;
  const [postMigrationSeed] = await database`
    select source.id, candidate.id as candidate_id, schedule.id as schedule_id
    from public.sources source
    join public.public_web_candidates candidate on candidate.source_id = source.id
    join public.schedules schedule on schedule.public_web_candidate_id = candidate.id
    where source.company_id = ${postMigrationCompany.id}
      and source.discovery_provenance @> '{"evidence":"company.website"}'::jsonb
  `;
  if (!postMigrationSeed?.id || !postMigrationSeed.candidate_id || !postMigrationSeed.schedule_id) {
    throw new Error("post-migration company did not enter the direct source graph");
  }

  const [providerState] = await database`
    select
      (select status::text from public.source_policies where provider = 'searxng')
        as searxng_status,
      (select terms_status from public.source_policies where provider = 'searxng')
        as searxng_terms,
      (select enabled from public.search_provider_budgets
        where provider = 'searxng' and credential_slot = 'local') as searxng_budget_enabled,
      (select status::text from public.source_policies where provider = 'you') as you_status,
      (select enabled from public.search_provider_budgets
        where provider = 'you' and credential_slot = 'default') as you_budget_enabled,
      (select zero_cost_eligible from public.search_provider_budgets
        where provider = 'you' and credential_slot = 'default') as you_zero_cost_eligible
  `;
  if (
    providerState.searxng_status !== "REVIEW_REQUIRED" ||
    providerState.searxng_terms !== "NOT_REVIEWED" ||
    providerState.searxng_budget_enabled ||
    providerState.you_status !== "REVIEW_REQUIRED" ||
    providerState.you_budget_enabled ||
    providerState.you_zero_cost_eligible
  ) {
    throw new Error("optional search providers were incorrectly production-enabled");
  }

  const [principal] = await database`
    insert into public.service_principals (
      name, kind, token_prefix, token_hash, scopes, status
    ) values (
      'Zero-cost budget migration worker', 'WORKER', 'ri_worker_ZeroCostSmoke',
      encode(digest('zero-cost-budget-smoke', 'sha256'), 'hex'),
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
    update public.search_provider_budgets set
      daily_request_limit = 1, monthly_request_limit = 10,
      monthly_estimated_cost_limit_micros = 0,
      monthly_paid_spend_limit_micros = 0,
      estimated_cost_per_call_micros = 0,
      cost_category = 'FREE', zero_cost_eligible = true, enabled = true
    where provider = 'searxng' and credential_slot = 'local'
  `;

  const reservations = await Promise.all([
    database`select * from public.reserve_search_provider_usage(
      'searxng', 'local', 1, 0, 0, true
    )`,
    concurrentDatabase`select * from public.reserve_search_provider_usage(
      'searxng', 'local', 1, 0, 0, true
    )`,
  ]);
  const outcomes = reservations.flat();
  if (outcomes.filter((item) => item.reserved).length !== 1) {
    throw new Error("concurrent free-provider budget allowed multiple reservations");
  }
  if (outcomes.filter((item) => item.denial_reason === "DAILY_REQUEST_LIMIT").length !== 1) {
    throw new Error("free-provider budget did not fail closed at its local cap");
  }

  await database`
    update public.search_provider_budgets set enabled = true
    where provider = 'you' and credential_slot = 'default'
  `;
  const [paidAttempt] = await database`
    select * from public.reserve_search_provider_usage('you', 'default', 1, 5000, 5000, true)
  `;
  if (paidAttempt.reserved || paidAttempt.denial_reason !== "ZERO_COST_MODE") {
    throw new Error("zero-cost mode did not reject paid provider execution");
  }
  const [paidUsage] = await database`
    select coalesce(sum(paid_spend_micros), 0)::bigint as paid
    from public.search_provider_usage_daily where provider = 'you'
  `;
  if (Number(paidUsage.paid) !== 0) {
    throw new Error("zero-cost mode recorded paid provider spend");
  }

  console.log(
    JSON.stringify({
      status: "ok",
      migration: "0008 -> 0009",
      legacySourcesPreserved: true,
      durableCareerSource: true,
      sourceWriterCompatible: true,
      postMigrationCompanySynchronized: true,
      optionalProvidersDisabled: true,
      concurrentFreeBudgetSafe: true,
      paidExecutionRejected: true,
      paidSpendMicros: 0,
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
