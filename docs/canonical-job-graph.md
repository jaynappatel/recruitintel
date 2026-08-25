# Canonical job graph

## Contract

Milestone 8 adds a canonical opportunity projection without changing the meaning of `jobs`.

```text
Company
  -> SourceEndpoint (`sources`)
     -> source posting (`jobs`)
        -> snapshots / observations / source lifecycle
        -> one active temporal membership
           -> CanonicalOpportunity (`job_opportunities`)
```

`jobs` remain the source-specific evidence records. External IDs, source and application URLs,
provider text, source lifecycle, snapshots, and first/last-seen timestamps are never replaced by a
canonical row. Every inserted job receives a singleton opportunity and membership synchronously in
the same PostgreSQL transaction. Resolution can merge singleton clusters later, but an unresolved
posting is immediately visible through the opportunity API.

The migration is additive. Legacy `GET /api/jobs` and company-job routes retain source-posting
semantics.

## Identity and resolution

Canonicalization version 1 has a deliberately narrow automatic-match surface:

- validated provider/board/native posting identity for an implemented provider;
- validated, normalized, exact official application URL on a source-approved host;
- an explicit cross-reference to that exact official posting.

Keys are company-scoped and indexed. A resolver reads at most 51 matches for an identity key and
processes bounded source batches; it never compares the whole catalogue. Exactly one active target
cluster yields `MATCH`. Conflicting exact targets yield `REVIEW_REQUIRED`. A normalized title block
can only create bounded review candidates; it never causes an automatic merge. Title similarity,
description similarity, title plus location, or inferred season alone are not match evidence.

Resolution writes are retry-safe and versioned. `job_resolution_decisions` is append-only,
`job_opportunity_postings` is temporal, and superseded opportunities remain addressable. A manual
merge, split, or no-match correction requires a human administrator, a reason, and an idempotency
key. It emits an audit event and pins the affected memberships so automatic resolution cannot
reverse the correction. A split creates a new singleton and closes the old membership; no posting,
opportunity, or decision is deleted.

The review queue is exposed as an admin API. Milestone 8 intentionally does not add a review UI.

## Source content and derivations

`source_content_hash` and `source_content_version` describe only normalized provider content.
Classifier/parser output is stored separately as `derivation_hash` and `derivation_version`.
Changing a role-family rule therefore writes `DERIVATION_RECOMPUTED` rather than a source snapshot
or `JOB_CHANGED` event. `content_hash` remains a compatibility alias during the additive cutover.

Structured derivations are evidence-bearing and deterministic:

- locations preserve raw text plus optional city, region, ISO country, remote region, and work mode;
- the initial skill vocabulary is intentionally small; unknown skills retain their raw mentions;
- requirements retain explicit years, education, degree field, and graduation-year statements;
- sponsorship, citizenship, work-authorization, and graduation constraints are stored only when
  explicitly stated; unknown is not inferred;
- explicit compensation and application deadlines have their own evidence rows.

No LLM, paid geocoder, paid search API, or imported third-party dataset is required.

## Authority and lifecycle

Source authority is not inferred from source type. `source_job_capabilities` binds a source to a
reviewed source-policy record, authority level, capability version, supported status/completeness,
freshness horizon, close-by-absence capability, and validated official application hosts. Existing
and newly discovered sources default to `UNREVIEWED`. Changing a source policy resets its authority
review fail-closed.

The canonical lifecycle projection is conservative:

1. Any fresh open source posting keeps the opportunity `OPEN`.
2. Automatic `CLOSED` requires every fresh reviewed authoritative posting to be closed, no fresh
   authoritative open posting, and a successful `COMPLETE` collection with valid absence evidence
   for every absence-based close.
3. Community/weak disappearance and partial or failed collection never close an opportunity.
4. Stale-only or conflicting evidence produces `UNKNOWN`.

Lifecycle evidence records capability versions and safe reason codes. Retrying recomputation is
idempotent.

Canonical application URLs are selected from the highest reviewed source authority, ordered
`OFFICIAL_ATS`, `OFFICIAL_COMPANY`, `REVIEWED_DIRECT`, then community. The original URLs remain on
every source posting. An unreviewed source receives no authority promotion merely because its
provider name resembles an ATS.

## Public company JobPosting discovery

The existing pinned public-web path recognizes bounded schema.org `JobPosting` JSON-LD on a
permitted company page. It validates company identity, keeps allowlisted fields only, and persists
the posting under a durable company-careers SourceEndpoint. The discovery source remains in that
endpoint's provenance. Repeated processing is idempotent and missing JSON-LD does not create
absence/closure evidence.

Fetches still require executable source policy, robots approval, DNS-pinned connections, redirect
validation, response bounds, and the M7 rate limiter. Greenhouse and Lever remain the only active
ATS collectors. SmartRecruiters and Ashby remain policy-gated; Workday remains blocked. No M8
runtime path uses a commercial search provider.

## APIs

Public, additive APIs:

- `GET /api/opportunities?companyId=&roleFamily=&earlyCareerOnly=&lifecycleStatus=&includeSuperseded=&limit=&cursor=`
  returns `{ data: Opportunity[], meta: { limit, nextCursor } }`.
- `GET /api/opportunities/:id` returns `{ data: OpportunityDetail }`; authenticated views emit a
  privacy-safe `OPPORTUNITY_VIEWED` event.
- `GET /api/opportunities/:id/sources` returns `{ data: OpportunitySourcePosting[] }` with hashes,
  temporal membership, reviewed authority, skills, and explicit constraints.

Admin-only correction APIs:

- `GET /api/admin/opportunity-resolution/reviews?status=&limit=`
- `POST /api/admin/opportunities/merge` with `winnerId`, `loserId`, optional `reviewId`, `reason`,
  and `idempotencyKey`.
- `POST /api/admin/opportunities/split` with `opportunityId`, `sourcePostingId`, `reason`, and
  `idempotencyKey`.
- `POST /api/admin/opportunity-resolution/reviews/:id` with `reason` and `idempotencyKey` records a
  pinned manual no-match.

Service principals cannot make human corrections. Responses use the existing RecruitIntel
success/error envelopes and never expose raw source payloads or internal diagnostics.

## Calendar and application plans

`recruiting_dates`, `application_plans`, and `calendar_items` have optional `opportunity_id`
references. Existing `job_id` values are not backfilled or rewritten. APIs expose both the stored
opportunity target and the source job's currently resolved opportunity as `resolvedOpportunity`,
plus `resolutionMismatch` when they differ after a merge or split.

Only an explicit owner-scoped PATCH retargets a private record. Retargeting an application plan
updates its generated task opportunity references but preserves historical source-job references.
Merge and split operations never retarget private data.

## Operations and performance

Apply migration `0010_canonical_job_graph.sql` during the normal atomic web/worker migration
cutover. The migration first creates exactly one opportunity per legacy job and does not run fuzzy
resolution. Operators may then run normal typed collectors/resolvers; medium-strength candidates
remain review-only.

`pnpm --filter @recruitintel/db smoke:migration-0010` proves the 0009 -> 0010 transition, private
reference preservation, encrypted Google ciphertext byte equality, synchronous singleton creation,
and legacy company deletion behavior. `pnpm --filter @recruitintel/db benchmark:m8` generates a
10,000-row catalogue by default and fails if exact candidate generation uses a full table scan or
exceeds the candidate cap. Set `OPPORTUNITY_BENCHMARK_ROWS` up to 1,000,000 for the opt-in large
benchmark.

## Reference-code boundary

The source-content/derivation split and board-scoped identity/lifecycle test strategy are original
Python/SQL adaptations informed by FreeHire's MIT-licensed
`internal/sources/identity.go`, `internal/jobhash/jobhash.go`,
`internal/jobhash/rolefingerprint.go`, `cmd/ingest/store.go`, and
`cmd/ingest/board_health.go`. Provider-aware identity and first-seen test cases were also informed
by the MIT-licensed Job Board Aggregator `scripts/merge_data.py`. Required notices are in
`THIRD_PARTY_NOTICES.md`.

No upstream implementation was vendored. No FreeHire location data or source catalogue and no Job
Board Aggregator `data/` content (CC BY-NC 4.0) was imported. RecruitIntel did not adopt JBA's
URL-only identity, fixed-age deletion, rotating user agents, or bundled scraper architecture.

## M9 private intent boundary

M9's `opportunity_change_events` ledger records canonical lifecycle/material changes without raw
descriptions. Recommendations, dismissals, and alerts reference the canonical opportunity and its
change version; source-posting duplicates never produce separate cards or alerts. A private watch
on a superseded opportunity remains on its historical target and exposes a bounded successor chain.
Only an explicit direct-successor policy may create a traceable follow-on watch. Splits remain
ambiguous and require user action. See `docs/watchlists-recommendations-alerts.md` for the private
state, deterministic score, and alert contract.
