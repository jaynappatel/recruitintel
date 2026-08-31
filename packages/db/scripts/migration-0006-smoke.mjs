import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
parsed.pathname = "/postgres";
const databaseName = `recruitintel_m6_migration_test_${process.pid}`;
if (!/^recruitintel_m6_migration_test_\d+$/.test(databaseName)) {
  throw new Error("Unsafe migration test database name");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "migrations");
const seedPath = resolve(packageRoot, "seeds", "001_development.sql");
const admin = postgres(parsed.toString(), { max: 1 });
let database;

try {
  await admin.unsafe(`create database "${databaseName}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  database = postgres(testUrl.toString(), { max: 1, onnotice: () => {} });

  for (const name of [
    "0001_core.sql",
    "0002_github_interview_intelligence.sql",
    "0003_public_web_intelligence.sql",
    "0004_recruiter_campus_intelligence.sql",
    "0005_recruiting_calendar.sql",
  ]) {
    await database.unsafe(await readFile(resolve(migrationsRoot, name), "utf8"));
  }
  await database.unsafe(await readFile(seedPath, "utf8"));

  const legacyUserId = "00000000-0000-4000-8000-000000000001";
  const privateDateId = "96000000-0000-4000-8000-000000000001";
  const planId = "96000000-0000-4000-8000-000000000002";
  const itemId = "96000000-0000-4000-8000-000000000003";
  const connectionId = "96000000-0000-4000-8000-000000000004";
  const requestId = "96000000-0000-4000-8000-000000000005";
  const ciphertext = "v1.byte-for-byte-google-refresh-ciphertext";
  const [company] = await database`select id from public.companies order by id limit 1`;
  const [job] = await database`
    select id from public.jobs where company_id = ${company.id} order by id limit 1
  `;

  await database.begin(async (sql) => {
    await sql`
      insert into public.recruiting_dates (
        id, owner_id, company_id, job_id, type, title, starts_at, starts_on,
        all_day, timezone, date_certainty, date_precision, source_kind, source_fingerprint
      ) values (
        ${privateDateId}, ${legacyUserId}, ${company.id}, ${job?.id ?? null},
        'APPLICATION_OPEN', 'Legacy opening', '2026-09-01T05:00:00Z', '2026-09-01',
        true, 'America/Chicago', 'USER_CREATED', 'EXACT', 'USER', ${"a".repeat(64)}
      )
    `;
    await sql`
      insert into public.application_plans (
        id, owner_id, company_id, job_id, recruiting_date_id, title, target_date,
        timezone, plan_fingerprint
      ) values (
        ${planId}, ${legacyUserId}, ${company.id}, ${job?.id ?? null}, ${privateDateId},
        'Legacy plan', '2026-09-01', 'America/Chicago', ${"b".repeat(64)}
      )
    `;
    await sql`
      insert into public.calendar_items (
        id, owner_id, company_id, job_id, application_plan_id,
        type, title, starts_at, all_day, timezone, source, sync_enabled
      ) values (
        ${itemId}, ${legacyUserId}, ${company.id}, ${job?.id ?? null}, ${planId},
        'APPLICATION_TASK', 'Apply', '2026-09-01T14:00:00Z', false,
        'America/Chicago', 'APPLICATION_PLAN', true
      )
    `;
    await sql`
      insert into public.application_plan_tasks (
        application_plan_id, calendar_item_id, sequence, relative_day_offset,
        task_type, generated_reason
      ) values (${planId}, ${itemId}, 0, 0, 'APPLICATION_TASK', 'Target date')
    `;
    await sql`
      insert into public.calendar_connections (
        id, owner_id, provider, provider_account_id, provider_email,
        encrypted_refresh_token, scopes, connection_status
      ) values (
        ${connectionId}, ${legacyUserId}, 'GOOGLE', 'google-sub', 'legacy@example.com',
        ${ciphertext}, array['openid', 'https://www.googleapis.com/auth/calendar.events.owned'],
        'CONNECTED'
      )
    `;
    await sql`
      insert into public.calendar_oauth_states (
        owner_id, provider, state_hash, encrypted_code_verifier, expires_at
      ) values (
        ${legacyUserId}, 'GOOGLE', ${"c".repeat(64)}, 'encrypted-pkce', now() + interval '1 hour'
      )
    `;
    await sql`
      insert into public.calendar_external_events (
        calendar_item_id, calendar_connection_id, provider, external_calendar_id,
        external_event_id, sync_status
      ) values (${itemId}, ${connectionId}, 'GOOGLE', 'primary', 'external-1', 'SYNCED')
    `;
    await sql`
      insert into public.calendar_sync_requests (id, calendar_connection_id, requested_by_owner_id)
      values (${requestId}, ${connectionId}, ${legacyUserId})
    `;
    await sql`
      insert into public.calendar_sync_runs (
        calendar_sync_request_id, calendar_connection_id, status
      ) values (${requestId}, ${connectionId}, 'RUNNING')
    `;
  });

  await database.unsafe(
    await readFile(
      resolve(migrationsRoot, "0006_identity_privacy_audit_instrumentation.sql"),
      "utf8",
    ),
  );

  const [survival] = await database`
    select c.encrypted_refresh_token,
      (select count(*)::int from public.application_plans where user_id = ${legacyUserId}) as plans,
      (select count(*)::int from public.calendar_items where user_id = ${legacyUserId}) as items,
      (select count(*)::int from public.calendar_external_events where user_id = ${legacyUserId}) as mappings,
      (select count(*)::int from public.calendar_sync_requests where user_id = ${legacyUserId}) as requests,
      (select count(*)::int from public.calendar_sync_runs where user_id = ${legacyUserId}) as runs
    from public.calendar_connections c where c.id = ${connectionId}
  `;
  if (survival.encrypted_refresh_token !== ciphertext) {
    throw new Error("Google credential ciphertext changed during 0006");
  }
  for (const field of ["plans", "items", "mappings", "requests", "runs"]) {
    if (survival[field] !== 1) throw new Error(`Private ${field} did not survive 0006`);
  }

  const [orphans] = await database`
    select
      (select count(*) from public.application_plans p left join public.users u on u.id = p.user_id
        where u.id is null) +
      (select count(*) from public.calendar_items i left join public.users u on u.id = i.user_id
        where u.id is null) +
      (select count(*) from public.calendar_connections c left join public.users u on u.id = c.user_id
        where u.id is null) as count
  `;
  if (Number(orphans.count) !== 0) throw new Error("0006 orphaned private rows");

  console.log(
    JSON.stringify({
      status: "ok",
      migration: "0005 -> 0006",
      ciphertextPreserved: true,
      privateRowsPreserved: true,
      orphanCount: 0,
    }),
  );
} finally {
  if (database) await database.end({ timeout: 5 });
  await admin`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${databaseName} and pid <> pg_backend_pid()
  `;
  await admin.unsafe(`drop database if exists "${databaseName}"`);
  await admin.end({ timeout: 5 });
}
