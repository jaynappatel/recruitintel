# Milestone 1 implementation record

## Implemented scope

- pnpm/uv monorepo with a Next.js web application, shared TypeScript packages, and an independently runnable Python collector package;
- PostgreSQL schema for companies, aliases/domains, sources, current jobs, snapshots, observations, immutable recruiting events, collector runs, and collector errors;
- checksum-tracked SQL migration and an idempotent, explicitly synthetic development seed;
- deterministic company/job normalization, role and early-career classification, SHA-256 job/event fingerprints, and lifecycle transitions;
- Greenhouse and Lever adapters over a fixed-host async HTTP client with timeout, retry, response-size, pacing, and identifying-user-agent controls;
- transactional PostgreSQL persistence with per-source concurrency protection and a complete-sync closure guard;
- an opt-in PostgreSQL integration test covering open, unchanged, changed, closed, and reopened persistence against an isolated test database;
- basic database-backed company, job, and event pages and read APIs;
- fixture/unit coverage for the critical deterministic pipeline.

## Deferred by design

Recruiters, people, schools, campus events, GitHub watchers, interview questions, public-web search, arbitrary URL fetching, watchlists, alerts, activity scoring, authentication, embeddings, LLM extraction, and ML are not part of this milestone.

## Remaining issues and operating notes

- Live ATS contract checks are opt-in because they require network access and can fail due to provider changes or tenant migrations. The default suite uses committed fixtures.
- A full production deployment still needs managed secrets, TLS, backups, least-privilege database roles, runtime rate limiting for public APIs, and deployment-specific health/metrics wiring.
- Source board identifiers in the development seed are examples and should be verified before enabling scheduled collection. A failed or incomplete collector run is recorded and cannot close jobs.
- Milestone 1 has no authenticated mutation API. Companies and ATS sources are added with reviewed SQL; the collector runs from a finite CLI command.
- The seed contains synthetic UI jobs under the reserved `.invalid` domain. They are labeled as examples and never presented as live application links.
- PostgreSQL is pgvector-ready in architecture, but the extension and embeddings are intentionally absent until a justified use case exists.
- Concurrent calendar/planner UI work present in the workspace is user-owned and is not part of this milestone’s recruiting-core implementation or acceptance claims.
