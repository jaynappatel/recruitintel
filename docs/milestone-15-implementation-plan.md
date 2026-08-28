# Milestone 15 implementation plan

## Authoritative objective

Operate the completed personal platform safely and recoverably. M15 is production
hardening and deployment, not a production-ML milestone. The authoritative source
is `docs/final-architecture-roadmap.md` § Milestone 15.

## Delivered scope

- Isolated, non-root web deployment template with read-only filesystem, secret
  injection, health/readiness probes, CSP and baseline browser security headers.
- Safe public liveness/readiness routes and an authenticated aggregate-only admin
  operations diagnostic. Neither returns credentials, identifiers, user content,
  URLs, raw work payloads, or model data.
- Forward-only `0035_m15_operations.sql` recovery-drill evidence table. It stores
  only a drill type/result/time/runbook version/evidence hash; not backups, user
  IDs, logs, or secrets.
- Versioned SLO, incident, restore, key-rotation, privacy, worker, extension, and
  release procedures in `docs/production-operations.md`.

## Integration and constraints

M6 identity, export/delete and encrypted credentials remain authoritative. M7
remains the sole worker control plane; web and workers must use distinct database
roles and service principals. M8 historical identity, M9 deterministic ranking,
M10 append-only outcomes, M11 deterministic eligibility/matching, M12 explicit
MV3 ingestion, M13 bounded AI, and M14 point-in-time offline/shadow analytics are
unchanged. No schema/API surface accepts a user/owner identifier as authority.

M15 has no user-facing product workflow beyond safe service availability and
administrator diagnostics. It adds no extension permission, notification,
external side effect, paid provider, ML feature, training label, ranking input, or
model promotion. Existing candidate readiness stays `NOT_READY` until genuine
M14 evidence gates are met.

## Acceptance invariants

- Health and readiness do one aggregate database probe and redact all failures.
- Admin diagnostics require existing Better Auth admin/service authorization and
  expose counts/statuses only.
- Recovery evidence is append-only operational metadata with a SHA-256 evidence
  reference; execution records are idempotent by the table uniqueness constraint.
- Deploys run migrations as a one-off, backup verified step before web/worker
  rollout; rollback is application rollback, never a destructive migration
  reversal.
- ZERO_COST_MODE remains enabled in deployment; no new dependency or provider is
  introduced.

## Out of scope

Managed-cloud provisioning credentials, a hosted queue, object-store upload,
automatic backup mutation, email/push delivery, autonomous applications, mobile,
new browser permissions, online learning, and model promotion. These require
environment-specific authority and are intentionally represented as runbooks and
deployment contracts rather than unsafe local automation.
