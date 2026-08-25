# Durable orchestration and source governance

Milestone 7 replaces manual request-specific worker invocation with a deliberately small
PostgreSQL control plane. Domain tables remain authoritative: GitHub commit SHAs, public-web
documents and hashes, Calendar external mappings, collector runs, jobs, observations, and evidence
are not copied into `work_items`.

## Execution model

`schedules` supports only `INTERVAL` and timezone-aware `DAILY_AT`. A scheduler transaction locks
due rows with `FOR UPDATE SKIP LOCKED`, creates one occurrence fingerprint, advances `next_run_at`,
and skips or disables source work whose reviewed policy is no longer executable. Deterministic
jitter is derived from schedule and occurrence identity. After downtime, one latest catch-up run is
eligible and the schedule advances past PostgreSQL `now()`; it does not emit an unbounded backlog.
An active exclusive target suppresses a later occurrence without wedging the scheduler.

`work_items` stores only orchestration lifecycle: enumerated type/class, typed subject foreign key,
requesting actor, priority and eligibility, attempts, retry policy, lease/fencing fields,
correlation/causation, idempotency and exclusive keys, timestamps, and safe diagnostics.
`work_attempts` records each claim and its queue delay, duration, outcome, coverage, bounded counts,
and service principal. `dead_letters` holds terminal safe codes and lineage; it never stores domain
payloads. Requeue creates a new linked WorkItem and is forbidden for owner-scoped work.

Claiming is database-authoritative and uses `FOR UPDATE SKIP LOCKED`. A lease token and monotonically
increasing generation fence start, heartbeat, and finish calls. The scheduler reaps expired leases;
unfinished attempts become `ABANDONED`, attached domain runs become failed, and eligible work enters
`RETRY_WAIT` or `DEAD_LETTERED`. Only ATS, GitHub, public-web search, and Calendar sync heartbeat.
Small work uses a long lease plus bounded execution time.

Retries are classified as `RETRYABLE`, `NON_RETRYABLE`, `RATE_LIMITED`, `AUTH_REQUIRED`, or
`POLICY_BLOCKED`. Exponential delay has deterministic bounded jitter; a valid provider
`Retry-After` is a lower bound. Revoked Calendar credentials become `AUTH_REQUIRED`; forbidden
policy and malformed permanent input are not retried.

## Typed handlers and lanes

There is no dynamic task loading or workflow DSL. `WorkType` is a closed enum mapped to typed Python
handlers:

- `ATS_COLLECT`
- `GITHUB_SYNC`
- `PUBLIC_WEB_SEARCH`, `PUBLIC_WEB_FETCH`, `PUBLIC_WEB_PROCESS`
- `RECRUITER_CAMPUS_PROJECT`
- `CALENDAR_SYNC`
- `PRIVACY_RETENTION_CLEANUP`
- `SOURCE_HEALTH_ROLLUP`

Run independent processes so web fetch pressure cannot starve private or maintenance work:

```bash
uv run recruitintel-collectors scheduler
uv run recruitintel-collectors worker --classes ATS,GITHUB,WEB_SEARCH,WEB_FETCH,PROJECTION,CONTROL
uv run recruitintel-collectors worker --classes CALENDAR --batch-size 2
uv run recruitintel-collectors worker --classes PRIVACY --batch-size 1
```

Use `--once` for deterministic smoke tests. Legacy finite commands enqueue or consume the same
orchestration path; direct GitHub production execution is gone.

## Schedules

Migration 0007 creates disabled templates for every configured ATS source, GitHub repository, and
public-web query. It creates enabled daily schedules for source-health rollup at 02:30 and privacy
retention cleanup at 03:00 in `America/Chicago`. Development seed explicitly enables reviewed
fixture ATS schedules at a one-hour interval. GitHub and public-web schedules stay disabled until an
operator reviews both policy and cadence.

Schedules are enabled only after policy review. Two scheduler processes can run concurrently; the
row lock and occurrence fingerprint enqueue one occurrence.

## Source governance

`source_policies` records provider, collection method, official-API availability, auth mode, robots,
rate/retention/content policies, allowed uses, terms-review state, reviewer/date, maintainer, notes,
and version. `source_policy_host_rules` additionally binds public fetches to reviewed hostname
suffix, subdomain choice, HTTPS requirement, and port set.

Production policies inserted by migration are `REVIEW_REQUIRED`: `greenhouse`, `lever`, `github`,
`web_search`, `public_web`, and `manual`. Unknown providers also fail closed because an executable
policy link is absent. `REVIEW_REQUIRED` cannot schedule; `BLOCKED` cannot claim even when already
queued. The worker checks policy again immediately before a handler, and public fetch checks the
source's hostname/scheme/port rule before DNS. Development seed policies are visibly marked
`DEVELOPMENT_FIXTURE_ONLY` and are not legal/terms determinations.

The search registry always contains the credential-free, non-production `static` provider and may
contain an operator-configured SearXNG adapter. No live commercial vendor is selected. A provider
descriptor states capabilities, hosts, credentials, budget, cost category, zero-cost eligibility,
retry behavior, and terms status. Gate 7.1A adds the canonical offline adapter and transactional
provider budgets. Corrective Gate 7.1A.1 makes known/direct ATS/company/GitHub/university sources
the canonical path and sets `ZERO_COST_MODE=true` by default. Paid providers are rejected by both
the runtime registry and database reservation. SearXNG and each enabled upstream engine need an
explicit review; Gate 7.1B commercial authorization is optional, not required for core operation.

## Fetch safety

Public HTTP uses exactly pinned `httpx==0.28.1` and `httpcore==1.0.9`. For every request and robots
request it:

1. canonicalizes the URL and enforces HTTP/HTTPS plus ports 80/443;
2. checks the source host/scheme/port policy;
3. resolves once and rejects private, loopback, link-local, non-routable, mixed-safe/unsafe,
   IPv4-mapped IPv6, 6to4, Teredo, and local NAT64 targets;
4. passes only an approved IP to the socket backend while retaining the original hostname in the
   HTTP request and TLS `server_hostname`;
5. uses a default validating TLS context and `trust_env=false`, so ambient proxies cannot bypass
   pinning;
6. disables automatic redirects and repeats the complete validation for every redirect target.

Tests assert the actual dial address, original Host header, original TLS SNI/check-hostname state,
rebind resistance, mixed DNS rejection, IPv6 special cases, private redirects, and pinned robots
fetching. The adapter is intentionally small and contract-tested against the exact dependency
versions; upgrading either dependency requires rerunning and reviewing those tests.

## Throttling and telemetry

Bounded process concurrency is combined with lightweight PostgreSQL coordination only where
multiple worker processes need it. `rate_limit_states` keys provider/host identifiers by SHA-256;
raw private URLs and account identifiers are not stored. Provider-specific Retry-After and GitHub
reset timestamps are respected.

Each attempt records correlation ID, class/type, queue delay, execution time, attempt, safe outcome,
coverage, and bounded item counts. `source_health_samples/state/incidents` deterministically track
last success/failure, consecutive failures, rolling success rate, average latency, rate-limit
frequency, coverage, stale sources, and count anomalies. There is no source-health ML.

## Internal administration APIs

All routes require admin identity or a hashed service principal with the named scope:

- `GET /api/admin/work-items` and `GET /api/admin/work-items/:id`
- `POST /api/admin/work-items/:id/requeue` and `POST .../:id/cancel`
- `GET /api/admin/schedules` and `PATCH /api/admin/schedules/:id`
- `GET /api/admin/source-policies` and `PATCH /api/admin/source-policies/:id`
- `GET /api/admin/source-health`
- `GET /api/admin/source-health/incidents` and `PATCH .../incidents/:id`

Read routes require `ORCHESTRATION_READ`; mutations require `ORCHESTRATION_MUTATE` and append an
audit event. Work responses intentionally omit user IDs, Calendar titles/descriptions, provider
emails, notes, credentials, and private URLs. Admin requeue is global-only; an administrator cannot
requeue a user's Calendar work on their behalf.

## Database capabilities

Migration 0007 creates NOLOGIN capability roles:

- `recruitintel_scheduler`
- `recruitintel_worker_global`
- `recruitintel_worker_calendar`
- `recruitintel_worker_privacy`
- `recruitintel_web_app`

Create a `WORKER` service principal, create a separate PostgreSQL login, then bind the login to one
capability and an enumerated class set:

```bash
RECRUITINTEL_DB_ROLE=worker_global \
RECRUITINTEL_SERVICE_PRINCIPAL_ID=... \
RECRUITINTEL_CAPABILITY_ROLE=recruitintel_worker_global \
RECRUITINTEL_WORK_CLASSES=ATS,GITHUB,WEB_SEARCH,WEB_FETCH,PROJECTION,CONTROL \
pnpm --filter @recruitintel/db worker-role:bind
```

Use separate principals/logins for scheduler (`recruitintel_scheduler`, `CONTROL`), Calendar
(`recruitintel_worker_calendar`, `CALENDAR`), and privacy
(`recruitintel_worker_privacy`, `PRIVACY`). The migration owner grants `recruitintel_web_app`
directly to the trusted web-server login; `worker-role:bind` intentionally cannot grant it.

`session_user`, not a payload-supplied owner or role, selects the binding. Calendar credentials are
not readable by the global worker, and the Calendar worker does not inherit global collector data.
The web-app role is a trusted server capability; browser users never receive database credentials,
and Milestone 6 route/repository ownership remains mandatory.

## M9 personalization work

M9 uses the existing M7 scheduler, leases, retries, fencing, and work-item ledger. The only new
work types are `ALERT_FANOUT` (global candidate selection in batches of 250),
`ALERT_EVALUATE` (owner-scoped deterministic rule evaluation), and the associated personalization
class/worker aliases. The hourly `m9-alert-due-scan` schedule handles deadline, opening-window,
and due-calendar checks; canonical opportunity, recruiter, campus, recruiting-date, and interview
changes enqueue semantic evaluation requests transactionally. There is no second scheduler or
external notification queue.

Fanout uses indexed watch, role-family, early-career, experience-level, and target-school joins;
it never scans every user against every opportunity. Owner work contains only private owner IDs and
safe subject IDs/context. Alert insertion is transactional with database fingerprint uniqueness,
so retries, duplicate source events, canonical merges, and concurrent workers converge to one
in-app row. The M9 evaluator has no paid provider, model, embedding, or outbound network path.
