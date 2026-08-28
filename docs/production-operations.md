# Production operations (M15)

## SLOs and signals

The availability SLO is 99.9% monthly successful `GET /api/health` responses;
readiness (`GET /api/ready`) must prove the current database schema can be read.
The error-budget alert is 0.1% of monthly probe intervals. Alert on readiness
failure for two consecutive minutes, a dead-letter increase, expired M7 leases,
or source-health coverage becoming stale. Logs are structured and redacted; never
put headers, cookies, tokens, email, URLs with queries, resume content, browser
DOM, or provider responses in telemetry.

## Deployment and rollback

1. Generate SBOM/license reports and run lint, typecheck, test, build, and image
   vulnerability scans in CI. Pin image and dependency versions.
2. Take and verify an encrypted PostgreSQL PITR-capable backup. Run the migration
   job once with the migration role, then rerun it to prove checksum-safe no-op.
3. Deploy the non-root web role and separately deploy M7 worker roles with their
   existing least-privilege PostgreSQL bindings. Workers do not receive web auth
   secrets; web does not receive worker credentials.
4. Probe `/api/ready`, then run an authenticated discover-to-outcome smoke using
   a disposable account. Confirm extension grants can be revoked.
5. Roll back application images/configuration if probes fail. Do not reverse an
   applied SQL migration; use a reviewed forward corrective migration.

## Incident and recovery

For a security incident: stop affected deploys, revoke extension grants/service
principals and OAuth connections as applicable, rotate the affected secret via the
secret manager, invalidate sessions if required, and preserve only redacted audit
records. For a worker incident, stop the worker and allow M7 leases/fencing to
recover; never manually replay external side effects outside its idempotency path.

Quarterly, restore a fresh encrypted backup into an isolated database, run the
full migration rerun and privacy-delete verification, then record a `PASSED` or
`FAILED` aggregate drill entry with a SHA-256 hash of the redacted evidence.
Quarterly key rotation validates old ciphertext decrypts before re-encryption and
that no plaintext credential enters logs. Failed drills page the on-call owner.

## Privacy, extension, and capacity

Privacy exports/deletes use M6 endpoints and the existing deletion work/fencing;
verify `private_owner_orphans = 0` after every restore drill. The extension stays
MV3, `activeTab`, explicit scan/selection, and selected-only ingestion. Release
only signed reviewed builds; revoke grants immediately for a compromised build.

Capacity is bounded by PostgreSQL connection pools, worker batch sizes and M7
leases. Scale web and worker replicas independently after a load/soak test; do
not increase collector concurrency beyond provider policy or cost budget. Keep
`ZERO_COST_MODE=true`; `search_paid_spend_micros` and `model_paid_spend_micros`
must remain zero in release acceptance.
