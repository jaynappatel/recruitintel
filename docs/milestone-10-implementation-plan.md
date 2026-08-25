# Milestone 10 — Application Tracking + Append-Only Outcome Ledger

Status: implemented. This document remains the implementation contract for M10.

Canonical inputs: `final-architecture-roadmap.md`, `canonical-job-graph.md`, `watchlists-recommendations-alerts.md`, `recruiting-calendar.md`, `recruiter-campus-intelligence.md`, `identity-privacy-audit.md`, and `orchestration-source-governance.md`.

## 1. Current application-related state

There is no `applications` or application-event table, route, or UI in the M9 commit. The current private lifecycle primitives are:

- `application_plans` and `application_plan_tasks`, owned by `user_id`, optionally targeted at a canonical `opportunity_id` while retaining legacy `job_id`.
- owner-scoped `calendar_items`; source-driven items are immutable except for the documented status/sync fields. Google sync is durable M7 work, not an application scheduler.
- M9 `watchlist_items`, recommendation `ranking_decisions`/`recommendation_impressions`, and transactional in-app `alerts`.
- canonical `job_opportunities` with temporal source-posting membership and append-only merge/split resolution. Private rows are never silently retargeted.
- public `recruiter_profiles`; a discovered profile is not evidence that the person is the user's recruiter or contact.
- M6 `product_events`, which already enforce owner-scoped deduplication and redact private payloads, but have no application outcome vocabulary yet.

M10 adds an application projection and ledger; it does not replace plans, calendar, alerts, recommendations, or source postings.

## 2. Application schema

Create one private `applications` table per application attempt (not per company):

| Field | Contract |
|---|---|
| `id` | UUID primary key |
| `user_id` | not-null owner; compound foreign keys on every private child |
| `opportunity_id` | original canonical opportunity target, not rewritten by resolution |
| `source_posting_id` | nullable provenance actually used to apply |
| `company_id` | denormalized validated company for bounded list hydration |
| `cycle_key` | short normalized user/application-cycle key (for example `2026-summer`), nullable only for legacy/manual unknown |
| `current_status` | constrained projection enum below |
| `current_stage` | nullable constrained stage projection |
| `applied_at` | user/event-supplied application time, nullable |
| `application_url_used` | nullable HTTPS URL, length-bounded; never used as identity |
| `application_plan_id` | nullable owner-scoped link to the preparing plan |
| `origin_recommendation_impression_id` | nullable owner-scoped link, validated against this opportunity |
| `next_action_type`, `next_action_at` | deterministic projection, nullable |
| `archived_at` | nullable; archive is reversible and not deletion |
| `created_at`, `updated_at` | timestamps |

Do not cascade-delete an application when a public opportunity or source posting is removed. Use restrictive or `SET NULL` public references and preserve the original IDs. An optional bounded `target_snapshot` (title/company/location and capture timestamp, no raw description) protects historical display without copying job text.

Uniqueness is `user_id + opportunity_id + cycle_key` for an active cycle. A nullable/unknown cycle is handled by an explicit user confirmation token rather than a broad unique constraint. A second season is a new row and ledger, even for the same opportunity/company.

## 3. Status and state-machine design

Keep status small and use `current_stage` plus richer events for detail:

- status: `SAVED`, `PLANNING`, `APPLIED`, `IN_PROCESS`, `OFFER`, `REJECTED`, `WITHDRAWN`, `CLOSED`;
- stage: `NONE`, `OA`, `RECRUITER_SCREEN`, `TECHNICAL_INTERVIEW`, `ONSITE`, `FINAL_ROUND`.

`OA_RECEIVED`, `OA_COMPLETED`, `INTERVIEW_SCHEDULED`, `TAKE_HOME`, `WAITLISTED`, and `GHOSTED` are event/assessment or derived-condition vocabulary, not additional top-level statuses. A process can remain `IN_PROCESS` while its stage changes.

Deterministic forward transitions include `SAVED → PLANNING → APPLIED → IN_PROCESS → OFFER`, with terminal `REJECTED`, `WITHDRAWN`, and `CLOSED` from any non-terminal state. `APPLIED → IN_PROCESS` may be caused by an OA, screen, or interview event. Reopen is an explicit `REOPENED` correction/event that moves `CLOSED` back to `IN_PROCESS` or `APPLIED`; it never erases closure history. Invalid transitions return a validation error. Corrections/backfills are explicit events with actor, reason, and prior projection; they do not edit or delete old rows.

## 4. Append-only outcome ledger

Create `application_events` with `id`, `application_id`, `user_id`, `event_type`, `from_status`, `to_status`, `from_stage`, `to_stage`, `occurred_at`, `recorded_at`, `source`, bounded `reason_code`, optional `assessment_id`/`interview_id`/`recruiter_profile_id`/`calendar_item_id`, `schema_version`, `idempotency_key`, and small structured metadata. Use a compound `(id, user_id)` FK for all private links.

Initial event types: `APPLICATION_CREATED`, `APPLICATION_SUBMITTED`, `STATUS_CHANGED`, `STAGE_CHANGED`, `OA_RECEIVED`, `OA_COMPLETED`, `INTERVIEW_SCHEDULED`, `INTERVIEW_RESCHEDULED`, `INTERVIEW_COMPLETED`, `OFFER_RECEIVED`, `REJECTION_RECEIVED`, `WITHDRAWN`, `REOPENED`, `APPLICATION_TARGET_CORRECTED`, and `ARCHIVED`.

`occurred_at` describes when the fact happened; `recorded_at` is server time. Server validates that client input cannot claim a server-authoritative outcome or alter an existing event. Unique `(user_id, idempotency_key)` makes retries safe; event insertion and current-projection update happen in one transaction. A projection-rebuild command folds events in `(occurred_at, recorded_at, id)` order and records a projection version.

## 5. Application-cycle/reapplication model

The application row is the cycle/attempt. `cycle_key` is explicit, normalized, and visible in the API; it may be a recruiting season, requisition cycle, or user-provided opaque key. Creating a second application for the same opportunity requires a different cycle key or explicit confirmation that the prior cycle is closed. Different opportunities at one company are always separate rows. No company-level uniqueness is used.

## 6. Assessments

Create `application_assessments`: `application_id`, `user_id`, `type` (`OA`, `CODING_CHALLENGE`, `TAKE_HOME`, `RECRUITER_SCREEN`, `BEHAVIORAL`, `TECHNICAL`, `SYSTEM_DESIGN`, `OTHER`), `status` (`EXPECTED`, `RECEIVED`, `IN_PROGRESS`, `COMPLETED`, `EXPIRED`, `CANCELLED`), `received_at`, `due_at`, `completed_at`, bounded provider/name, nullable numeric score, schema version, metadata, timestamps, and an idempotency key. Scores/results are user-entered facts, never inferred.

M10 does not add free-form notes. Structured metadata is short, private, and excluded from analytics/logs; encrypted notes can be considered in a later milestone using an existing encryption primitive.

## 7. Interviews

Use a separate `application_interviews` table rather than overloading assessments: `application_id`, `user_id`, `interview_type`, `status` (`SCHEDULED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED`), start/end timestamps, timezone, duration, optional `recruiter_profile_id`, bounded interviewer label, `calendar_item_id`, completed/result code, and timestamps. Reschedule appends `INTERVIEW_RESCHEDULED` and updates the interview projection; prior times remain in the ledger. No discovered public recruiter is automatically assigned as an interviewer.

## 8. Calendar integration

Add nullable owner-scoped `application_id`, `assessment_id`, and `interview_id` links to existing `calendar_items`, plus an `APPLICATION` source (or an equivalent additive source check). OA due dates create an `OA` item; a confirmed interview creates an interview item; submission follow-up is opt-in. Creation/update is transactional with the application event and idempotent by application/entity/version. Existing Calendar APIs, sync flags, and the M7 durable Google worker remain the only scheduling/sync path. No large plan is silently created and no external provider is required.

## 9. ApplicationPlan integration

Add nullable owner-scoped `application_id` to `application_plans`. Plan activation still prepares; it never asserts that the user applied. `POST /api/applications` may reference a plan and records the relationship plus `APPLICATION_CREATED`. An application may be created without a plan. Existing generated plan tasks remain historical; later application-specific tasks are separate Calendar items unless the user explicitly converts a task.

## 10. Watchlist integration

Creating an application never removes or mutates a watch. The watchlist response may expose a derived `applicationState` and active application IDs for the owner. Historical `watchlist_items` remain intact, so save/watch and apply are independently auditable. A dismissal does not block a manually created application.

## 11. Opportunity merge/split behavior

Applications retain `opportunity_id` and `source_posting_id` as historical target identifiers. Detail responses include the canonical resolver's `resolvedOpportunity` and `resolutionMismatch`, exactly as plans/calendar do. A merge can show a successor but never rewrites a private application or creates a duplicate. A split leaves the application ambiguous until the user chooses; no deterministic guess is made without strong, recorded evidence. A confirmed retarget stores `confirmed_opportunity_id` (or an equivalent target-resolution row) and appends `APPLICATION_TARGET_CORRECTED`; original target and source remain visible. Source-posting movement is provenance, not silent application retargeting.

## 12. Recruiter/contact model

Create `application_recruiters` as a private join: application/user, recruiter profile, role (`RELEVANT_RECRUITER`, `CONTACTED_RECRUITER`, `ASSIGNED_RECRUITER`, `INTERVIEWER`), source, first/last associated timestamps, and active flag. A recruiter can be associated many times with different roles; active duplicate role rows are unique. Public profile fields remain in `recruiter_profiles`; private contact notes and personal contact details are deferred and never copied into public intelligence.

## 13. Deterministic next-action logic

Compute (or version a projection of) `nextActionType`, `nextActionAt`, and `reasonCode` with fixed precedence:

1. due/overdue assessment (`COMPLETE_OA`);
2. upcoming interview (`PREPARE_FOR_INTERVIEW`);
3. offer (`REVIEW_OFFER`);
4. submitted active process with no pending date (`FOLLOW_UP_OR_WAIT`);
5. planning (`PREPARE_APPLICATION`);
6. saved (`DECIDE_OR_PLAN`); terminal rows have `NONE`.

The earliest explicit due date wins ties by event ID. A matching TODO Calendar item satisfies the action and prevents duplicate task creation. Unknown dates remain unknown; no LLM or inferred deadline is used.

## 14. Recommendation/outcome linkage

`origin_recommendation_impression_id` is optional and must be validated server-side for the same owner and canonical opportunity. An application event carries that linkage when available; the chain is decision → impression → user open/save/apply → application → outcome. No client-supplied score, rank, candidate set, or algorithm version is trusted. Applications created from the opportunity page without a valid impression simply have null origin. This records sequence, not causation.

## 15. Alert integration

Extend the existing M9 alert enum/subjects with `APPLICATION_ACTION_DUE`, `OA_DEADLINE_APPROACHING`, and `INTERVIEW_UPCOMING` (optionally `FOLLOW_UP_DUE` only if product confirms a distinct alert). Add application/assessment/interview references to the existing `alerts` table and reuse its transactional fingerprint/state (`UNREAD`, `READ`, `DISMISSED`, `EXPIRED`). Fingerprints are `(user, alert_type, application/assessment/interview, reminder_window, material_version)`.

Application events can enqueue the existing M7/M9 `ALERT_EVALUATE` path in the same transaction; scheduled due scans extend the existing hourly due scan. Alert creation uses database uniqueness and `ON CONFLICT DO NOTHING`. Only due windows, confirmed interview changes, and meaningful next actions alert; routine metadata/source refreshes do not.

## 16. Instrumentation and future ML labels

Extend M6 product events with server-authoritative `APPLICATION_STARTED`, `APPLICATION_SUBMITTED`, `APPLICATION_STAGE_CHANGED`, `OA_RECEIVED`, `OA_COMPLETED`, `INTERVIEW_SCHEDULED`, `INTERVIEW_COMPLETED`, `OFFER_RECEIVED`, `REJECTION_RECEIVED`, and `WITHDRAWN`. Include user, application, opportunity, timestamp, source, and valid recommendation-impression ID where present; exclude notes, URLs containing private tokens, resume text, recruiter contact details, and assessment metadata. Client may emit view/open actions only. Recommendation decisions/impressions remain the denominator ledger; outcome events are the subsequent labels, never hiring-probability claims.

## 17. APIs

All routes derive ownership from the authenticated session and use existing success/error envelopes:

- `GET /api/applications` with cursor, status, company, role family, active/archived, and upcoming-action filters.
- `POST /api/applications` with canonical opportunity, optional source posting, cycle key, plan, application URL, applied time, and optional valid impression.
- `GET/PATCH /api/applications/:id`; PATCH is limited to reversible projection fields/archive and cannot edit history.
- `POST /api/applications/:id/status`, `GET /api/applications/:id/timeline`, and explicit correction/backfill endpoint.
- `POST/PATCH /api/applications/:id/assessments/:assessmentId` and `POST/PATCH /api/applications/:id/interviews/:interviewId` (creation may be nested).
- recruiter association and confirmed target-retarget endpoints, both append-only/audited.
- optional `POST /api/opportunities/:id/apply` convenience route; it validates canonical ownership, source provenance, and impression linkage before delegating to application creation.

No route accepts `userId`/`ownerId`; not-found is the cross-owner response.

## 18. Privacy and security

Every application table and child has a user FK; joins include owner predicates. Admin flags do not authorize private application reads. Export includes applications, events, assessments, interviews, recruiter associations, application-linked calendar/alerts, and plan links. Account deletion cascades private rows while preserving only the existing minimal privacy-request audit. URLs are validated and redacted from logs; notes are not in M10. Server owns statuses, event times, score/version context, and alert reason codes. Add two-user IDOR and admin-denial tests before release.

## 19. Migration strategy

Use a single additive migration after `0013_m9_alert_materiality.sql` (planned number `0014_application_tracking.sql`). It creates enums/tables, compound FKs, projection/ledger indexes, and nullable links on plans/calendar/alerts. It does not backfill fabricated applications: M9 has no application facts. Existing M9 watches, preferences, alerts, recommendation history, and encrypted Google tokens remain byte-for-byte unchanged. Add fixtures for one user with a plan/watch/recommendation and one application, plus a second isolated user. Update export/delete manifests and migration smoke tests.

## 20. Index and performance strategy

Use `(user_id, updated_at DESC, id)` for list cursors; partial `(user_id, current_status, updated_at DESC, id)` for active filtering; partial `(user_id, next_action_at, id)` for due work; `(user_id, opportunity_id, cycle_key)` uniqueness; event `(application_id, occurred_at, recorded_at, id)`; assessment `(user_id, due_at, id)`; interview `(user_id, starts_at, id)`; recruiter join `(user_id, recruiter_profile_id, active)`. Hydrate opportunity/company/recruiter data in bounded batches. Candidate selection for alerts is by affected application owner, not every user × opportunity. Use keyset cursors, bounded timeline pages, and `EXPLAIN` checks; prohibit per-row source-posting queries and deep offsets.

## 21. Reference-repository reuse

- FreeHire (`/Users/jaynapatel/Desktop/github repos/freehire-main`, MIT): `internal/userjob/stages.go` provides a small active/terminal stage vocabulary; `internal/userjob/pipeline.go` and tests provide explicit forward/terminal transition rules; `internal/appevent/appevent.go` provides a narrow event vocabulary, source taxonomy, and the important distinction between `occurred_at` and recorded/observed trust. Adapt concepts only; do not copy Go code or its mail-specific stages. MIT attribution is required only if code is copied; planned adaptation is conceptual, with no code import. Expected savings: state-machine and ledger review time, approximately 1–2 engineering days.
- FreeHire `internal/apptimeline` and `internal/calsync` are useful for separating event occurrence from calendar observation and for reschedule semantics; same MIT/concept-only treatment and no mail integration.
- Other local repositories (job-board aggregator, interview-question corpus, hiring-agent) contain provenance/datasets or ML/LLM behavior, not a compatible private append-only tracker. No code or dataset is reused; no attribution or dependency is introduced.

## 22. Testing

Cover creation, owner isolation, duplicate active cycle prevention, separate opportunities, later-cycle reapplication, archive/restore; valid/invalid transitions, correction/backfill, idempotent retries, out-of-order events, projection rebuild, and immutable history. Test assessments (OA receive/due/complete/duplicate), interview timezone/reschedule/completion/calendar links, plan linkage without auto-application, watch preservation, merge/split mismatch and explicit retargeting, recruiter roles, deterministic next actions, recommendation-impression linkage, alert windows/deduplication, and no source-posting duplicate applications. Add instrumentation tests proving client cannot forge authoritative outcomes or leak notes/PII. Add two-user IDOR/admin denial/export/delete tests, N+1/performance query tests, migration fixtures, and `ZERO_COST_MODE=true` build/test runs. No live provider calls.

## 23. Documentation

Update the architecture roadmap and privacy/export inventory after implementation, add an application state/event vocabulary reference, API contract examples, merge/split and correction semantics, calendar/alert behavior, and an operator runbook for projection repair and idempotency conflicts. Document that stages/outcomes are user/server-recorded facts, not hiring probability, and that M10 introduces no ML, LLM, embeddings, paid API, or notification provider.

## 24. Definition of done

M10 is complete only when a user can create an application from an opportunity or plan, record a submitted → OA/interview → outcome journey, see a replayable immutable timeline, retain source URL and target provenance through canonical merge/split, receive deduplicated in-app due/interview alerts, and see a deterministic next action. Recommendation impressions link to applications without causal claims; watchlists remain intact; plans/calendar/alerts reuse existing ownership and orchestration. All privacy, performance, migration, zero-cost, build, and test gates pass. No M11 work begins.

## 25. Risk and complexity

Primary risks are state/projection divergence, ambiguous canonical splits, accidental duplicate cycles, alert fanout, and private-data leakage through instrumentation or admin routes. Mitigations are append-only events plus rebuilds, explicit mismatch/retarget records, cycle keys and database idempotency, owner-bounded due evaluation, compound FKs, server-authoritative events, and export/delete tests. Complexity is medium-high: one migration and several owner-scoped DB/API modules, but no new provider, model, scheduler, or external dependency.
