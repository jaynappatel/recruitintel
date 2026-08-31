# M9 implementation record: watchlists, deterministic recommendations, and alerts

Status: complete. This record describes the implementation at the M9 commit and is subordinate to
the approved `docs/milestone-9-implementation-plan.md` for product decisions.

## Product and data boundaries

Canonical `job_opportunities` are the only recommendation and opportunity-alert unit. `jobs` and
their memberships remain provenance. The private `watchlist_items` table is a typed union for
`COMPANY`, `OPPORTUNITY`, `RECRUITER`, and `SCHOOL`; its `legacy_job_id`, origin, state, successor
policy, and timestamps preserve M8 intent. Active typed targets have owner-scoped partial unique
indexes. M6 `JOB` watches migrate through their active opportunity membership and retain the source
posting ID as provenance.

Preferences are one scalar owner row plus compact normalized selections: role family, early-career
track (`INTERNSHIP`/`NEW_GRAD`), experience level, workplace mode, structured location, target
school, graduation year, and explicit U.S. work authorization/sponsorship answers. No sensitive
attribute is inferred. Normalized no-op PATCHes do not increment `preference_version`.

## Recommendation v1

Algorithm name `deterministic-opportunity-priority`, version `v1`. The nine bounded weights total
100: `ROLE_MATCH 20`, `COMPANY_PREFERENCE 18`, `EARLY_CAREER_TRACK 14`, `LOCATION_MATCH 14`,
`EXPERIENCE_LEVEL 12`, `WORKPLACE_MODE 8`, `FRESHNESS 6`, `DEADLINE_URGENCY 4`, and
`SOURCE_CONFIDENCE 4`. The TypeScript scorer and Python worker scorer are parity implementations;
same inputs, `as_of`, and preference/watch versions produce the same result and stable sort.

Hard eligibility is evaluated before ranking: closed/superseded, confirmed passed deadline,
explicit graduation-year mismatch, explicit seniority mismatch, explicit sponsorship mismatch, and
explicit work-authorization mismatch are `NOT_ELIGIBLE`. Missing lifecycle, graduation,
authorization, location, workplace, or deadline evidence is `UNKNOWN`; unknown factors contribute
neither numerator nor denominator. Otherwise the result is `ELIGIBLE`. A hard-ineligible item has
no recommendation score; a low score alone never hides an opportunity. The UI calls the value
“Recommendation Score” and never hiring probability.

Each stored decision has algorithm/version, candidate-set fingerprint, position, nullable score,
eligibility/category, bounded reason codes, factor values, and generated time. M6
`ranking_decisions` and `recommendation_impressions` remain the denominator ledger. The browser can
only send an owner-owned impression ID for an open; score, rank, candidate set, reasons, and version
are server facts.

## Suppression and canonical lineage

Dismissals are private, versioned `opportunity_suppressions`. A dismissal suppresses the current
material fingerprint only. It is released by a reopen, authoritative new posting, material role or
eligibility change, deadline change, or material location/workplace change; source duplicates,
derivation churn, and description-only changes do not release it. Restore and later dismissals are
separate history. A superseded watch remains historical and exposes its bounded resolved successor.
Only explicit `AUTO_FOLLOW_DIRECT` creates a traceable successor watch. Splits remain ambiguous and
do not silently select a child. Reconciled old-opportunity alerts expire rather than being copied.

## Alerts and provider

M9 alert types are `WATCHED_COMPANY_OPPORTUNITY_OPENED`, `RECOMMENDED_OPPORTUNITY_OPENED`,
`APPLICATION_DEADLINE_APPROACHING`, `OPENING_WINDOW_STARTED`, `WATCHED_RECRUITER_DISCOVERED`,
`WATCHED_RECRUITER_ACTIVITY`, `CAMPUS_EVENT_DISCOVERED`, `INTERVIEW_INTELLIGENCE_UPDATED`, and
`CALENDAR_ACTION_DUE`. Rules are canonical-event based and temporally gated by watch/type/master
activation. Defaults are conservative; recommended-open is disabled until enabled. Observation
count carry-forward alone is not material.

The only registered provider is `InAppNotificationProvider`, behind the narrow
`NotificationProvider.deliver(NotificationCandidate)` interface. It inserts the mailbox row in
the evaluator transaction. Future email/push/Discord/SMS are interfaces only and have no M9 SDK,
credentials, outbox, or runtime path.

Fingerprint version `dedupe-v1` is SHA-256 over user, alert type, canonical entity/event or fact
version, reminder window, and rule version. It never includes source-posting ID, collector run, or
worker attempt. Database uniqueness `(user_id, dedupe_fingerprint)` plus `ON CONFLICT DO NOTHING`
prevents retries, duplicate source events, merges, and concurrent workers from duplicating alerts.
Read, dismissed, expired, and superseded rows are retained with timestamps.

## M7, fanout, privacy, and APIs

Canonical change/intelligence triggers enqueue one semantic M7 request. M7 runs `ALERT_FANOUT` in
bounded batches of 250 and enqueues owner-scoped `ALERT_EVALUATE`; the hourly `m9-alert-due-scan`
schedule handles deadlines/opening windows/calendar due work. No second scheduler exists. Candidate
users come from indexed company/opportunity/recruiter/school watches, normalized role/track/level
preferences, and target schools; there is no user×opportunity Cartesian scan. Recommendation SQL
uses bounded canonical candidates (500), indexed filters, cursor pagination, batch fact hydration,
and no per-item source query.

Routes are owner-derived and include recruiting preferences, watchlist CRUD, recommendations,
impression open, opportunity dismiss/restore, alert mailbox/state mutations, notification
preferences, and mark-all-read. No route accepts `userId`, score, rank, candidate set, reason, or
algorithm version. Private tables cascade on account deletion; admin status does not grant private
recommendation history access. Two-user migration fixtures verify isolation.

## Instrumentation and reuse

Server-authoritative events include `WATCHLIST_ADDED/REMOVED`, `OPPORTUNITY_SAVED/DISMISSED`, and
ranking decision/impression facts. Real client behavior emits recommendation/alert shown/opened and
opens/dismissals; no interactions are fabricated. Existing M6 event and ranking schemas are reused.

The only licensed reference adaptation is FreeHire (MIT): identity/hash and lifecycle-notification
concepts from `internal/sources/identity.go`, `internal/jobhash/*`, `cmd/ingest/store.go`,
`cmd/ingest/board_health.go`, and the lifecycle-notification OpenSpec. RecruitIntel-specific SQL,
reason codes, scoring, fanout, and provider code were written independently; no runtime or dataset
was imported. The notice and expected design/test discovery savings are recorded in
`THIRD_PARTY_NOTICES.md`.

## Verification

The clean migration smoke covers 0009→0013, M8 watch preservation, canonical singleton membership,
two-user watch isolation, restrictive private-reference deletion, and concurrent alert dedupe.
Deterministic scorer tests cover eligibility precedence, unknown denominator behavior, watched
company boosts, role/workplace mismatch, deadlines, source confidence, and closed/superseded state.
TypeScript/Python tests, web lint/typecheck, M7 ruff/mypy, `ZERO_COST_MODE=true`, and the full web
build are release gates. No paid provider, model, embedding, or external notification call is
required.
