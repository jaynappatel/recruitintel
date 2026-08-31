# Milestone 10 implementation notes

M10 adds the private application projection, cycle-aware duplicate protection, append-only outcome ledger, assessment/interview records, owner-scoped APIs, and additive links to ApplicationPlan, Calendar, recommendations, alerts, and M6 instrumentation.

Migration: `0014_application_tracking.sql`.

The implementation is deterministic and zero-cost: it uses PostgreSQL and existing application services only. It introduces no LLM, ML, embeddings, paid API, notification provider, or second scheduler. Application events are append-only and historical canonical opportunity/source-posting identifiers are preserved through merge/split resolution.

Database validation requiring `TEST_DATABASE_URL` remains an environment prerequisite; no external provider calls are part of M10.
