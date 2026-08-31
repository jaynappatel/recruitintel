# Milestone 14 implementation plan

## Objective

Expose privacy-safe, point-in-time recruiting analytics and evidence-gated, offline/shadow ML experimentation. M8--M13 deterministic authority remains unchanged.

## Scope and policy

- Facts are minimized event-to-fact projections; snapshots have `observed_cutoff_at <= as_of_time`.
- Dataset metadata is reproducible (versions, cutoff, filters/exclusions, code/privacy versions and SHA-256 fingerprint). Rows are normalized and dataset-scoped pseudonymous, never raw blobs.
- Valid labels are observed interactions and application stages/outcomes. Soft behavior labels and hiring outcomes remain distinct. LLM outputs, guesses, protected data and future facts are prohibited.
- Candidate tasks (ranking, opening forecast, anomaly, resume outcome and interview topic) are all explicitly readiness-gated. Current default is `NOT_READY` absent enough observed temporal labels.
- Splits are chronological/rolling-origin; no random split or repeated opportunity/company leakage. Features are point-in-time, public where possible, and exclusion of sensitive fields is enforced in code and SQL.
- Models are offline or shadow only. Every evaluation names a deterministic baseline (M9, seasonal/history, M7, M11, or recency frequency). Promotion needs temporal baseline win, calibration/stability/privacy review, reproducibility, shadow history and a rollback plan; M14 has no automatic promotion.
- Private dataset members, snapshots, assignments and predictions cascade on account deletion. A cancelled/deleted owner cannot be recreated by a stale worker because all derived private writes retain FKs to `users`.

## Operations

M7 remains the only orchestration system. Any M14 materializer/rollup/trainer/shadow worker must use idempotency fingerprints, lease fencing, retries/dead letters, bounded safe diagnostics, and finite `--once` execution. Zero-cost mode permits only local PostgreSQL/TypeScript computation; model cost is structurally zero.

## Out of scope

Online training/serving, automatic ranking changes, paid ML/analytics services, GPUs, raw-resume feature warehouse, protected-attribute inference, external datasets, and committing model binaries.
