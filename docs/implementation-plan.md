# RecruitIntel implementation plan

**Status (2026-08-18):** Milestones 1, 2, 3, and 4 are implemented and verified. Milestone 1 details are in `docs/milestone-1.md`; GitHub/interview-question operation and API contracts are in `docs/github-intelligence.md`; public-web operation is in `docs/public-web-intelligence.md`; recruiter/campus architecture and exact APIs are in `docs/recruiter-campus-intelligence.md`.

## Repository decision

Create a new monorepo in `/Users/jaynapatel/Desktop/RecruitIntel`. The directory contained no application, package manager configuration, Git repository, or working components to preserve. Nearby downloaded projects remain read-only references and are not vendored.

## Proposed folder tree

```text
RecruitIntel/
├── apps/
│   └── web/                         # Next.js app, route handlers, basic UI
├── services/
│   └── collectors/                  # Python package and run-once CLI
│       ├── src/recruitintel_collectors/
│       │   ├── adapters/            # Greenhouse and Lever
│       │   ├── domain/              # normalized contracts and enums
│       │   ├── github/              # API client, parsers, resolution, sync runner
│       │   ├── infrastructure/      # HTTP and PostgreSQL adapters
│       │   └── pipeline/            # normalization/change orchestration
│       └── tests/
├── packages/
│   ├── db/                          # SQL migrations, seeds, TS DB access
│   ├── shared/                      # TS utilities and stable vocabularies
│   └── types/                       # Zod API/domain contracts
├── scripts/                         # migration/seed/dev helpers
├── infra/                           # local PostgreSQL compose/config
├── docs/
├── tests/
│   └── fixtures/                    # provider payload fixtures
├── .env.example
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── pyproject.toml                   # uv workspace/tooling configuration
└── README.md
```

The Python package owns collection semantics. `packages/db` owns database schema and web query access. Neither application imports implementation code from the other language.

## Milestone 1 recommendation

Build a narrow vertical slice that proves the event-sourced recruiting core:

1. Start local PostgreSQL and apply a versioned initial migration.
2. Seed several companies, ATS sources, and deterministic demo jobs/events.
3. Run a Greenhouse or Lever source sync from a Python CLI.
4. Normalize and classify the returned jobs using pure rules.
5. Persist new/current/snapshot/provenance state transactionally.
6. Re-run the same fixture and observe only liveness changes.
7. Change a fixture and observe exactly one `JOB_CHANGED` event.
8. Remove a fixture item from a complete successful sync and observe exactly one `JOB_CLOSED` event.
9. Browse companies, jobs, and immutable event timelines in the Next.js UI.

This is the smallest milestone that validates maintainability, provenance, deduplication, lifecycle safety, and cross-stack integration without prematurely building unrelated intelligence features.

## Milestone 1 scope

### 1. Monorepo and tooling

- pnpm workspace with Next.js, TypeScript, Tailwind, ESLint, and Vitest.
- uv-managed Python package with Pydantic, HTTPX, Psycopg, pytest, Ruff, and mypy/pyright-equivalent strict checking.
- Shared root commands for lint, type checking, tests, migrations, seeds, web dev, and collectors.
- `.env.example`, `.gitignore`, Docker Compose PostgreSQL, and README.

Acceptance:

- A new developer can start PostgreSQL, install both language workspaces, migrate, seed, run the UI, and run tests from documented commands.

### 2. PostgreSQL schema

Implement only the core tables described in `docs/system-design.md`:

- companies, company aliases, company domains;
- sources;
- jobs and job snapshots;
- observations;
- recruiting events;
- collector runs and collector errors.

Acceptance:

- Migrations apply to an empty PostgreSQL database.
- Seed is idempotent.
- Database constraints reject duplicate job identities and event fingerprints.
- Indexes support open-job and company-timeline access paths.

### 3. Collector contracts and adapters

- `BaseCollector` protocol/abstract class.
- `CollectorResult`, `NormalizedObservation`, `NormalizedJob`, and run statistics.
- Shared async HTTP client with fixed-host policy, timeouts, bounded retries, rate limits, response size limit, and structured logging.
- Greenhouse Job Board API adapter.
- Lever Postings API adapter, including EU-host configuration support.
- Fixture-based adapter tests; network smoke tests are opt-in and not required for the default suite.

Acceptance:

- Provider payloads normalize to the same Pydantic model.
- Adapters contain no database code.
- A malformed response produces an explicit collector error and cannot trigger closure.

### 4. Normalization, classification, hashes, and events

- Unicode/text/URL normalization.
- Deterministic role-family, internship, new-grad, and experience-level rules.
- Versioned canonical SHA-256 content fingerprints.
- Versioned event fingerprints.
- Transactional new/change/unchanged/reopen/close behavior.
- A complete-sync guard before closing absent jobs.

Acceptance:

- Identical normalized content is a no-op except for liveness counters/timestamps.
- Cosmetic whitespace/HTML differences do not produce events.
- Meaningful content changes produce one `JOB_CHANGED` event.
- Event uniqueness makes a retried write idempotent.
- Failed/partial sync tests prove no jobs close.

### 5. Basic web/API slice

- Professional but deliberately small navigation shell.
- Dashboard summary using seed/database data.
- `/companies`, `/companies/[slug]`, `/jobs`, and `/events`.
- Company detail includes overview, open jobs, and recent events; future tabs may be visibly disabled or omitted.
- Validated APIs for companies, jobs, and events.
- Empty, loading, error, and database-not-configured states.

Acceptance:

- No external request is needed to render seed data.
- Raw provider HTML/payload is never rendered.
- TypeScript contracts validate route inputs and serialized outputs.

### 6. Tests and documentation

Required deterministic tests:

- company name/alias/domain normalization;
- Greenhouse and Lever job normalization;
- role classification;
- content fingerprint stability and meaningful changes;
- job identity deduplication;
- event fingerprint stability and event deduplication;
- open/change/unchanged/reopen/close pipeline behavior;
- incomplete-sync closure protection;
- basic API/data mapping tests.

Documentation includes architecture, setup, environment, migrations, seeds, collector operation, adding companies/sources, adding adapters, and troubleshooting.

## Milestone 1 implementation sequence

1. Create design documents (completed before code).
2. Scaffold workspace/tooling and verify minimal commands.
3. Add migration, migration runner, and seed.
4. Implement Python domain models and pure normalization/fingerprint rules.
5. Implement provider adapters and fixture tests.
6. Implement repository port, in-memory test repository, and PostgreSQL repository.
7. Implement sync orchestration and lifecycle/event tests.
8. Implement web database access, APIs, and basic pages.
9. Run all format, lint, type, unit, build, and available integration checks.
10. Update README and record remaining issues; stop.

## Milestone 2 completion record

Milestone 2 implements:

- official GitHub API metadata, default-branch, commit, compare/tree, Contents API, and rate-limit handling behind `GitHubClient`;
- many-to-many company/repository configuration, durable sync requests, commit state, and typed run metrics;
- SHA short-circuiting, safe watched-path selection, bounded file/response/concurrency limits, and transactional state advancement;
- pure Markdown table, CSV, and JSON document parsers plus interview-question and internship/new-grad semantic parsers;
- deterministic company alias resolution with unresolved evidence rather than guesses;
- deterministic LeetCode number/slug/title normalization and conflict-safe canonical resolution;
- separate canonical questions, company/question associations, and immutable source observations;
- GitHub job rows normalized into the existing Milestone 1 `Job` model with complete repository/path/SHA/URL/time provenance;
- idempotent `GITHUB_REPOSITORY_UPDATED`, `INTERVIEW_QUESTION_ADDED`, meaningful question-update, and job transition events;
- deterministic company analytics for observation/source counts, recency, topics, and difficulty;
- typed repository, sync-request, company analytics, and question-detail API contracts without frontend component changes;
- synthetic offline fixtures/seed evidence and a PostgreSQL end-to-end test covering sync through analytics and same-commit retry.

Verification completed:

- 51 Python tests passed, including Milestone 1 and two PostgreSQL integrations;
- 17 TypeScript/Vitest tests passed across database, shared, types, and web packages;
- Ruff format/lint, strict mypy, ESLint, and all TypeScript type checks passed;
- the Next.js 16 production build passed with every Milestone 2 route compiled;
- migrations applied and re-ran idempotently; seed applied twice; schema/constraint/analytics smoke passed;
- local HTTP smoke returned validated repository, analytics, and question-detail provenance contracts.

Known Milestone 2 technical debt:

- the sync POST route persists a durable request; deployment still needs an external scheduler/worker invocation because an always-on queue was intentionally out of scope;
- incremental GitHub job imports do not infer closures from missing rows; closure needs a complete repository-scope snapshot policy;
- YAML and files too large for GitHub's Contents API are not supported in the initial safe parser set;
- canonical conflicts and unresolved companies need a future administrative review workflow;
- one admin bearer token is sufficient for local/MVP mutation boundaries but should become scoped user/service authorization later;
- the conservative global PostgreSQL advisory lock serializes canonical-question resolution and may need a narrower identity lock at high ingestion volume.

## Milestone 3 completion record

Milestone 3 implements:

- provider-independent search, fetch, content-extraction, relevance, structured-extraction, and repository interfaces;
- configurable company/role/school/year/focus query templates and persisted per-query search budgets;
- a credential-free static/JSON provider for deterministic local operation and an adapter registration boundary for future permitted search APIs;
- deterministic URL canonicalization, tracking removal, redirect revalidation, DNS/private-network SSRF controls, robots checks, host rate limits, retries, timeouts, content-type and response-size limits;
- deterministic normalized HTML extraction and hashing without raw HTML retention, JavaScript execution, or mandatory LLM calls;
- candidate URL/discovery state, immutable normalized document versions, source-specific recruiting observations, lightweight supported/conflicting claims, and school/job evidence links;
- meaningful, idempotent existing recruiting event types for articles, dates, campus activity, interviews, hiring signals, and changed career pages;
- durable finite `WEB_SEARCH`, `WEB_FETCH`, and `WEB_PROCESS` work requests with bounded retries and observable run/error metrics;
- typed company summary, observation/detail, claim, search-state, search-queue, and candidate-fetch APIs without frontend component changes;
- wholly synthetic offline fixtures and a PostgreSQL end-to-end test covering search through candidate deduplication, fetch, change/no-op detection, observations, conflicts, events, and API projection fields.

Verification completed:

- 61 Python tests passed, including all three PostgreSQL integrations;
- 20 TypeScript/Vitest tests passed across database, shared, types, and web packages;
- Ruff format/lint, strict mypy, ESLint, TypeScript type checks, and Prettier checks passed;
- migration `0003_public_web_intelligence.sql` applied to empty Milestone 1–2 state and re-ran idempotently;
- the development seed applied twice and database schema/deduplication smoke passed;
- the Next.js 16 production build and local HTTP contract smoke passed for Milestone 3 routes.

Known Milestone 3 technical debt:

- the initial search provider is fixture/static only; a production deployment must add and terms-review a real search API adapter;
- durable requests still need an external scheduler/worker invocation;
- the HTML extractor is intentionally deterministic and does not render JavaScript-heavy pages;
- robots rules are cached for the lifetime of one finite worker process and operators remain responsible for source-specific terms;
- DNS validation occurs immediately before HTTP requests, but a hardened deployment should also enforce egress/network policy to defend in depth against DNS rebinding;
- school linking uses reviewed exact domains; school administration and recruiter graph relationships remain deferred;
- date and claim extraction is conservative and English-oriented;
- the one admin bearer token remains an MVP boundary that should become scoped service/user authorization later.

## Milestone 4 completion record

Milestone 4 implements:

- canonical people plus conservative exact recruiter deduplication by company/name or unique public profile identity;
- recruiter profiles, deterministic title categories, immutable evidence, school and role-family projections, and unresolved references;
- reviewed school aliases/location fields and deterministic alias resolution;
- campus recruiting event projections with date certainty and independent observation evidence;
- transparent categorical relationship strength with rule reasons and current/aging/stale/unknown freshness;
- direct consumption from Milestone 3 `WEB_PROCESS` plus a finite command for already-normalized observations;
- idempotent recruiter discovery/activity, school signal, and campus-event recruiting events;
- stable typed company/recruiter/school/event APIs and admin-authenticated manual recruiter/evidence creation;
- explicit LinkedIn host/redirect fetch denial while public profile URLs may remain references;
- synthetic unit and PostgreSQL coverage through observation extraction, graph persistence, retry, events, and API projection.

Verification completed:

- 71 Python tests passed, including all PostgreSQL integrations;
- 26 TypeScript/Vitest tests passed across database, shared, types, and web packages, including the observation-to-API PostgreSQL projection;
- Ruff format/lint, strict mypy, ESLint, TypeScript type checks, and Prettier checks passed;
- migration `0004_recruiter_campus_intelligence.sql` applied from empty state and skipped cleanly on rerun;
- the updated development seed applied twice and the expanded schema/deduplication smoke passed;
- the Next.js 16 production build compiled every Milestone 4 route;
- production-server HTTP smoke passed for recruiter creation/evidence, recruiter/company/school reads, and populated campus-event reads.

Known Milestone 4 technical debt:

- deterministic free-text extraction is conservative and primarily English-oriented; the optional LLM interface is intentionally disabled;
- a production deployment still needs a reviewed `SearchProvider`; the built-in static provider is fixture-oriented;
- unresolved records have storage/status but no administration UI or resolution endpoint;
- current relationship projections are recomputed when evidence arrives; API freshness prevents old `ACTIVE` state from being presented as current, but there is no scheduled stale-status materialization job;
- person identity has no fuzzy/biographical entity resolution by design; ambiguous identities require review;
- the MVP admin bearer token should become scoped service/user authorization;
- durable work still needs an external scheduler invocation.

## Milestone 5 — Recruiting calendar and application planning (implemented)

The user-directed Milestone 5 supersedes the earlier placeholder grouping. It adds:

- provenance-preserving recruiting dates derived from public observations and campus events;
- owner-scoped calendar items with explicit all-day/local-time semantics;
- configurable deterministic application plans and topic-aware, caveated interview prep metadata;
- Google web-server OAuth with single-use state, PKCE, narrow scopes, and encrypted refresh tokens;
- provider-neutral one-way sync, durable finite-worker requests/runs, and idempotent external mapping;
- stable typed APIs and an exact adapter handoff for Claude's existing mock-backed UI.

Implementation and operating contracts are in `docs/recruiting-calendar.md` and
`docs/google-calendar-integration.md`.

## Deferred work (not started)

Watchlists, alerts/notification delivery, the application-tracking CRM, activity scoring,
multi-user authentication, and production deployment remain unsequenced and untouched.

### Analytics and ML dataset preparation

Point-in-time feature jobs, data quality reporting, leakage-safe labeled datasets, seasonal baselines, logistic regression baseline design, and model monitoring. Model training starts only when history and label quality justify it.

## Explicitly out of Milestone 1

- Ashby and all other ATS providers beyond Greenhouse/Lever.
- GitHub repositories and parsers.
- Interview-question aggregation.
- Recruiter/person/school/campus models.
- Public-web search and arbitrary URL fetching.
- Watchlists, authentication, alerts, and external notifications.
- Activity score and anomaly product features.
- Embeddings, pgvector use, LLM extraction, and any ML model.
- Redis, BullMQ, Celery, Temporal, or always-on worker infrastructure.

## Risks and controls

| Risk                            | Control in Milestone 1                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Provider response change        | Strict Pydantic models at the boundary, fixtures, explicit errors, opt-in smoke tests |
| False mass closures             | Close only after a complete successful source sync; transaction and advisory lock     |
| Duplicate jobs/events           | Database uniqueness plus deterministic fingerprints                                   |
| Hash churn                      | Versioned canonicalization and golden tests                                           |
| Untrusted external HTML         | Sanitize at collection, store raw JSON separately, render plain normalized text       |
| Expensive unchanged processing  | Hash gate before snapshots/events or future enrichment                                |
| License contamination           | No copied reference datasets/code; maintain a source/license register                 |
| Scheduler lock-in               | Run-once CLI boundary and persisted run state                                         |
| Cross-language vocabulary drift | Central documented enums and parity tests                                             |

## Completion gate

Milestone 1 is complete only when:

- migrations and seed apply cleanly;
- default Python tests pass;
- TypeScript tests pass;
- lint and formatting checks pass;
- Python and TypeScript type checks pass;
- the Next.js production build passes;
- collector lifecycle tests cover new/change/unchanged/close and incomplete-sync safety;
- README commands are verified or any environment-specific limitation is documented.

After meeting the gate, summarize the implemented scope and remaining issues and wait for the next instruction.
