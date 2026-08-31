# Milestone 11 Implementation Plan: Model Gateway, Resume Evidence, and Job Match

Status: implemented. Runtime details and acceptance evidence are recorded in `docs/milestone-11-implementation-notes.md`.

## 1. Authority and scope

The authoritative scope is the **Milestone 11 – Model gateway, resume evidence, and job match** section of `docs/final-architecture-roadmap.md` (the roadmap at the accepted M10 HEAD). It defines the goal as secure resume parsing and an explainable exact-job match that never invents candidate evidence. The roadmap's dependency order (M6 identity/privacy, M8 canonical jobs, M10 applications) makes M11 an additive evidence/matching layer, not a replacement for recommendations, applications, or the canonical job graph.

Supporting authority is `docs/ml-roadmap.md`, `docs/identity-privacy-audit.md`, `docs/canonical-job-graph.md`, `docs/watchlists-recommendations-alerts.md`, `docs/milestone-10-implementation-plan.md`, `docs/orchestration-source-governance.md`, `docs/recruiter-campus-intelligence.md`, `docs/github-intelligence.md`, and `docs/open-source-reuse-audit.md`. The accepted M10 HEAD is `f96f1a37470ac90edfbeb58063e3a3b9ddf2602c`.

The roadmap is authoritative over older milestone notes. M11 is **not** the browser companion (M12), broad predictive ML (future/ML roadmap), email parsing, or autonomous application submission.

## 2. Product contract

### Must have

1. A user can upload a validated resume document, create immutable versions, and delete it through the existing privacy boundary.
2. A version can be parsed into a small, reviewable structured projection. Deterministic extraction handles contacts/links/dates/employments/skills first; optional model extraction is bounded, validated, and never required for zero-cost operation.
3. Every extracted claim is an evidence record with source span, extraction method/version, confidence/uncertainty, and user confirmation state. Unsupported claims are never emitted as facts.
4. A canonical opportunity's structured requirements can be materialized into a versioned role rubric/job requirement set.
5. A user can compare one exact canonical opportunity to one selected `ResumeVersion` and receive a deterministic hard-constraint result, bounded coverage score, cited evidence, missing/unknown requirements, and safe explanation/diff.
6. The match is private, owner-scoped, and bound to opportunity identity/version, requirement-set version, resume version, parser policy, and match algorithm version. It must remain readable after opportunity merge/split without rewriting historical match evidence.
7. The user can confirm/edit/reject extracted evidence and rerun a match. Corrections append history or create a new evidence version; they do not rewrite prior parse or match results.
8. Optional user-consented GitHub enrichment can add separately sourced evidence; it is never inferred from a resume and is never required.

### Optional/future (not required for M11 acceptance)

- bounded LLM fallback for ambiguous extraction;
- grounded resume wording suggestions;
- model-trained ranking or hiring prediction;
- multi-job batch matching;
- automatic application edits/submission;
- M12 browser intake.

Inputs are user-owned documents, explicit confirmations, consented GitHub sources, and shared canonical opportunity requirements. Outputs are private projections and cited evidence, never hiring probability or an invented skill claim. Raw resume bytes/text are private; structured job requirements and public opportunity facts remain shared.

## 3. Existing systems and reuse

- Better Auth/session ownership, owner FKs, redaction, privacy export/delete, and IDOR conventions from M6/M10.
- `jobs`, `job_opportunities`, memberships, structured requirements, lifecycle evidence, and merge/split resolution from M8; the exact `opportunity_id` is the match unit.
- M9 deterministic recommendation factors remain independent. A match may be displayed as a separate explainable signal; it must not replace or silently alter RecommendationDecision/Impression rows.
- M10 `applications`, `application_events`, `application_assessments`, `application_interviews`, Calendar links, ApplicationPlan links, and outcomes. A match may record which resume version was used by an application, but cannot mutate application history.
- M7 schedules/work items/attempts/worker-role authorization and existing finite-worker test paths. No second queue or scheduler.
- M6 instrumentation tables and server-authoritative event/redaction contract. No parallel analytics table for impressions or outcomes.
- Existing storage/crypto abstractions and Google credential boundaries. Resume storage must use a new encrypted object boundary or an existing compatible object-store abstraction, never Calendar credential storage.

## 4. Proposed data model (smallest additive design)

M11 requires an additive migration after `0018_application_calendar_idempotency.sql`; exact number is assigned only after implementation branch inspection. All IDs are UUIDs and all private tables carry `user_id` with compound ownership checks.

### Private document/evidence tables

- `resume_documents`: `id`, `user_id`, storage object key (never public), original filename (sanitized), MIME/magic result, byte/page limits, created/deleted timestamps, retention state. Unique active document key per owner; FK to user with owner-safe deletion. No raw text in ordinary columns or logs.
- `resume_versions`: `id`, `resume_document_id`, `user_id`, content hash, version number, source version, parser policy/version, created/confirmed timestamps, active flag. Immutable content identity; unique `(user_id, resume_document_id, version_number)` and `(user_id, content_hash)` where policy permits. Application links use this ID.
- `resume_parse_runs`: `id`, `resume_version_id`, `user_id`, status, parser version, redaction/layout diagnostic summary, input hash, started/completed timestamps, idempotency key, bounded error class. Raw parser/model output is not persisted or logged.
- `candidate_employments` and `candidate_evidence`: owner, evidence type, normalized bounded value, source (`DETERMINISTIC_PARSE`, `MODEL_REVIEW`, `USER_CONFIRMED`, `GITHUB_CONSENTED`), source span/hash, extraction version, confidence/uncertainty, validity interval, and superseded state. Evidence rows are append-only; values are not shared publicly.
- `evidence_confirmations`: owner/evidence, disposition `CONFIRMED|EDITED|REJECTED`, actor, timestamp, correction reason, and resulting evidence ID. Unique active confirmation per evidence revision.

### Shared/derived requirement and match tables

- `role_rubrics`: versioned rubric definition for a role family/level; shared unless it contains private notes. It stores bounded factor definitions, hard-constraint rules, and algorithm/version metadata.
- `job_requirement_sets`: canonical `opportunity_id`, source requirement evidence/version, normalized requirements, certainty, hard-constraint flags, and derivation version. Preserve each historical set; current projection may point to one active version.
- `resume_job_matches`: owner, `resume_version_id`, historical `opportunity_id`, optional confirmed/current resolved opportunity projection, requirement-set ID, hard-eligibility result, deterministic score/category, algorithm/version, generated time, status, and idempotency key. Historical opportunity is immutable; current resolver is read-only metadata.
- `match_evidence`: match, candidate evidence ID, requirement ID, relation `SATISFIES|PARTIAL|MISSING|UNKNOWN|CONFLICT`, bounded reason code, and evidence citation/span. No resume text.
- `match_recommendations`: optional private accept/reject/dismiss projection for a match, linked to the existing recommendation/impression where applicable; no replacement ranking system.

### Optional gateway tables

- `model_calls`, `model_cache_entries`, `model_usage_costs` are operational/private, minimized, and only created if the optional provider path is implemented. Store provider/model/prompt/schema/redaction/policy versions, hashes, token/cost/latency, validation, cache hit, abstention, and error class—not prompts, raw resume text, raw model output, or secrets. A deterministic/local provider remains the default.

Indexes: every private table on `(user_id, updated_at, id)`; matches on `(user_id, opportunity_id, generated_at desc)` and `(user_id, resume_version_id)`; evidence on `(user_id, status, evidence_type)`; requirement sets on `(opportunity_id, version desc)`; parse runs on `(user_id, resume_version_id, created_at desc)`. Foreign keys use owner-compatible composite constraints where a child references two private IDs.

Deletion removes private documents, versions, parses, evidence, matches, confirmations, and private links; shared requirement/rubric intelligence is retained. Audit tombstones follow the existing M6 policy. No migration backfill invents resume rows.

## 5. Deterministic extraction and matching contract

### Parse pipeline

`bytes -> MIME/magic/size/page/time/memory validation -> bounded text extraction -> invisible/control-text diagnostics -> deterministic section/contact/date/employment/skill normalization -> optional validated fallback -> evidence projection -> user review`.

Each stage has a version and idempotency key `(owner, resume_version, stage, input_hash, policy_version)`. Unknown or ambiguous text produces `UNKNOWN`/review-required, not a positive claim. Password-protected, scanned-only, malformed, oversized, or hostile documents fail safely with a typed status and no partial private leakage.

Use a maintained permissive parser only after security/fixture benchmarking: `pypdf` (BSD-3-Clause) or `pdfminer.six` (MIT). Do not use the AGPL/commercial PyMuPDF/PyMuPDF4LLM modules from Hiring Agent.

### Match pipeline

`exact canonical opportunity + active requirement-set version + selected ResumeVersion + confirmed evidence -> hard constraints -> deterministic coverage -> reason-coded result`.

Hard result is `ELIGIBLE`, `NOT_ELIGIBLE`, or `UNKNOWN`. Explicit contradictory graduation, authorization, seniority, or location constraints produce `NOT_ELIGIBLE`; missing evidence remains `UNKNOWN`; watched-company/recommendation preferences never override a hard mismatch. A closed/superseded opportunity is not a current match but historical matches remain queryable.

Initial bounded factors (no opaque similarity): role-family/level requirement coverage, explicit location/work-mode, explicit work authorization, graduation/experience eligibility, required-skill evidence, and source certainty. A small versioned weight table (for example 25/20/20/15/10/10 coverage caps) is documented in code and plan tests; unavailable factors are excluded from the denominator. Score is labelled `Resume Match Score`, never hiring probability. Every response exposes bounded reason codes and cited evidence IDs.

Persist algorithm version, factor values (structured/minimized), hard result, reason codes, requirement-set version, resume version, generated time, and idempotency key. Never persist raw job descriptions or resume text in diagnostics.

## 6. M10 integration

- An application may reference the exact `resume_version_id` used later; this is additive and does not alter historical application events.
- Recommendation impressions remain the denominator. If a user opens/saves/applies after a match, existing impression/action/application linkage is reused; no causal claim is recorded.
- Application/assessment/interview/Calendar/ApplicationPlan rows retain historical opportunity IDs through merge/split. Match detail exposes current canonical resolution and `resolutionMismatch` separately, just like M10.
- M10 alerts may optionally reference a match review action, but M11 must not create an independent notification engine.
- Outcomes are labels for later analysis only. Match generation must never use post-application stages as an input.

## 7. Orchestration

Reuse M7 work items with new typed lanes only where work is non-transactional: `RESUME_PARSE`, `RESUME_MODEL_FALLBACK` (optional and disabled in zero-cost mode), `GITHUB_EVIDENCE_REFRESH` (consented), and `MATCH_MATERIALIZE`. Each payload contains owner/document/version IDs, input hash, policy/version, and idempotency key—never raw content.

Work is enqueued transactionally after upload/confirmation/opportunity requirement changes. Claims use existing worker-role scope and bounded batches (for example 10 documents or 50 matches per finite run), PostgreSQL retry timing, and unique logical work keys. Partial failures remain retryable with typed terminal errors; stale versions are cancelled/no-op. No global user×opportunity scan: candidate matching is requested by user/opportunity or indexed active versions. Finite worker mode must terminate after a configured batch.

## 8. Privacy and security

Resume bytes, parsed text, evidence, confirmations, matches, gateway metadata, and application resume links are private. Requirements/rubrics derived from public jobs are shared/public; worker operational metadata is restricted; audit events are minimized. Every API derives owner from Better Auth and returns the established safe `401`/`404` semantics. Compound child IDs must be checked against both application/resume owner.

Exports include permitted structured resume/evidence/match/application links but never raw credentials, session tokens, OAuth tokens, encryption keys, provider secrets, or unapproved raw resume text. Deletion removes private object/storage references and derived rows without deleting companies, opportunities, jobs, public evidence, or another user's rows. Admin shared-intelligence access does not grant private resume/match visibility. Object keys are opaque, access is short-lived/owner-scoped, and logs use redaction.

Canonical changes preserve historical IDs. Merge exposes a successor; split exposes ambiguity/mismatch and requires owner confirmation; re-merge appends lineage. No private evidence or match is silently retargeted.

## 9. Concurrency and recovery requirements

Permanent PostgreSQL tests must cover duplicate upload/version, parse retry, confirmation lost-update, concurrent match generation, requirement-set recomputation, cache/model-call deduplication, stale-version cancellation, and merge/split reads during match generation. Database uniqueness and transactions are authoritative; process checks are advisory. Retries of one logical operation reuse results, while materially changed content/version creates a new row.

Failure behavior: malformed/unavailable parser or provider yields explicit failed/abstained run; interrupted migrations remain transactional; deleted users cause safe no-op/tombstone work; stale canonical or requirement versions never rewrite history; UNKNOWN is retained; no partial match is promoted as confirmed evidence.

## 10. Zero-cost and licensing

`ZERO_COST_MODE=true` must execute deterministic parsing/matching locally with no paid provider, LLM, embedding, geocoder, notification, or external API requirement. Optional model gateway is disabled or limited to an explicitly configured local/mock provider; cost accounting remains zero and `search_paid_spend_micros = 0`.

Reference reuse is adaptation only: FreeHire MIT resume whitelist/monotonic evidence and deterministic match concepts with attribution; Hiring Agent MIT typed schemas/role bundles with attribution, excluding its AGPL PyMuPDF-derived module and sample resume; WeSight/Notchi are architecture inspiration only (Notchi GPL-3.0, no code). Use synthetic/consented fixtures; do not import unlicensed Simplify/LeetCode data or Job Board Aggregator CC BY-NC datasets. Record notices in `THIRD_PARTY_NOTICES.md` if implementation copies substantial MIT code.

## 11. Performance

User reads use owner indexes and cursor pagination. Match requests operate on one opportunity and bounded active resume versions; batch materialization uses indexed requirement/version joins and bounded work payloads. No `users × opportunities` Cartesian query, deep offset, per-item source fetch, or full resume text hydration in list APIs. Cache keys include owner/content/prompt/schema/redaction/policy versions. Expected scale is O(requested opportunities × bounded versions), with global work bounded by queued items and worker batch limits.

## 12. Instrumentation

Reuse M6 product events for real actions: `RESUME_UPLOADED`, `RESUME_VERSION_CREATED`, `EVIDENCE_CONFIRMED`, `EVIDENCE_EDITED`, `EVIDENCE_REJECTED`, `MATCH_SHOWN`, `MATCH_OPENED`, `MATCH_ACCEPTED`, `MATCH_DISMISSED`. Server emits parse/match decision and worker outcomes with minimized IDs/version/status; clients cannot forge score, evidence, algorithm, or outcome. Do not emit impressions without a rendered match, and never put resume text, private notes, credentials, or raw model output in analytics.

## 13. Preservation and migration strategy

Before M11 migration, fixture two users with M10 applications/events, assessments, interviews, Calendar/ApplicationPlan links, recommendations/impressions, watches/alerts, canonical lineage, external Calendar mapping, and encrypted Google credential bytes. Apply all migrations and assert byte identity, owner identity, shared row counts, private orphan count zero, and historical opportunity IDs. Add a user resume/version/evidence/match only after migration and verify export/delete and merge/split behavior. Migration is additive, transactional, rerunnable, and has no speculative backfill.

## 14. Implementation order

1. **Contract/security fixture:** document schemas, redaction fields, retention, parser budgets, threat model; add synthetic hostile-PDF fixtures and owner tests before storage.
2. **Migration/storage:** add the smallest tables/indexes/FKs and encrypted object adapter; migration preservation and rollback/idempotency tests must pass.
3. **Deterministic parser:** implement validation, text extraction, normalization, evidence spans, versioned parse runs, and bounded failure states; unit and PostgreSQL tests first.
4. **Review/evidence APIs:** owner-scoped upload/version/parse/review/confirm/edit/reject/delete routes; authenticated HTTP and export/delete tests.
5. **Requirement/rubric projection:** derive versioned requirement sets from canonical structured requirements; unknown handling and canonical merge/split tests.
6. **Match engine:** hard eligibility, bounded coverage score, reason codes, citations, persisted version/evidence; deterministic same-input and no-resume-dependency tests.
7. **M7 workers/gateway:** enqueue parse/match work, optional local/mock fallback, retries, cache/cost ledger, finite ZERO_COST worker proof; no external calls.
8. **M10/recommendation integration:** bind selected resume version to applications/matches and reuse impressions/outcomes; regression tests prove no historical mutation.
9. **HTTP/UI additive surfaces:** resume library/review and exact-job match views only after API/security gates; preserve Claude-owned visual components.
10. **Final acceptance:** built HTTP, privacy/IDOR, concurrency, preservation, merge/split, worker, zero-cost, quality, and production-build battery.

## 15. Permanent test matrix

Required coverage includes deterministic parser/unit tests; hostile/password/scanned/oversized PDFs; hidden text and PII redaction; PostgreSQL migration/preservation; two-user IDOR and compound ownership; authenticated and built HTTP; parse/match retries and concurrent writes; hard mismatch versus UNKNOWN; evidence confirmation; requirement changes; merge/split/re-merge; M10 application linkage; Calendar/alert non-regression; export/delete and credential exclusion; finite M7 worker; optional gateway validation/cache/cost with local mocks; ZERO_COST spend assertion; and no raw text/model output in logs/analytics. Every API must have malformed-ID and authorization tests.

## 16. Definition of done

- [x] Scope and license review approved; no M12/ML creep.
- [x] Additive migration(s) apply/rerun from 0001 through latest and preserve the M10 fixture, including Google ciphertext byte-for-byte.
- [x] Resume upload/version/delete enforces MIME/magic/size/page/time/memory budgets and owner isolation.
- [x] Deterministic parse produces versioned, cited evidence; unknown/ambiguous data is not asserted.
- [x] User confirmation/edit/reject is append-only and auditable.
- [x] Requirement sets/rubrics are versioned and tied to canonical opportunities.
- [x] Match hard result is separate from bounded weighted coverage; reason codes and evidence citations are exposed.
- [x] Match output is deterministic, idempotent, owner-private, and historical canonical IDs are preserved.
- [x] M10 application/recommendation/impression/outcome links remain intact.
- [x] M7 workers are finite, retry-safe, bounded, and zero-cost; no second scheduler/provider.
- [x] Export/delete, IDOR, admin denial, credential redaction, orphan, and merge/split tests pass.
- [x] Authenticated/built HTTP, PostgreSQL concurrency, migration, seed, DB smoke, full tests, lint/format/typecheck/build, and `git diff --check` pass.
- [x] `ZERO_COST_MODE=true`, `search_paid_spend_micros=0`, no paid/LLM/embedding dependency required, and worktree clean.

## 17. Explicit out of scope

No trained ML ranking, hiring-probability claims, embeddings, autonomous applications, email parsing, browser extension (M12), broad public-web resume collection, unconsented GitHub scraping, paid model/provider requirement, notification vendor, salary prediction, protected-attribute profiling, or redesign of M1–M10 schemas/UI.

## 18. Risk and complexity

Highest risks are hostile document handling and private object retention, unsupported evidence being promoted as fact, model/provider cost or prompt leakage, canonical resolution changing while a match is generated, and accidental O(users×opportunities) work. Mitigations are strict budgets, evidence citations/confirmation, optional local gateway, versioned hashes/transactions, owner compound keys, bounded indexed batches, and the acceptance matrix above. Estimated complexity is high (storage/security plus parser and evidence review) and should be delivered in the staged order rather than one migration-sized change.
