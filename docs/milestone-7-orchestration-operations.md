# Milestone 7 orchestration cutover and recovery

Migration 0007, scheduler, dispatcher, typed handlers, source policies, and role bindings are one
atomic deployment boundary. Do not deploy new request triggers without the dispatcher, and do not
start the dispatcher against a pre-0007 schema.

## Pre-cutover backup

1. Disable incoming mutations and stop every legacy and M7 worker/scheduler process.
2. Record counts/statuses for `github_sync_requests`, `public_web_work_requests`,
   `calendar_sync_requests`, their run tables, and running `collector_runs`.
3. Create a custom-format backup with a database owner credential, never an application credential:

```bash
pg_dump --format=custom --no-owner --file=recruitintel-pre-0007.dump "$DATABASE_URL"
pg_restore --list recruitintel-pre-0007.dump >/dev/null
```

4. Copy the backup to protected storage and record its checksum and retention. The dump can contain
   encrypted Calendar ciphertext and private data; restrict access accordingly.
5. Run the isolated realistic-state rehearsal:

```bash
DATABASE_URL=postgresql://... pnpm --filter @recruitintel/db smoke:migration-0007
```

The rehearsal creates and drops only a process-named temporary database and proves history,
ownership, ciphertext, retry, stale-run, concurrency, policy, and least-privilege contracts.

## Atomic cutover

1. Confirm web writes and all workers remain stopped.
2. Apply migration 0007 with the migration owner.
3. Run the seed only in development/test. Production policies must remain `REVIEW_REQUIRED` until a
   real review is recorded.
4. Reconcile counts. Confirm every legacy request has one WorkItem, legacy attempts/runs remain,
   failed requests have dead letters, no `RUNNING` collector remains, private ownership has no
   orphans, and Calendar ciphertext matches the pre-cutover value byte-for-byte.
5. Create separate PostgreSQL login roles and hashed worker service principals. Bind scheduler,
   global, Calendar, and privacy capabilities with `worker-role:bind`. With the migration owner,
   grant `recruitintel_web_app` directly to the trusted server login; it is not a worker binding and
   must never be granted to a browser/database end user.
6. Deploy scheduler, dispatcher, typed handlers, and route code together.
7. Start one scheduler and lane-isolated workers with all source schedules still disabled.
8. Verify claiming, lease, attempt, safe diagnostics, and source health with fixtures.
9. Review each production source policy. Enable a schedule only after its policy and cadence are
   approved. Start web traffic last.

## Restore

If migration, count reconciliation, role verification, or worker smoke fails:

1. Keep web writes and all workers stopped. Preserve the failed database for diagnosis.
2. Create a replacement empty database; do not restore over the failed database.
3. Restore the verified backup:

```bash
createdb recruitintel_restore
pg_restore --clean --if-exists --no-owner --dbname=recruitintel_restore \
  recruitintel-pre-0007.dump
```

4. Point the pre-M7 web/worker release at the restored database.
5. Verify request/run counts, private ownership, Calendar ciphertext, and a read-only API smoke.
6. Resume pre-M7 traffic only after verification. Retain the failed database until the incident is
   understood and the next rehearsal passes.

There is no formal DOWN migration because dropping orchestration tables would discard new attempt
history. Operational restore is the reversible recovery path.

## Gate 7.1A migration 0008

Migration 0008 changes search-query/source policy linkage and adds provider budget tables/functions,
so deploy it with the matching TypeScript query writer and Python search contracts while web writes,
schedulers, and workers are stopped. Take and verify a protected pre-0008 custom-format backup using
the procedure above. Run `pnpm --filter @recruitintel/db smoke:migration-0008`, apply the migration,
and verify every search query's `provider_policy_id` matches both its provider and source policy.
Confirm the `you/default` budget is disabled and the You policy remains `REVIEW_REQUIRED` and
`NOT_REVIEWED`. Run the development seed only outside production. Restore the pre-0008 backup into
a replacement database if linkage/count, role, or budget checks fail; do not drop new history from a
partially used database as an ad hoc rollback.

## Routine recovery

The scheduler calls the lease reaper on every tick. A stopped heartbeat makes a long handler lose
its fenced lease; the handler is cancelled locally, and the reaper makes the work retryable or dead
letters it. `AUTH_REQUIRED` waits for the owning user to reconnect Calendar. `POLICY_BLOCKED` waits
for an explicit reviewed policy change and a new enqueue/requeue decision. Only global dead letters
may be administratively requeued.
