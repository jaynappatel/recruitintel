# Milestone 6 identity cutover operations

Milestone 6 is an atomic identity cutover: migration `0006`, Better Auth session support, actor
resolution, and protection of personal routes must be deployed together. Do not deploy only one
part of that boundary.

## Pre-0006 backup

Stop writes or place the web and worker processes in maintenance mode, then create a custom-format
backup with the PostgreSQL client version matching the server:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --file=recruitintel-pre-0006-YYYYMMDD-HHMM.dump "$DATABASE_URL"
pg_restore --list recruitintel-pre-0006-YYYYMMDD-HHMM.dump >/dev/null
```

Store the dump outside the application checkout with access restricted to operators. It contains
private calendar data, provider email addresses, and encrypted Google Calendar credentials. Record
the deployed application commit, the database server version, the dump checksum, and the active
`CALENDAR_TOKEN_ENCRYPTION_KEY` key identifier in the release record. Never place the key in the
backup record.

## Preflight

Run the isolated realistic-state migration smoke before touching the target database:

```bash
DATABASE_URL=postgresql://... pnpm --filter @recruitintel/db smoke:migration-0006
```

It creates and removes a process-specific test database, applies `0001` through `0005`, inserts an
application plan, Calendar items, OAuth state, a Google connection with ciphertext, an external
mapping, and sync work, and then applies `0006`. It fails unless ciphertext is byte-for-byte
unchanged, every private row survives, and no private row is orphaned.

## Cutover

1. Keep writes stopped.
2. Deploy the application commit containing migration `0006` and all protected route handlers.
3. Run `pnpm db:migrate` once.
4. Run `pnpm db:migrate` again and verify every migration is reported as `skip`.
5. Run database, auth persistence, IDOR, Calendar worker, and HTTP contract smokes.
6. Resume workers, then web traffic.

The Better Auth CLI is not authorized to mutate any shared or production database. The checked-in
SQL migration is the only production schema path. The exact Better Auth `1.7.1` runtime schema is
inspected by the auth schema contract test.

## Restore after a failed cutover

If migration or route verification fails, keep all application and worker writes stopped. Restore
into a fresh database rather than trying to partially reverse ownership constraints:

```bash
createdb recruitintel_restore
pg_restore --clean --if-exists --no-owner --no-acl \
  --dbname=postgresql://.../recruitintel_restore \
  recruitintel-pre-0006-YYYYMMDD-HHMM.dump
```

Verify migration `0005` is the latest row in `schema_migrations`, verify Calendar/ApplicationPlan
counts, and compare a sample of `calendar_connections.encrypted_refresh_token` values against the
pre-cutover release record's hashes. Point the pre-Milestone-6 application release at the restored
database, run the Milestone 5 smoke suite, then resume traffic. Retain the failed database for
forensics with access restricted; do not copy provider credentials into tickets or logs.

## Legacy user claim

Migration `0006` converts every distinct MVP owner UUID into a `PENDING_IDENTITY` user whose email
ends in `@recruitintel.invalid`. Before that person first signs in, an operator must replace the
placeholder email with the person's verified Google email in a controlled SQL session. Better Auth
then links only a verified Google identity with the exact matching email. The user UUID does not
change, so Calendar data and encrypted credential ciphertext remain attached to the same owner.

Authentication Google OAuth and Google Calendar OAuth are separate clients and grants. Never reuse
the Calendar client for sign-in.
