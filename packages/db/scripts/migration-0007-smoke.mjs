import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");

const parsed = new URL(sourceUrl);
parsed.pathname = "/postgres";
const databaseName = `recruitintel_m7_migration_test_${process.pid}`;
const workerRole = `recruitintel_m7_smoke_worker_${process.pid}`;
if (!/^recruitintel_m7_migration_test_\d+$/.test(databaseName)) {
  throw new Error("Unsafe migration test database name");
}
if (!/^recruitintel_m7_smoke_worker_\d+$/.test(workerRole)) {
  throw new Error("Unsafe migration worker role name");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsRoot = resolve(packageRoot, "migrations");
const seedPath = resolve(packageRoot, "seeds", "001_development.sql");
const admin = postgres(parsed.toString(), { max: 1 });
let database;
let concurrentDatabase;
let workerDatabase;

const ids = {
  user: "00000000-0000-0000-0000-000000000001",
  company: "10000000-0000-0000-0000-000000000001",
  pendingRepository: "23000000-0000-0000-0000-000000000001",
  githubSource: "97100000-0000-0000-0000-000000000001",
  runningRepository: "97100000-0000-0000-0000-000000000002",
  failedSource: "97100000-0000-0000-0000-000000000003",
  failedRepository: "97100000-0000-0000-0000-000000000004",
  pendingGithub: "97100000-0000-0000-0000-000000000011",
  runningGithub: "97100000-0000-0000-0000-000000000012",
  failedGithub: "97100000-0000-0000-0000-000000000013",
  githubCollector: "97100000-0000-0000-0000-000000000021",
  webSource: "97300000-0000-0000-0000-000000000001",
  webQueryA: "97300000-0000-0000-0000-000000000002",
  webQueryB: "97300000-0000-0000-0000-000000000003",
  runningWeb: "97300000-0000-0000-0000-000000000004",
  retryWeb: "97300000-0000-0000-0000-000000000005",
  webCollector: "97300000-0000-0000-0000-000000000006",
  stuckCollector: "97400000-0000-0000-0000-000000000001",
  calendarItem: "97500000-0000-0000-0000-000000000001",
  calendarConnection: "97500000-0000-0000-0000-000000000002",
  calendarMapping: "97500000-0000-0000-0000-000000000003",
  calendarRequest: "97500000-0000-0000-0000-000000000004",
};
const ciphertext = "v1.byte-for-byte-google-refresh-ciphertext";

async function apply(databaseClient, names) {
  for (const name of names) {
    await databaseClient.unsafe(await readFile(resolve(migrationsRoot, name), "utf8"));
  }
}

async function expectCount(databaseClient, query, expected, label) {
  const [row] = await databaseClient.unsafe(query);
  if (Number(row.count) !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${row.count}`);
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
  ]);
  await database.unsafe(await readFile(seedPath, "utf8"));

  await database.begin(async (sql) => {
    await sql`
      insert into public.sources (
        id, company_id, source_type, provider, external_key, name, base_url, enabled
      ) values
        (${ids.githubSource}, ${ids.company}, 'GITHUB', 'migration_test',
         'migration-running-github', 'Migration running GitHub',
         'https://github.com/recruitintel-demo/migration-running', true),
        (${ids.failedSource}, ${ids.company}, 'GITHUB', 'migration_test',
         'migration-failed-github', 'Migration failed GitHub',
         'https://github.com/recruitintel-demo/migration-failed', true),
        (${ids.webSource}, ${ids.company}, 'PUBLIC_WEB', 'migration_test',
         'migration-public-web', 'Migration public web', 'https://example.com', true)
    `;
    await sql`
      insert into public.github_repositories (
        id, source_id, owner, repository_name, repository_url,
        default_branch, repository_type, parser_type, enabled
      ) values
      (
        ${ids.runningRepository}, ${ids.githubSource}, 'recruitintel-demo',
        'migration-running', 'https://github.com/recruitintel-demo/migration-running',
        'main', 'OTHER', 'AUTO', true
      ),
      (
        ${ids.failedRepository}, ${ids.failedSource}, 'recruitintel-demo',
        'migration-failed', 'https://github.com/recruitintel-demo/migration-failed',
        'main', 'OTHER', 'AUTO', true
      )
    `;
    await sql`
      insert into public.github_sync_requests (
        id, github_repository_id, status, requested_by, started_at, finished_at,
        error_message
      ) values
        (${ids.pendingGithub}, ${ids.pendingRepository}, 'PENDING', 'migration-smoke',
         null, null, null),
        (${ids.runningGithub}, ${ids.runningRepository}, 'RUNNING', 'migration-smoke',
         now() - interval '5 minutes', null, null),
        (${ids.failedGithub}, ${ids.failedRepository}, 'FAILED', 'migration-smoke',
         now() - interval '3 minutes', now() - interval '1 minute',
         'legacy provider error')
    `;
    await sql`
      insert into public.collector_runs (
        id, source_id, collector, status, started_at, metadata
      ) values (
        ${ids.githubCollector}, ${ids.githubSource}, 'github', 'RUNNING',
        now() - interval '5 minutes', '{"legacy":true}'
      )
    `;
    await sql`
      insert into public.github_sync_runs (
        collector_run_id, github_repository_id, sync_request_id, files_inspected
      ) values (${ids.githubCollector}, ${ids.runningRepository}, ${ids.runningGithub}, 2)
    `;

    await sql`
      insert into public.public_web_search_queries (
        id, company_id, source_id, provider, template_key, query
      ) values
        (${ids.webQueryA}, ${ids.company}, ${ids.webSource}, 'migration_test',
         'migration-a', 'migration query A'),
        (${ids.webQueryB}, ${ids.company}, ${ids.webSource}, 'migration_test',
         'migration-b', 'migration query B')
    `;
    await sql`
      insert into public.public_web_work_requests (
        id, work_type, status, company_id, search_query_id, requested_by,
        attempt_count, max_attempts, next_attempt_at, started_at, error_message
      ) values
        (${ids.runningWeb}, 'WEB_SEARCH', 'RUNNING', ${ids.company}, ${ids.webQueryA},
         'migration-smoke', 1, 3, now(), now() - interval '4 minutes', null),
        (${ids.retryWeb}, 'WEB_SEARCH', 'PENDING', ${ids.company}, ${ids.webQueryB},
         'migration-smoke', 1, 3, now() - interval '1 minute', null,
         'retryable network failure')
    `;
    await sql`
      insert into public.collector_runs (
        id, source_id, collector, status, started_at, metadata
      ) values (
        ${ids.webCollector}, ${ids.webSource}, 'public-web', 'RUNNING',
        now() - interval '4 minutes', '{"legacy":true}'
      )
    `;
    await sql`
      insert into public.public_web_runs (
        collector_run_id, work_request_id, company_id, provider, query
      ) values (
        ${ids.webCollector}, ${ids.runningWeb}, ${ids.company},
        'migration_test', 'migration query A'
      )
    `;
    await sql`
      insert into public.collector_runs (
        id, source_id, collector, status, started_at, metadata
      ) values (
        ${ids.stuckCollector}, '21000000-0000-0000-0000-000000000001',
        'greenhouse', 'RUNNING', now() - interval '2 hours', '{"legacy":true}'
      )
    `;

    await sql`
      insert into public.calendar_items (
        id, user_id, company_id, type, title, starts_at, all_day, timezone,
        source, sync_enabled
      ) values (
        ${ids.calendarItem}, ${ids.user}, ${ids.company}, 'CUSTOM',
        'Private migration calendar item', '2026-09-01T15:00:00Z', false,
        'America/Chicago', 'USER', true
      )
    `;
    await sql`
      insert into public.calendar_connections (
        id, user_id, provider, provider_account_id, provider_email,
        encrypted_refresh_token, scopes, connection_status
      ) values (
        ${ids.calendarConnection}, ${ids.user}, 'GOOGLE', 'google-sub',
        'private@example.com', ${ciphertext},
        array['https://www.googleapis.com/auth/calendar.events.owned'], 'CONNECTED'
      )
    `;
    await sql`
      insert into public.calendar_external_events (
        id, user_id, calendar_item_id, calendar_connection_id, provider,
        external_calendar_id, external_event_id, sync_status
      ) values (
        ${ids.calendarMapping}, ${ids.user}, ${ids.calendarItem}, ${ids.calendarConnection},
        'GOOGLE', 'primary', 'external-event-id', 'SYNCED'
      )
    `;
    await sql`
      insert into public.calendar_sync_requests (
        id, calendar_connection_id, user_id, status
      ) values (${ids.calendarRequest}, ${ids.calendarConnection}, ${ids.user}, 'PENDING')
    `;
  });

  await apply(database, ["0007_durable_orchestration_source_governance.sql"]);

  const [survival] = await database`
    select encrypted_refresh_token from public.calendar_connections
    where id = ${ids.calendarConnection}
  `;
  if (survival.encrypted_refresh_token !== ciphertext) {
    throw new Error("Google credential ciphertext changed during 0007");
  }
  await expectCount(
    database,
    `select count(*) from public.work_items where github_sync_request_id is not null`,
    3,
    "GitHub request history",
  );
  await expectCount(
    database,
    `select count(*) from public.work_items where public_web_work_request_id is not null`,
    2,
    "public-web request history",
  );
  await expectCount(
    database,
    `select count(*) from public.work_items where calendar_sync_request_id is not null`,
    1,
    "Calendar request history",
  );
  await expectCount(
    database,
    `select count(*) from public.calendar_external_events where id = '${ids.calendarMapping}'`,
    1,
    "Calendar external mapping",
  );
  await expectCount(
    database,
    `select count(*) from public.collector_runs where status = 'RUNNING'`,
    0,
    "stuck collector recovery",
  );
  await expectCount(
    database,
    `select count(*) from public.github_sync_requests where id = '${ids.runningGithub}' and status = 'PENDING'`,
    1,
    "running GitHub reconciliation",
  );
  await expectCount(
    database,
    `select count(*) from public.public_web_work_requests where id = '${ids.runningWeb}' and status = 'PENDING'`,
    1,
    "running public-web reconciliation",
  );
  await expectCount(
    database,
    `select count(*) from public.work_attempts where worker_instance = 'legacy-migration'`,
    4,
    "legacy attempts",
  );
  await expectCount(
    database,
    `select count(*) from public.dead_letters where work_item_id = (
       select id from public.work_items where github_sync_request_id = '${ids.failedGithub}'
     )`,
    1,
    "failed legacy dead letter",
  );

  // The seed explicitly marks only local/test providers executable and binds this DB role.
  await database.unsafe(await readFile(seedPath, "utf8"));

  // A retried public-web request may now retain more than one run without uniqueness failure.
  await database`
    insert into public.collector_runs (
      source_id, collector, status, started_at, finished_at, metadata
    ) values (
      ${ids.webSource}, 'public-web-retry', 'SUCCEEDED', now(), now(), '{"retry":true}'
    ) returning id
  `.then(async ([collector]) => {
    await database`
      insert into public.public_web_runs (
        collector_run_id, work_request_id, company_id, provider, query
      ) values (
        ${collector.id}, ${ids.runningWeb}, ${ids.company}, 'migration_test', 'migration retry'
      )
    `;
  });
  await expectCount(
    database,
    `select count(*) from public.public_web_runs where work_request_id = '${ids.runningWeb}'`,
    2,
    "public-web retry runs",
  );

  // Two schedulers transactionally enqueue one logical occurrence.
  const [schedule] = await database`
    select id, source_id from public.schedules where work_type = 'ATS_COLLECT'
    order by id limit 1
  `;
  await database`update public.schedules set enabled = false`;
  await database`
    update public.schedules set enabled = true, next_run_at = now() - interval '1 minute',
      jitter_seconds = 0 where id = ${schedule.id}
  `;
  const schedulerResults = await Promise.all([
    database`select public.enqueue_due_schedules(10) as count`,
    concurrentDatabase`select public.enqueue_due_schedules(10) as count`,
  ]);
  if (schedulerResults.flat().reduce((sum, row) => sum + Number(row.count), 0) !== 1) {
    throw new Error("two schedulers did not enqueue exactly one occurrence");
  }
  const [scheduledWork] = await database`
    update public.work_items set available_at = now()
    where schedule_id = ${schedule.id} returning id
  `;
  await database`
    update public.schedules set next_run_at = now() - interval '10 hours'
    where id = ${schedule.id}
  `;
  const [activeOccurrence] = await database`select public.enqueue_due_schedules(10) as count`;
  if (Number(activeOccurrence.count) !== 0) {
    throw new Error("active exclusive ATS work was duplicated by a later schedule tick");
  }
  await expectCount(
    database,
    `select count(*) from public.schedules where id = '${schedule.id}' and next_run_at > now()`,
    1,
    "bounded schedule catch-up",
  );

  // Two workers claim exclusive work once; lease expiry is reaped and retried successfully.
  const claims = await Promise.all([
    database`select * from public.claim_work_items('worker-a', array['ATS']::public.work_class[], 1, 30)`,
    concurrentDatabase`select * from public.claim_work_items('worker-b', array['ATS']::public.work_class[], 1, 30)`,
  ]);
  if (claims.flat().length !== 1 || claims.flat()[0].id !== scheduledWork.id) {
    throw new Error("two workers did not exclusively claim scheduled work");
  }
  const claimed = claims.flat()[0];
  await database`select public.start_work_attempt(${claimed.id}, ${claimed.lease_token})`;
  const [heartbeat] = await database`
    select public.heartbeat_work_attempt(${claimed.id}, ${claimed.lease_token}, 120) as expires_at
  `;
  if (new Date(heartbeat.expires_at).getTime() <= new Date(claimed.lease_expires_at).getTime()) {
    throw new Error("heartbeat did not extend the fenced lease");
  }
  await database`
    update public.work_items set lease_expires_at = now() - interval '1 second'
    where id = ${claimed.id}
  `;
  const [reaped] = await database`select public.reap_expired_work_items(10) as count`;
  if (Number(reaped.count) !== 1) throw new Error("expired lease was not reaped");
  await database`
    update public.work_items set available_at = now() where id = ${claimed.id}
  `;
  const [retry] = await database`
    select * from public.claim_work_items('worker-retry', array['ATS']::public.work_class[], 1, 30)
  `;
  await database`select public.start_work_attempt(${retry.id}, ${retry.lease_token})`;
  const [finished] = await database`
    select public.finish_work_attempt(
      ${retry.id}, ${retry.lease_token}, true, null, null, '{}'::jsonb,
      'COMPLETE', 1, 1, 0, null
    )::text as status
  `;
  if (finished.status !== "SUCCEEDED") throw new Error("reaped work retry did not succeed");
  await expectCount(
    database,
    `select count(*) from public.work_attempts where work_item_id = '${scheduledWork.id}'
       and provider is not null`,
    2,
    "attempt provider telemetry",
  );

  // Provider Retry-After controls durable eligibility rather than blocking a worker process.
  const [rateLimitedWork] = await database`
    insert into public.work_items (
      work_type, work_class, priority, scheduled_at, available_at, max_attempts,
      idempotency_fingerprint
    ) values (
      'SOURCE_HEALTH_ROLLUP', 'CONTROL', 80, now(), now(), 3,
      encode(digest('retry-after-smoke', 'sha256'), 'hex')
    ) returning id
  `;
  const [rateClaim] = await database`
    select * from public.claim_work_items(
      'worker-rate-limit', array['CONTROL']::public.work_class[], 1, 30
    ) where id = ${rateLimitedWork.id}
  `;
  await database`select public.start_work_attempt(${rateClaim.id}, ${rateClaim.lease_token})`;
  const [rateFinish] = await database`
    select public.finish_work_attempt(
      ${rateClaim.id}, ${rateClaim.lease_token}, false, 'RATE_LIMITED',
      'PROVIDER_RATE_LIMITED', '{}'::jsonb, 'UNKNOWN', null, null, null, 600
    )::text as status
  `;
  if (rateFinish.status !== "RETRY_WAIT") throw new Error("rate-limited work did not retry");
  const [retryEligibility] = await database`
    select extract(epoch from (available_at - now())) as delay_seconds
    from public.work_items where id = ${rateClaim.id}
  `;
  if (Number(retryEligibility.delay_seconds) < 590) {
    throw new Error("provider Retry-After was not respected");
  }

  // Policy is checked again at claim time; an already queued item becomes blocked.
  await database`
    insert into public.work_items (
      work_type, work_class, source_id, priority, scheduled_at, available_at,
      idempotency_fingerprint, exclusive_key
    ) values (
      'ATS_COLLECT', 'ATS', ${ids.webSource}, 99, now(), now(),
      encode(digest('policy-blocked-after-enqueue', 'sha256'), 'hex'),
      'policy-blocked-after-enqueue'
    )
  `;
  await database`
    update public.source_policies set status = 'BLOCKED', terms_status = 'NOT_REVIEWED',
      reviewed_at = null, reviewed_by = null where provider = 'migration_test'
  `;
  await database`
    select * from public.claim_work_items('worker-policy', array['ATS']::public.work_class[], 10, 30)
  `;
  await expectCount(
    database,
    `select count(*) from public.work_items where exclusive_key = 'policy-blocked-after-enqueue'
       and status = 'POLICY_BLOCKED'`,
    1,
    "execution-time policy block",
  );

  // Dead-letter requeue preserves linkage and creates a new WorkItem.
  const [legacyFailedWork] = await database`
    select id from public.work_items where github_sync_request_id = ${ids.failedGithub}
  `;
  await database`
    update public.source_policies set status = 'ALLOWED_WITH_LIMITS', terms_status = 'REVIEWED',
      reviewed_at = now(), reviewed_by = 'migration-smoke'
    where provider = 'migration_test'
  `;
  const [requeue] = await database`
    select public.requeue_dead_letter(${legacyFailedWork.id}) as id
  `;
  await expectCount(
    database,
    `select count(*) from public.work_items where id = '${requeue.id}'
       and requeued_from_id = '${legacyFailedWork.id}'`,
    1,
    "dead-letter requeue lineage",
  );

  // Source health is a deterministic projection over safe attempt metrics.
  for (const suffix of [1, 2, 3]) {
    const [healthWork] = await database`
      insert into public.work_items (
        work_type, work_class, source_id, priority, scheduled_at, available_at,
        max_attempts, idempotency_fingerprint
      ) values (
        'ATS_COLLECT', 'ATS', ${ids.webSource}, 90, now(), now(), 1,
        encode(digest(${"source-health-smoke-" + suffix}, 'sha256'), 'hex')
      ) returning id
    `;
    const [healthClaim] = await database`
      select * from public.claim_work_items(
        ${"health-worker-" + suffix}, array['ATS']::public.work_class[], 1, 30
      ) where id = ${healthWork.id}
    `;
    await database`
      select public.start_work_attempt(${healthClaim.id}, ${healthClaim.lease_token})
    `;
    await database`
      select public.finish_work_attempt(
        ${healthClaim.id}, ${healthClaim.lease_token}, false, 'RETRYABLE',
        'HEALTH_SMOKE_FAILURE', '{"category":"test"}'::jsonb,
        'PARTIAL', 0, 0, 1, null
      )
    `;
  }
  await database`select public.rollup_source_health(20)`;
  await expectCount(
    database,
    `select count(*) from public.source_health_state where source_id = '${ids.webSource}'
       and consecutive_failures >= 3 and coverage_status = 'PARTIAL'`,
    1,
    "deterministic source-health state",
  );
  await expectCount(
    database,
    `select count(*) from public.source_incidents where source_id = '${ids.webSource}'
       and status = 'OPEN' and incident_type in ('CONSECUTIVE_FAILURES', 'COVERAGE_PARTIAL')`,
    2,
    "deterministic source-health incidents",
  );

  // A worker login receives its bound lanes and cannot read private Calendar data.
  await admin.unsafe(`create role "${workerRole}" login password 'm7-smoke-only'`);
  await database.unsafe(`grant recruitintel_worker_global to "${workerRole}"`);
  const [workerPrincipal] = await database`
    insert into public.service_principals (
      name, kind, token_prefix, token_hash, scopes, status
    ) values (
      'M7 migration smoke worker', 'WORKER', 'ri_worker_M7Smoke01',
      encode(digest(${workerRole}, 'sha256'), 'hex'),
      array['WORKER_INGEST', 'WORKER_GLOBAL']::public.service_scope[], 'ACTIVE'
    ) returning id
  `;
  await database`
    insert into public.worker_role_bindings (
      database_role, service_principal_id, allowed_work_classes, can_schedule
    ) values (
      ${workerRole}, ${workerPrincipal.id}, array['ATS']::public.work_class[], false
    )
  `;
  const [leastPrivilegeWork] = await database`
    insert into public.work_items (
      work_type, work_class, source_id, priority, scheduled_at, available_at,
      idempotency_fingerprint
    ) values (
      'ATS_COLLECT', 'ATS', ${schedule.source_id}, 70, now(), now(),
      encode(digest('least-privilege-smoke', 'sha256'), 'hex')
    ) returning id
  `;
  const workerUrl = new URL(testUrl);
  workerUrl.username = workerRole;
  workerUrl.password = "m7-smoke-only";
  workerDatabase = postgres(workerUrl.toString(), { max: 1, onnotice: () => {} });
  const [leastPrivilegeClaim] = await workerDatabase`
    select * from public.claim_work_items(
      'least-privilege-worker', array['ATS']::public.work_class[], 1, 30
    ) where id = ${leastPrivilegeWork.id}
  `;
  if (!leastPrivilegeClaim) throw new Error("bound worker could not claim its ATS lane");
  let rejectedCalendarLane = false;
  try {
    await workerDatabase`
      select * from public.claim_work_items(
        'least-privilege-worker', array['CALENDAR']::public.work_class[], 1, 30
      )
    `;
  } catch (error) {
    rejectedCalendarLane = error?.code === "42501";
  }
  if (!rejectedCalendarLane) throw new Error("worker claimed an unbound Calendar lane");
  let rejectedPrivateRead = false;
  try {
    await workerDatabase`select count(*) from public.calendar_connections`;
  } catch (error) {
    rejectedPrivateRead = error?.code === "42501";
  }
  if (!rejectedPrivateRead) throw new Error("global worker could read private Calendar data");
  await database`
    update public.service_principals set status = 'REVOKED', revoked_at = now()
    where id = ${workerPrincipal.id}
  `;
  await database`
    insert into public.work_items (
      work_type, work_class, source_id, priority, scheduled_at, available_at,
      idempotency_fingerprint
    ) values (
      'ATS_COLLECT', 'ATS', ${schedule.source_id}, 70, now(), now(),
      encode(digest('revoked-worker-smoke', 'sha256'), 'hex')
    )
  `;
  let rejectedRevokedWorker = false;
  try {
    await workerDatabase`
      select * from public.claim_work_items(
        'least-privilege-worker', array['ATS']::public.work_class[], 1, 30
      )
    `;
  } catch (error) {
    rejectedRevokedWorker = error?.code === "42501";
  }
  if (!rejectedRevokedWorker) throw new Error("revoked worker principal retained queue access");
  await workerDatabase.end({ timeout: 5 });
  workerDatabase = undefined;

  const [privateCalendarWork] = await database`
    update public.work_items set status = 'DEAD_LETTERED', completed_at = now()
    where calendar_sync_request_id = ${ids.calendarRequest} returning id
  `;
  let rejectedPrivateRequeue = false;
  try {
    await database`select public.requeue_dead_letter(${privateCalendarWork.id})`;
  } catch (error) {
    rejectedPrivateRequeue = error?.code === "42501";
  }
  if (!rejectedPrivateRequeue) {
    throw new Error("owner-scoped Calendar work could be administratively requeued");
  }

  const [orphans] = await database`
    select
      (select count(*) from public.work_items work left join public.work_attempts attempt
        on attempt.work_item_id = work.id where work.attempt_count > 0 and attempt.id is null) +
      (select count(*) from public.calendar_sync_requests request left join public.users users
        on users.id = request.user_id where users.id is null) +
      (select count(*) from public.calendar_external_events mapping
        left join public.calendar_items item on item.id = mapping.calendar_item_id
        where item.id is null) as count
  `;
  if (Number(orphans.count) !== 0) throw new Error("0007 orphaned ownership or attempts");

  console.log(
    JSON.stringify({
      status: "ok",
      migration: "0006 -> 0007",
      ciphertextPreserved: true,
      historyPreserved: true,
      staleRunsRecovered: true,
      publicWebRetries: true,
      schedulerDeduplicated: true,
      activeOccurrenceDeduplicated: true,
      exclusiveClaim: true,
      leaseRecovery: true,
      policyFailClosed: true,
      deadLetterRequeue: true,
      sourceHealthDeterministic: true,
      workerLeastPrivilege: true,
      revokedWorkerRejected: true,
      privateRequeueRejected: true,
      orphanCount: 0,
    }),
  );
} finally {
  if (workerDatabase) await workerDatabase.end({ timeout: 5 });
  if (concurrentDatabase) await concurrentDatabase.end({ timeout: 5 });
  if (database) await database.end({ timeout: 5 });
  await admin`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${databaseName} and pid <> pg_backend_pid()
  `;
  await admin.unsafe(`drop database if exists "${databaseName}"`);
  await admin.unsafe(`drop role if exists "${workerRole}"`);
  await admin.end({ timeout: 5 });
}
