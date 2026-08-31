# Identity, ownership, privacy, audit, and instrumentation

Milestone 6 replaces the configured MVP owner and static administrator secret with authenticated
users, database-backed ownership, scoped service principals, privacy-safe audit records, and a
small instrumentation foundation. Shared recruiting intelligence remains shared. Calendar data,
plans, connected accounts, watchlists, and future personal records belong to exactly one user.

## Authentication setup

RecruitIntel pins Better Auth to exact version `1.7.1` (the stable npm `latest` reviewed for this
milestone). The checked-in `0006` SQL is the only schema deployment path. Do not point the Better
Auth CLI at a shared or production database.

Create a dedicated Google Web application OAuth client for authentication. Configure:

```dotenv
BETTER_AUTH_SECRET=replace-with-at-least-32-high-entropy-characters
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000
AUTH_GOOGLE_CLIENT_ID=replace-with-auth-client-id
AUTH_GOOGLE_CLIENT_SECRET=replace-with-auth-client-secret
AUDIT_IP_HASH_KEY=optional-independent-high-entropy-salt
```

For local development, add this exact authorized redirect URI to the authentication client:

```text
http://localhost:3000/api/auth/callback/google
```

For production, use the exact HTTPS application origin and corresponding callback, for example
`https://recruitintel.example/api/auth/callback/google`. Keep `BETTER_AUTH_URL` and
`BETTER_AUTH_TRUSTED_ORIGINS` aligned with that origin. The application requests only `openid`,
`email`, and `profile` for sign-in. It requires Google's verified-email claim, does not permit
different-email account linking, and uses `HttpOnly`, `SameSite=Lax`, secure-in-production cookies.

Authentication OAuth and Google Calendar OAuth are different trust decisions and must use separate
Google clients and environment variables. The auth account persistence hook removes provider access,
refresh, and ID tokens before persistence; a database constraint independently rejects those
credentials. Sign-in provider tokens are therefore not retained. Calendar's separately consented
refresh credential remains encrypted with `CALENDAR_TOKEN_ENCRYPTION_KEY` in
`calendar_connections`.

## Reviewed Better Auth schema contract

The exact generated Better Auth `1.7.1` model was inspected and contract-tested against:

- `users`: name, unique email, verified flag, image, timestamps, RecruitIntel status/admin fields;
- `user_sessions`: expiry, unique opaque session token, timestamps, bounded request metadata, user;
- `user_identities`: issuer/account/provider/user identity plus deliberately nullable token fields;
- `auth_verifications`: identifier, value, expiry, and timestamps.

`auth-options.test.ts` asserts the complete generated field set. The PostgreSQL contract test creates
an identity and session through Better Auth's actual internal adapter, reads the session back,
deletes it, and proves that provider token columns remain null. The package version is exact in
`apps/web/package.json`; it is not a semver range.

## Actor and authorization model

The only actor kinds are:

- `USER`: an active authenticated user acting on their own private resources;
- `ADMIN`: an active authenticated user allowed to invoke operational mutation routes;
- `SERVICE`: a hashed, scoped, expiring/revocable non-human principal;
- `SYSTEM`: a narrowly used internal audit actor without private-resource browse authority.

`requireAuthenticatedUser()` resolves a trusted Better Auth session and an active database user.
`requireAdmin()` accepts either an admin user session or a service principal carrying the required
scope. Admin status authorizes operational routes only: it does not bypass owner predicates on
Calendar, plans, connections, future resumes, application notes, or browser history. Personal
queries always include the authenticated `user_id`, so cross-owner lookup returns `404`.

Non-GET cookie-authenticated application routes also reject an untrusted `Origin`. Better Auth owns
its own callback/session CSRF protections. No browser-facing request schema contains `userId` or
`ownerId`; extra values are ignored or rejected and can never select ownership.

Current endpoint classes are:

| Class         | Endpoints                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Public        | Company, job, event, recruiter, school, campus, GitHub/public-web evidence reads                                              |
| Authenticated | `/api/me`; instrumentation for current view events                                                                            |
| Owner-scoped  | Calendar, application plans, Google Calendar integration, privacy requests, account deletion                                  |
| Admin         | GitHub repository attachment/sync, public-web queue/fetch, manual recruiter/evidence writes, internal search-query inspection |
| Better Auth   | `/api/auth/*` sign-in, callback, session, and sign-out handlers                                                               |

## Shared and private data

Globally shared intelligence includes companies, source job postings, sources, recruiting events,
schools, public recruiter/evidence projections, interview intelligence, GitHub observations, and
public-web observations/claims. A shared `recruiting_dates` projection has `user_id = null`; a
user-created date has an owner.

Private data includes Calendar items, application plans/tasks, Google Calendar OAuth states and
connections, external mappings, sync requests/runs, watchlists, product events, extension grants,
privacy requests while linked, and all future resumes/applications/notes/browser history/personal
recommendations. Compound foreign keys prevent a child row from combining resources owned by two
different users.

System/internal data includes schema migrations, collector/work runs, provider health and errors,
service principals, and append-only security audit events. Admin authority does not make private
user content an admin dataset.

## Migration and legacy data

Migration `0006_identity_privacy_audit_instrumentation.sql` creates identity tables, converts every
Milestone 5 owner column to `user_id`, creates a claimable `PENDING_IDENTITY` user for each distinct
legacy UUID, and adds user and compound-owner foreign keys. It backfills plan tasks, external event
mappings, and sync runs before making ownership non-null.

Existing user UUIDs do not change. Before first sign-in, an operator replaces the legacy
`@recruitintel.invalid` address with that user's actual verified Google email and sets
`email_verified = true` in a controlled SQL session. Better Auth can then link only the exact
verified address. The deterministic local user remains
`00000000-0000-0000-0000-000000000001`; the seed is idempotent and does not silently claim it.

The realistic `0005 -> 0006` smoke covers a private recruiting date, plan/tasks, timed item,
Calendar OAuth state, connected Google account, encrypted refresh credential, external mapping, and
sync request/run. It fails if any private row is orphaned or the encrypted credential ciphertext is
not byte-for-byte identical. Backup and restore steps are in
`docs/milestone-6-identity-operations.md` and are a release prerequisite.

## Service principals and future extension grants

Static process-wide admin bearer configuration is removed. To create an administrative service
principal:

```bash
DATABASE_URL=postgresql://... pnpm --filter @recruitintel/db service-principal:create
```

The command emits the token exactly once. The database stores only its SHA-256 hash and a non-secret
prefix. Authentication uses constant-time hash comparison and enforces status, expiry, and the
closed `ADMIN_MUTATE` scope. Revocation sets the principal to `REVOKED` with `revoked_at`; tokens are
never logged.

`extension_grants` is schema-only preparation for the future browser companion. It has user
ownership, a hashed opaque token, the closed scopes `PAGE_SCAN`/`JOB_IMPORT`, mandatory expiry,
revocation, and last-used metadata. Milestone 6 intentionally has no extension issuance, redirect,
or browser authorization workflow.

Python workers do not accept a user ID from an API payload. Calendar sync receives a server-created
request UUID, then joins the durable request to its connection on both connection ID and `user_id`.
Global intelligence workers continue to operate on source/work IDs. Narrow database roles remain a
deployment hardening item; service-principal rows do not replace database credentials.

## Audit and redaction

`audit_events` is append-only. It records actor kind/identifier, action, resource type/identifier,
outcome, request ID, optional salted IP hash, and minimized metadata. Updates and direct deletes are
rejected. Current sensitive events include authentication session creation/revocation, Calendar
connection lifecycle/preferences/sync, administrative authorization decisions, privacy requests,
and account deletion. Audit records do not contain request bodies, provider payloads, email,
headers, cookies, tokens, OAuth codes, raw resumes, or DOM.

TypeScript and Python share `test-fixtures/redaction/golden.json`. Their redactors cover structured
keys, bearer/basic headers, cookies, OAuth/provider credentials, emails, URL query/fragment values,
resume/DOM/form content, exception messages, and nested provider metadata. Redaction is applied at:

- the structured Next.js logger and Better Auth logger bridge;
- API error-envelope serialization and database exception logging;
- Python structured logs and exception serialization;
- persisted collector, public-web, GitHub, and Calendar worker diagnostics;
- audit and instrumentation metadata persistence.

Redaction is defense in depth, not permission to intentionally log sensitive payloads. Secrets,
raw resumes, full DOM snapshots, cookies, private form values, and full provider responses must not
be passed to logging or analytics APIs at all.

## Product instrumentation

`product_events` stores a user, versioned closed event type, source, typed entity reference,
optional request/deduplication key, minimized context, and event time. Current server-authoritative
events are emitted for plan creation, plan activation, and Calendar item completion. Current view
events are `JOB_VIEWED`, `RECRUITER_VIEWED`, and `INTERVIEW_INTEL_VIEWED`; the server resolves the
user and validates referenced entities. The browser cannot report plan creation/activation or
completion.

Future event enum values are present but are not emitted until their product behavior exists.
`ranking_decisions` and `recommendation_impressions` preserve a candidate-set version, rank,
algorithm/version, point-in-time input fingerprint, and shown timestamp for future offline ranking
evaluation. They store no raw resume text, source document, DOM, or prompt content.

Product/audit events are deleted or minimized according to their different purpose: private product
events cascade with account deletion; the security ledger remains append-only and contains only
pseudonymous IDs/minimized metadata.

## Privacy requests and deletion

`privacy_requests` records `EXPORT` and `DELETE` lifecycles with a one-way user fingerprint and
minimal result/failure codes. `POST /api/privacy/requests` accepts only `{ "type": "EXPORT" }` and
queues a `PENDING` record. Producing and encrypting a downloadable export artifact is deliberately
deferred to Gate 6.1 because it requires storage, expiry, and delivery infrastructure unrelated to
the identity cutover.

`DELETE /api/account` is bounded and synchronous: authenticate the user, create a delete request,
best-effort revoke Google Calendar, mark deletion in progress, record a minimized audit event, and
delete the user. Cascades remove sessions, identities, encrypted Calendar credentials/OAuth state,
private Calendar/planning data, extension grants, watchlists, and instrumentation. The privacy
request remains with `user_id = null`, a one-way fingerprint, completion time, and minimal result.
Provider revocation failure never preserves local credentials and never exposes the credential in
an error.

## Operational boundary and tests

Migration `0006`, Better Auth session infrastructure, actor resolution, and personal route
protection are one atomic release. Never deploy the schema without protected routes or protected
routes before ownership is migrated. Required verification includes:

- two-user Calendar/plan/Google isolation and admin-without-owner-bypass;
- unauthenticated `401`, cross-owner `404`, cross-origin mutation rejection;
- Better Auth schema, identity/account/session persistence and session revocation;
- plaintext provider-token rejection by hook and database constraint;
- service-token hash/scope/expiry behavior;
- append-only audit, metadata redaction, and privacy-safe instrumentation;
- account deletion including encrypted Calendar credential deletion;
- `0005 -> 0006` realistic-state survival, migration/seed idempotency, workers, and production build.

M9 extends this boundary with private watchlists, recruiting preferences, opportunity dismissals,
recommendation decisions/impressions, and alerts. Every new row has a user owner or is canonical
public evidence; owner compound keys and authenticated repositories enforce isolation. Admin
operational scopes do not grant access to private recommendation history. Account deletion cascades
all M9 private rows and leaves only the existing minimized privacy-request record. Explicit
work-authorization and sponsorship answers are optional user settings and are never inferred.
