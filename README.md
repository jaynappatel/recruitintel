# RecruitIntel

RecruitIntel is a provenance-first recruiting intelligence foundation for students and new graduates. Milestones 1–4 collect public Greenhouse/Lever jobs, configured GitHub recruiting files, and permitted public recruiting pages; normalize jobs, interview questions, recruiter/school relationships, campus events, and web evidence deterministically; store current state plus source evidence; and emit immutable recruiting events. It does not use an LLM or make hiring predictions.

## Architecture

```text
Greenhouse / Lever       Official GitHub API       SearchProvider / public HTML
        |                         |                          |
ATS adapters          commit-aware file parsers      safe fetch/extraction
        |                         |                          |
        +--------- deterministic normalization/change detection --------+
                                      |
                                PostgreSQL 17
                         current state / evidence / events
                                      |
                            Next.js server routes and UI
```

PostgreSQL is the coordination boundary between the run-once Python collectors and the Next.js application. Adapters do not contain database code; normalization and hashing are pure; only complete successful source snapshots may close missing jobs. See [system design](docs/system-design.md), [reference review](docs/reference-architecture.md), and the [implementation plan](docs/implementation-plan.md).

## Requirements

- Node.js 20.19 or newer (Node 22 LTS is also suitable)
- Corepack and pnpm 10.34.5
- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Docker with Compose, or an existing PostgreSQL 15+ database

## Install

```bash
cp .env.example .env
corepack enable pnpm
pnpm install
uv sync
```

Never commit `.env` or provider credentials. Public ATS endpoints need no token. `GITHUB_TOKEN` is optional and raises official API limits; it is worker-only and never logged. The initial `static` public-web search provider needs no credential.

## Database setup

Start the local PostgreSQL 17 service, apply migrations, and load deterministic development data:

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm db:smoke
```

`DATABASE_URL` defaults only in `.env.example`; export it or load `.env` in your shell before running commands. The checked-in seed is idempotent. Its jobs and GitHub question observations are synthetic UI/API examples marked `seed: true, live: false`; they are not claims about current openings or interviews.

Migrations are ordered SQL files in `packages/db/migrations`. The runner stores a checksum in `schema_migrations` and refuses to accept edits to an already-applied migration. Add a new numbered migration instead.

## Run the web application

```bash
pnpm dev
```

Open `http://localhost:3000`. Milestone 1 routes are `/dashboard`, `/companies`, `/companies/[slug]`, `/jobs`, and `/events`. Read APIs are available under `/api/companies`, `/api/jobs`, and `/api/events`, with company-specific job/event routes. Inputs are validated with Zod, and raw provider payloads are never returned to the browser.

## Run collectors

List configured ATS source IDs:

```bash
uv run recruitintel-collectors list-sources
```

Run exactly one source:

```bash
uv run recruitintel-collectors run --source-id 21000000-0000-0000-0000-000000000001
```

The process exits after one observable run, which makes it schedulable later by cron, GitHub Actions, Supabase scheduling, Celery, or Temporal without coupling collection semantics to a scheduler. Configure an honest contact address in `RECRUITINTEL_USER_AGENT`. Do not schedule a source until its first-party ATS identifier and permitted public endpoint have been verified.

## Add a company and ATS source

Milestone 1 intentionally has no unauthenticated mutation endpoint. Add reviewed records through a new seed/local SQL file or an administration migration:

1. Insert the canonical company, aliases, and domains.
2. Insert one `sources` row with `source_type = 'ATS'`, provider `greenhouse` or `lever`, the public tenant key, reliability metadata, and the owning company ID.
3. Set Lever `metadata.region` to `"eu"` only for an EU-hosted board; the default is `"us"`.
4. Run `list-sources`, then run the new source once and inspect `collector_runs`, `collector_errors`, jobs, and events before scheduling it.

Do not infer aliases from fuzzy similarity. Canonical merges must be supported by reviewed names or domains.

## Create a collector

Add a provider adapter under `services/collectors/src/recruitintel_collectors/adapters` that implements the shared `BaseCollector` lifecycle and returns normalized Pydantic models. Keep HTTP/provider mapping in the adapter, deterministic rules in `domain`, and SQL in the repository adapter. Register the provider in the CLI only after adding fixtures for successful, malformed, paginated, and partial responses. An incomplete fetch must set the result incomplete or raise a staged error; it must never reach closure-capable persistence.

## GitHub repositories and parsers

Set `RECRUITINTEL_ADMIN_TOKEN`, attach a repository through `POST /api/companies/:identifier/github-repositories`, and queue it through `POST /api/github/sync/:repositoryId`. Execute the durable request with:

```bash
uv run recruitintel-collectors github-sync \
  --repository-id REPOSITORY_UUID \
  --request-id REQUEST_UUID
```

A direct local run may omit `--request-id`. Identical commit SHAs skip file fetching. Markdown tables, CSV, and JSON are supported through pure parser plugins; unresolved companies/questions are retained. See [GitHub intelligence](docs/github-intelligence.md) for configuration, exact API contracts, provenance, rates, and adding parsers.

## Public web intelligence

Set `RECRUITINTEL_ADMIN_TOKEN`, queue bounded query templates through `POST /api/companies/:identifier/web-search`, and execute each returned durable request with:

```bash
uv run recruitintel-collectors public-web-work --request-id REQUEST_UUID
```

`WEB_SEARCH` creates canonical candidate URLs and queues bounded fetches. `WEB_FETCH` applies URL/DNS/redirect/robots/rate/size protections, extracts normalized HTML, and stops on unchanged hashes. `WEB_PROCESS` creates source observations, supported/conflicting claims, and meaningful idempotent events. The initial `static` provider reads optional deterministic results from `PUBLIC_WEB_STATIC_RESULTS_FILE`; add a reviewed search API through the provider interface for production discovery.

See [public web intelligence](docs/public-web-intelligence.md) for exact API contracts, JSON provider format, query budgets, safe-fetch controls, worker behavior, and troubleshooting. Public-web processing stores normalized text rather than raw HTML and never executes page JavaScript.

## Recruiter and campus intelligence

Successful `WEB_PROCESS` work consumes its normalized observations into the recruiter/campus graph. To process an existing Milestone 3 observation without another fetch:

```bash
uv run recruitintel-collectors recruiter-campus-process \
  --observation-id PUBLIC_RECRUITING_OBSERVATION_UUID
```

Read APIs cover recruiters by company, recruiter detail/evidence, campus events by company, and schools with related companies/recruiters/events. Admin-authenticated POST routes create a recruiter or append immutable evidence. Manual and public LinkedIn URLs are references only: the fetcher blocks LinkedIn before HTTP and does not use authentication, browser automation, cookies, or CAPTCHA bypass.

See [recruiter and campus intelligence](docs/recruiter-campus-intelligence.md) for exact contracts, identity/deduplication rules, title classification, evidence/relevance calculation, freshness, worker integration, search-provider configuration, and troubleshooting.

## Quality checks

TypeScript/Next.js:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Python:

```bash
uv run ruff format --check services/collectors
uv run ruff check services/collectors
uv run mypy --config-file pyproject.toml services/collectors/src
uv run pytest
```

The default tests are deterministic and offline. They cover company/job/question/person/school normalization, recruiter title and role classification, Greenhouse/Lever/GitHub parsing, GitHub URL and rate-limit safety, public-web URL/SSRF/redirect/robots/restricted-site/size controls, deterministic HTML/relevance/date/campus extraction, relationship strength and freshness, duplicate identities, idempotent observations/events, unresolved/conflicting evidence, analytics, job lifecycle transitions, and failed/partial-sync safety.

To exercise the PostgreSQL repository itself, create and migrate the isolated database once, then opt into the integration marker:

```bash
docker compose exec postgres createdb -U recruitintel recruitintel_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
uv run pytest -m integration
```

The integration fixtures use reserved test UUIDs. They verify the full ATS lifecycle, a synthetic GitHub flow from sync through analytics, a synthetic public-web flow from search through candidate deduplication/fetch/change/no-op/observations/conflicts/events, recruiter/campus flow from public observation through typed projection, and the recruiting-date/application-plan/calendar/mock-provider path through retry-safe external mappings. Never set `TEST_DATABASE_URL` to a shared or production database.

## Environment variables

All supported values and local defaults are in `.env.example`:

- `DATABASE_URL`: application and collector PostgreSQL connection;
- `TEST_DATABASE_URL`: reserved for opt-in integration tests; never points tests at production;
- `RECRUITINTEL_USER_AGENT`: identifying provider request header;
- `GITHUB_TOKEN`: optional worker-only official GitHub API token;
- `RECRUITINTEL_ADMIN_TOKEN`: bearer token for GitHub, public-web, and recruiter-evidence mutations;
- `RECRUITINTEL_MVP_OWNER_ID`: server-resolved Milestone 5 owner UUID (not browser-selected);
- `RECRUITINTEL_APP_URL`: base URL used for bounded calendar description links;
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`: Google web-server OAuth;
- `CALENDAR_TOKEN_ENCRYPTION_KEY`: 32-byte AES-GCM key shared by web and finite worker;
- `PUBLIC_WEB_STATIC_RESULTS_FILE`: optional JSON fixture/provider input keyed by exact generated query;
- `PUBLIC_WEB_MAX_RESPONSE_BYTES`: independent public HTML response limit;
- `PUBLIC_WEB_REQUESTS_PER_SECOND`: per-host public-web request rate;
- collector timeout, response-size, rate, and bounded-concurrency settings;

## Safety and data handling

- ATS/GitHub URLs come from fixed hosts. Public-web URLs are HTTP/HTTPS-only, DNS/private-network and redirect validated, robots-aware, restricted-site-aware, and time/rate/size bounded. LinkedIn URLs may be stored but are never fetched.
- External HTML is converted to normalized plain text and is neither retained nor rendered. Raw provider JSON remains untrusted and is never rendered.
- Source reliability is an internal ranking signal, not a truth claim.
- Current jobs are projections; snapshots, observations, and events preserve provenance/history.
- A failed, partial, malformed, or concurrent sync cannot infer mass closures.
- Collected text must never be promoted into executable instructions for a future LLM.

See the [Milestone 1 record](docs/milestone-1.md), [GitHub intelligence](docs/github-intelligence.md), [public web intelligence](docs/public-web-intelligence.md), [recruiter and campus intelligence](docs/recruiter-campus-intelligence.md), [recruiting calendar contracts](docs/recruiting-calendar.md), [Google Calendar setup](docs/google-calendar-integration.md), and [ML roadmap](docs/ml-roadmap.md) for implemented scope and future boundaries.
