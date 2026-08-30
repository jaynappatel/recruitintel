# Private-beta launch guide (M20)

## Access and support

Set `PRIVATE_BETA_MODE=true` in production. Non-admin sessions require an active,
server-enforced email grant in `beta_access_grants`; administrators can create,
list, and revoke grants through the authenticated `/api/admin/beta-access` routes.
There are no bearer invite tokens, client-side allowlists, or separate identities.
Revoking a grant blocks the next authenticated request without exposing private data.

Use M15 aggregate diagnostics for support. They intentionally do not expose resume
contents, outreach bodies, interview-prep data, OAuth credentials, cookies, or DOM
captures. Collect support reports through the approved operator channel; M20 does
not add a private-content feedback warehouse.

## Required production configuration

Readiness requires `DATABASE_URL`, a 32+ character `BETTER_AUTH_SECRET`, a valid
`BETTER_AUTH_URL`, a 32-byte `RESUME_STORAGE_KEY`, `ZERO_COST_MODE=true`, and
`PRIVATE_BETA_MODE=true`. Readiness reports only `configuration: invalid`, never
secret values. `AUTH_GOOGLE_*`, `GOOGLE_*`, `CALENDAR_TOKEN_ENCRYPTION_KEY`, and
extension grants are optional integrations: their absence must not disable the
core web workflow.

## Release checklist

1. Run format, lint, typecheck, all tests, dependency/license review, and build.
2. Take and verify an encrypted PostgreSQL backup; run the migration job once and rerun it.
3. Probe `/api/health` and `/api/ready`; verify security headers and migration count.
4. Use disposable beta accounts for the authenticated discovery-to-outcome smoke,
   including export/delete, extension-grant revocation, outreach, and interview prep.
5. Confirm `ZERO_COST_MODE=true`, `search_paid_spend_micros=0`, and
   `model_paid_spend_micros=0`.
6. Record the restore-drill result and redacted evidence hash in the M15 recovery log.
7. If launch validation fails, roll back the application/configuration. SQL migrations
   are forward-only: use a reviewed corrective migration or restore the verified backup.

## Operations and degradation

Run M7 workers with their existing finite `--once`/lease-fenced procedures; no paid
scheduler is required. Google Calendar remains optional, manual M18 outreach works
without Gmail, M13 has deterministic fallback, and the web remains useful without
the extension. The MV3 build must remain signed/reviewed, `activeTab`-only, and
selected-import-only; revoke a compromised grant immediately.

See [production-operations.md](production-operations.md) for incident response,
backup/restore, rollback, worker recovery, retention, and redaction rules, and
[m19-source-license-audit.md](m19-source-license-audit.md) for the excluded
interview-question dataset decision.
