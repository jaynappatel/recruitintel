# Milestone 11 Implementation Notes

Milestone 11 is implemented as a deterministic, zero-cost resume evidence and exact-job matching layer. It does not add M12 browser intake, a paid provider, an LLM requirement, embeddings, or a second scheduler.

## Runtime and data boundary

Migrations `0019_resume_evidence_matching.sql` through `0031_m11_runtime_acceptance.sql` add encrypted resume objects, immutable resume versions, parse runs, append-only evidence review/corrections, versioned requirement sets, exact-job matches, citations, M10 bindings, M7 work targets, and the restricted resume worker capability boundary. `0031` is the final M11 migration and adds the deterministic `SKILL` requirement taxonomy value, immutable input fingerprints, lease-token-fenced domain functions, and function-only worker privileges.

Resume object bytes use AES-256-GCM with owner/content-bound authenticated data. Production requires `RESUME_STORAGE_KEY`; local tests may use the repository's deterministic development key. Raw resume text, object ciphertext, storage keys, sessions, OAuth tokens, and Google refresh credentials are excluded from exports and diagnostics.

## Worker behavior

`RESUME_PARSE` and `MATCH_MATERIALIZE` share the existing M7 `RESUME` work class. They use PostgreSQL claims, attempt rows, lease tokens/generations, PostgreSQL time, heartbeat support, retry scheduling, reaping, and dead letters. Domain writes are security-definer functions that validate the active service principal, claimed target, current lease token, work type, owner, and target availability before writing.

The resume worker database role has no direct table or sequence grants. It may claim/start/heartbeat/finish M11 work and call only the claimed-target parse/match functions. It cannot read another resume, Better Auth sessions, applications, Calendar data, Google credentials, privacy/admin lanes, or mutate users and identities.

## Product and attribution flow

Better Auth owner-scoped routes support upload, document/version reads, parse queue/status, evidence reads, confirmation, rejection, correction, exact-job match create/read, citations/explanations, and application resume/match binding. Browser-supplied owner identifiers are rejected by strict request schemas.

Recommendation and match meanings remain separate. A real M9 ranking decision and impression may be attached to a match without creating a synthetic impression. The M9 score is unchanged. The M11 resume version, historical opportunity, requirement-set version/fingerprint, evidence fingerprint, algorithm, eligibility, score, reasons, and citations remain immutable while M10 records application submission, OA, interview, and final outcome.

Canonical merge, split, and re-merge never retarget private history. Match and application historical targets stay fixed; current canonical successor and mismatch are resolved separately, while M8 resolution lineage remains append-only.

## Privacy and acceptance

The M6 export includes policy-approved M11 documents (without bytes/keys), versions, parse runs, evidence, confirmations, matches and input versions, citations, M10 bindings, events, assessments, and interviews. Account deletion cancels live work and removes the user-owned object, versions, parse runs, evidence, matches, application state, sessions, and credentials while retaining shared requirements/opportunities and other users.

Permanent acceptance covers retry-to-success and exhaustion for both M11 work types, non-retryable malformed targets, one-claim races, distinct-work concurrency, lease expiry/reaping, stale fencing, crash-after-domain-write idempotency, finite CLI workers, least privilege, Google credential denial, two-user HTTP IDOR/no-mutation, built `next start`, privacy export/delete and delete-worker races, recommendation-to-outcome attribution, merge/split/re-merge, migration preservation, byte-identical Google ciphertext, and zero paid spend.
