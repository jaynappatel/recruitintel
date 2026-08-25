import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
parsed.pathname = "/postgres";
const databaseName = `recruitintel_m10_migration_test_${process.pid}`;
if (!/^recruitintel_m10_migration_test_\d+$/.test(databaseName)) {
  throw new Error("Unsafe migration test database name");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "migrations");
const admin = postgres(parsed.toString(), { max: 1 });
let database;

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

  await apply(database, [
    "0001_core.sql",
    "0002_github_interview_intelligence.sql",
    "0003_public_web_intelligence.sql",
    "0004_recruiter_campus_intelligence.sql",
    "0005_recruiting_calendar.sql",
    "0006_identity_privacy_audit_instrumentation.sql",
    "0007_durable_orchestration_source_governance.sql",
    "0008_search_provider_foundation.sql",
    "0009_zero_cost_discovery.sql",
  ]);

  const [user] = await database`
    insert into public.users (name, email, email_verified, status)
    values ('M8 Migration User', 'm8-migration@recruitintel.invalid', true, 'ACTIVE')
    returning id
  `;
  const [company] = await database`
    insert into public.companies (
      canonical_name, slug, website, careers_url, ats_type, ats_identifier
    ) values (
      'M8 Fixture Company', 'm8-fixture-company', 'https://m8.example',
      'https://m8.example/careers', 'GREENHOUSE', 'm8-fixture'
    ) returning id
  `;
  const sources = await database`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, base_url,
      reliability, enabled, source_policy_id
    ) values
      (${company.id}, 'ATS', 'greenhouse', 'm8-fixture', 'M8 Greenhouse',
       'https://boards.greenhouse.io/m8-fixture', 0.950, true,
       (select id from public.source_policies where provider = 'greenhouse')),
      (${company.id}, 'GITHUB', 'github', 'm8-fixture/jobs', 'M8 GitHub',
       'https://github.com/m8-fixture/jobs', 0.650, true,
       (select id from public.source_policies where provider = 'github')),
      (${company.id}, 'COMPANY_CAREERS', 'public_web', 'https://m8.example/careers',
       'M8 Careers JSON-LD', 'https://m8.example/careers', 0.900, true,
       (select id from public.source_policies where provider = 'public_web'))
    returning id, provider
  `;
  const source = Object.fromEntries(sources.map((row) => [row.provider, row.id]));
  const [run] = await database`
    insert into public.collector_runs (
      source_id, collector, status, finished_at, items_discovered, items_new
    ) values (${source.greenhouse}, 'greenhouse', 'SUCCEEDED', now(), 1, 1)
    returning id
  `;
  const hashes = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
  const jobs = await database`
    insert into public.jobs (
      company_id, source_id, external_id, title, description, location,
      employment_type, role_family, experience_level, is_internship,
      application_url, source_url, content_hash, last_seen_run_id, raw_payload
    ) values
      (${company.id}, ${source.greenhouse}, 'gh-100', 'Software Engineer Intern',
       'Build reliable systems with TypeScript.', 'San Mateo, CA', 'INTERNSHIP',
       'SOFTWARE_ENGINEERING', 'INTERNSHIP', true,
       'https://boards.greenhouse.io/m8-fixture/jobs/100',
       'https://boards.greenhouse.io/m8-fixture/jobs/100', ${hashes[0]}, ${run.id}, '{}'),
      (${company.id}, ${source.github}, 'github-row-1', 'Software Engineer Intern',
       'Community listing.', 'San Mateo, CA', 'INTERNSHIP',
       'SOFTWARE_ENGINEERING', 'INTERNSHIP', true,
       'https://boards.greenhouse.io/m8-fixture/jobs/100',
       'https://github.com/m8-fixture/jobs/blob/main/README.md', ${hashes[1]}, ${run.id}, '{}'),
      (${company.id}, ${source.public_web}, 'jsonld-1', 'Software Engineer Intern',
       'Company JobPosting JSON-LD.', 'San Mateo, CA', 'INTERNSHIP',
       'SOFTWARE_ENGINEERING', 'INTERNSHIP', true,
       'https://boards.greenhouse.io/m8-fixture/jobs/100',
       'https://m8.example/careers/software-engineer-intern', ${hashes[2]}, ${run.id}, '{}')
    returning id, source_id
  `;
  const [plan] = await database`
    insert into public.application_plans (
      user_id, company_id, job_id, title, target_date, timezone, plan_fingerprint
    ) values (
      ${user.id}, ${company.id}, ${jobs[0].id}, 'Historical M8 plan', current_date + 7,
      'America/Chicago', ${"4".repeat(64)}
    ) returning id, job_id
  `;
  const [calendar] = await database`
    insert into public.calendar_items (
      user_id, company_id, job_id, application_plan_id, type, title,
      starts_at, all_day, timezone, status, source
    ) values (
      ${user.id}, ${company.id}, ${jobs[0].id}, ${plan.id}, 'APPLICATION_TASK',
      'Historical apply task', now(), false, 'America/Chicago', 'TODO', 'APPLICATION_PLAN'
    ) returning id, job_id
  `;
  const ciphertext = "m8.encrypted.refresh.ciphertext.byte-for-byte";
  const [connection] = await database`
    insert into public.calendar_connections (
      user_id, provider, provider_account_id, selected_calendar_id,
      encrypted_refresh_token, connection_status
    ) values (${user.id}, 'GOOGLE', 'm8-provider-account', 'primary', ${ciphertext}, 'CONNECTED')
    returning id
  `;
  await database`
    insert into public.calendar_external_events (
      user_id, calendar_item_id, calendar_connection_id, provider, external_calendar_id,
      external_event_id, sync_status
    ) values (
      ${user.id}, ${calendar.id}, ${connection.id}, 'GOOGLE', 'primary', 'm8-event', 'SYNCED'
    )
  `;
  const [eventsBefore] = await database`
    select count(*)::int as count from public.recruiting_events
  `;

  await apply(database, ["0010_canonical_job_graph.sql"]);

  const [migrationState] = await database`
    select
      (select count(*)::int from public.jobs where company_id = ${company.id}) as jobs,
      (select count(*)::int from public.job_opportunities
        where company_id = ${company.id}) as opportunities,
      (select count(*)::int from public.job_opportunity_postings membership
        join public.jobs job on job.id = membership.job_id
        where job.company_id = ${company.id} and membership.valid_to is null) as memberships,
      (select count(*)::int from public.recruiting_events) as events,
      (select encrypted_refresh_token from public.calendar_connections
        where id = ${connection.id}) as ciphertext,
      (select job_id from public.application_plans where id = ${plan.id}) as plan_job_id,
      (select job_id from public.calendar_items where id = ${calendar.id}) as calendar_job_id
  `;
  if (
    migrationState.jobs !== 3 ||
    migrationState.opportunities !== 3 ||
    migrationState.memberships !== 3 ||
    migrationState.events !== eventsBefore.count ||
    migrationState.ciphertext !== ciphertext ||
    migrationState.plan_job_id !== plan.job_id ||
    migrationState.calendar_job_id !== calendar.job_id
  ) {
    throw new Error("0010 one-to-one migration did not preserve source/private state");
  }

  const [postMigrationJob] = await database`
    insert into public.jobs (
      company_id, source_id, external_id, title, application_url, source_url, content_hash
    ) values (
      ${company.id}, ${source.greenhouse}, 'gh-101', 'Another Internship',
      'https://boards.greenhouse.io/m8-fixture/jobs/101',
      'https://boards.greenhouse.io/m8-fixture/jobs/101', ${"5".repeat(64)}
    ) returning id
  `;
  const [singleton] = await database`
    select count(*)::int as count from public.job_opportunity_postings
    where job_id = ${postMigrationJob.id} and valid_to is null
  `;
  if (singleton.count !== 1)
    throw new Error("new posting did not receive one singleton membership");

  const [planEvidence] = await database`
    explain (format json, costs off)
    select opportunity.id from public.job_opportunities opportunity
    join public.job_identity_keys identity on identity.company_id = opportunity.company_id
    where identity.company_id = ${company.id}
      and identity.key_type = 'OFFICIAL_APPLICATION_URL'
      and identity.key_hash = ${"6".repeat(64)} and identity.validated
    limit 50
  `;
  const explain = JSON.stringify(planEvidence["QUERY PLAN"]);
  if (!explain.includes("job_identity_keys_match_idx")) {
    // Tiny tables can prefer a sequential scan; disabling it proves the indexed access path exists.
    await database`set enable_seqscan = off`;
    const [forced] = await database`
      explain (format json, costs off)
      select job_id from public.job_identity_keys
      where company_id = ${company.id}
        and key_type = 'OFFICIAL_APPLICATION_URL'
        and key_hash = ${"6".repeat(64)} and validated limit 50
    `;
    if (!JSON.stringify(forced["QUERY PLAN"]).includes("job_identity_keys_match_idx")) {
      throw new Error("identity candidate query lacks its bounded indexed plan");
    }
  }

  const [workerPrivileges] = await database`
    select
      has_table_privilege(
        'recruitintel_worker_global', 'public.job_locations', 'DELETE'
      ) as can_refresh_locations,
      has_table_privilege(
        'recruitintel_worker_global', 'public.job_opportunity_postings', 'DELETE'
      ) as can_delete_memberships,
      has_table_privilege(
        'recruitintel_worker_global', 'public.job_resolution_decisions', 'DELETE'
      ) as can_delete_decisions
  `;
  if (
    !workerPrivileges?.can_refresh_locations ||
    workerPrivileges.can_delete_memberships ||
    workerPrivileges.can_delete_decisions
  ) {
    throw new Error("M8 worker derivation or append-only privileges are unsafe");
  }

  let membershipIdentityMutationRejected = false;
  try {
    await database`
      update public.job_opportunity_postings set membership_method = 'MANUAL_MERGE'
      where job_id = ${postMigrationJob.id} and valid_to is null
    `;
  } catch (error) {
    membershipIdentityMutationRejected = error?.code === "55000";
  }
  if (!membershipIdentityMutationRejected) {
    throw new Error("temporal membership identity was mutable in place");
  }

  await database`
    select public.recompute_job_opportunity(id)
    from public.job_opportunities where company_id = ${company.id}
  `;

  await database`delete from public.companies where id = ${company.id}`;
  const [companyDeletion] = await database`
    select count(*)::int as count from public.companies where id = ${company.id}
  `;
  if (companyDeletion.count !== 0) {
    throw new Error("canonical graph prevented the existing company deletion contract");
  }

  console.log(
    JSON.stringify({
      status: "ok",
      migration: "0009 -> 0010",
      sourcePostingsPreserved: migrationState.jobs,
      singletonOpportunities: migrationState.opportunities,
      singletonMemberships: migrationState.memberships,
      privateReferencesPreserved: true,
      calendarCiphertextPreserved: true,
      fakeSourceEvents: migrationState.events - eventsBefore.count,
      newWriterSingleton: true,
      boundedIdentityIndex: true,
      leastPrivilegeDerivationRefresh: true,
      immutableMembershipHistory: true,
      companyDeletionCompatible: true,
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
