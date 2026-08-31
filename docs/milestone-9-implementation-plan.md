# Milestone 9 implementation plan

> **Status:** Implementation complete; this document remains the canonical M9 contract. This plan is based on
> repository commit `4b236279f2ed3c0420cebf00c4a89923ebec59f4` and the canonical documents named in
> the milestone request. Stop after this planning pass and obtain approval before changing
> migrations, production code, APIs, workers, or UI.

Milestone 9 adds private watchlists, explicit recruiting preferences, deterministic
canonical-opportunity recommendations, and in-app alerts. It does not add machine learning,
embeddings, resume matching, or an external notification dependency. `ZERO_COST_MODE=true`
remains a complete product path.

The implementation must preserve these architecture boundaries:

- `jobs` remain source postings and evidence. Recommendations and opportunity alerts target
  active canonical `job_opportunities`, never individual source-posting duplicates.
- Private user intent is never silently retargeted by a canonical merge or split.
- The M6 `ranking_decisions` and `recommendation_impressions` tables remain the recommendation
  decision/impression ledger; M9 extends them instead of creating a parallel analytics model.
- M7 schedules, work items, attempts, leases, fencing, and retry rules remain the only scheduler
  and worker control plane.
- Every preference used by personalization comes from an explicit authenticated-user setting.
  Sensitive or private attributes are not inferred.
- M9 delivers only through the in-app channel. Future providers are an interface seam, not an
  M9 runtime, credential, or deployment requirement.

The current milestone brief intentionally narrows the older roadmap sketch. Therefore the roadmap's
generic search-watch, `recommendation_runs`, notification-outbox, email, digest, and quiet-hours
ideas are not M9 requirements: entity watches plus normalized preferences replace search watches;
M6 decisions/impressions replace recommendation runs; and transactional in-app alerts replace an
external delivery outbox. Those broader capabilities require a later approved milestone.

## Decision summary

| Decision | M9 choice |
| --- | --- |
| Watch representation | One typed, user-scoped `watchlist_items` table, evolved from M6 |
| Watchable types | `COMPANY`, `OPPORTUNITY`, `RECRUITER`, `SCHOOL` |
| `ROLE_FAMILY` watch | Defer; normalized role-family preferences already express this intent |
| Opportunity merge behavior | Keep original target and history; expose resolved successor |
| Automatic successor following | Off by default; only explicit `AUTO_FOLLOW_DIRECT`, linked and reversible |
| Preference representation | One scalar row plus small normalized selection tables |
| Ranking | Pure deterministic `deterministic-opportunity-priority-v1` |
| Hard eligibility | Separate `ELIGIBLE` / `UNKNOWN` / `NOT_ELIGIBLE` result, not weighted points |
| Unknown evidence | `UNKNOWN`; excluded from the score denominator and reported through coverage |
| Low scores | Still returned; a low score alone never hides an opportunity |
| Closed opportunities | Excluded from the normal recommendation feed as hard-ineligible, optionally inspectable |
| Recommendation persistence | Extend M6 decisions/impressions; no recommendation cache or resume dependency |
| Dismissal | Versioned private suppression released only by a material canonical change or user restore |
| Alert delivery | Transactional in-app insert only |
| Alert deduplication | SHA-256 semantic fingerprint plus database uniqueness |
| Alert work | M7 `ALERT_FANOUT` plus owner-scoped `ALERT_EVALUATE`; no second scheduler |
| Recommendation work | Request-time deterministic scoring; no `RECOMMENDATION_REFRESH` in M9 |
| Alert expiry | Derived from timestamps; no `ALERT_EXPIRY` work type required |
| External services | None required or called |

## 1. Current user-preference and watchlist state

### Existing user and privacy foundation

- Better Auth backs `users`, sessions, and the authenticated web boundary.
- Owner-scoped routes derive the user from the trusted session. They do not accept `userId` from
  the browser, and a cross-user identifier is returned as not found.
- `user_profiles` currently stores only timezone and locale. It is not a recruiting-preference
  profile.
- Admin status does not grant access to a user's private product events, future preferences,
  ranking history, or alerts.
- Account deletion cascades private product data. M9 tables must join that existing deletion
  boundary and must not leave private orphans.

### Existing watchlist placeholder

Migration `0006_identity_privacy_audit_instrumentation.sql` created
`watchlist_items` with only:

- `COMPANY` or `JOB` type;
- one `company_id` or source-posting `job_id`;
- untyped `metadata`;
- `created_at`; and
- partial uniqueness for `(user, company)` and `(user, job)`.

There is no repository layer, API, or product UI using this table. It has no soft removal,
notification override, successor history, recruiter/school target, or canonical-opportunity
target. M8 deliberately did not mutate it. Any M8-era `JOB` row therefore still points to a
source posting even though M8 now guarantees that every source posting has one active opportunity
membership.

### Existing recommendation instrumentation

M6 already supplies the correct analytics foundation:

- `ranking_decisions`: user, surface, candidate-set version, algorithm name/version, input
  fingerprint, candidate count, and timestamp;
- `recommendation_impressions`: compound owner foreign key, item, position, score, and shown time;
  and
- append-only protection for both tables.

M9 must add safe factor/reason/eligibility fields to these tables, not introduce
`recommendation_runs`, `recommendation_snapshots`, or another impression ledger.

The database enum contains dormant M6 names such as `RECOMMENDATION_IMPRESSION`, `JOB_SAVED`, and
`JOB_DISMISSED`, while the TypeScript event contract does not currently activate them. M9 will add
and actively use the milestone's opportunity-first names. The old values remain dormant for
migration compatibility and are not relabeled into misleading events.

### Existing canonical and structured opportunity data

M8 supplies the required deterministic inputs:

- active/superseded canonical opportunities and explicit successor links;
- temporal opportunity-to-source-posting membership;
- append-only merge/split resolution decisions;
- role family, experience level, employment type, internship/new-grad flags, graduation years,
  workplace mode, deadline, lifecycle, and source authority;
- structured member-posting locations, requirements, constraints, and deadlines; and
- conservative `OPEN`, `CLOSED`, or `UNKNOWN` lifecycle projection.

Important limitations must be visible in M9 behavior. Location parsing is intentionally narrow;
unknown locations are common. Internship/new-grad false values can mean “not detected,” not an
explicit negative. Work-authorization parsing currently recognizes explicit U.S. authorization,
sponsorship, and citizenship language; it is not a global immigration rules engine. These gaps
must produce `UNKNOWN`, never invented matches or mismatches.

### Existing related intelligence and UI

- Companies, recruiter profiles, schools, recruiter-school relationships, campus recruiting
  events, recruiting dates, calendar items, and canonical interview-question associations already
  exist as shared evidence or private projections, as appropriate.
- The Settings page visually contains graduation year, school, target role/location,
  internship/new-grad fields, and four alert toggles, but these controls are uncontrolled
  placeholders with no persistence. Their visual defaults are not user consent or stored data.
- The jobs/dashboard product surfaces still primarily expose source postings. M9 recommendation
  surfaces must use opportunity-first database functions and API shapes.
- M7 has a closed work-type union, typed work subjects, schedules, work items, attempts, leases,
  fenced completion, retry/dead-letter handling, and separate global versus owner-scoped work.
  No personalization work type exists yet.

### Implementation surfaces inspected for this plan

| Surface | Current source of truth |
| --- | --- |
| Users, privacy, watch placeholder, instrumentation | `packages/db/migrations/0006_identity_privacy_audit_instrumentation.sql`, authenticated route helpers, `packages/db/src/instrumentation.ts` |
| Companies and source postings/classification | `packages/db/migrations/0001_core.sql` and current collector persistence/classifiers |
| Canonical opportunity graph and structured facts | `packages/db/migrations/0010_canonical_job_graph.sql`, `packages/db/src/opportunities.ts`, opportunity API/type contracts |
| Recruiters and schools | `packages/db/migrations/0004_recruiter_campus_intelligence.sql` and recruiter/campus repositories/routes |
| Recruiting dates and private calendar | `packages/db/migrations/0005_recruiting_calendar.sql`, `packages/db/src/calendar.ts`, calendar routes/types |
| Interview updates | GitHub intelligence persistence and company-question observation/event paths |
| Settings scaffolding | `apps/web/app/settings/page.tsx`; only the Google Calendar card is currently functional |
| Worker control plane | `packages/db/migrations/0007_durable_orchestration_source_governance.sql`, TypeScript orchestration repositories/types, and Python runtime handlers |

No existing watchlist repository/API, recruiting-preference repository/API, recommendation scorer,
suppression model, alert ledger, or in-app alert delivery implementation was found.

## 2. Watchlist schema

Evolve `watchlist_items`; do not create one table per entity type.

### Types

Add:

- `watchlist_item_type`: `OPPORTUNITY`, `RECRUITER`, and `SCHOOL`; keep `COMPANY`; retain `JOB` as
  a deprecated migration value but reject it in all M9 writes.
- `watchlist_item_state`: `ACTIVE`, `REMOVED`, `SUPERSEDED`.
- `watchlist_origin`: `USER`, `MIGRATED_SOURCE_POSTING`, `SUCCESSOR_FOLLOW`.
- `watchlist_reason`: `SAVED_FOR_LATER`, `TARGET_COMPANY`, `RECRUITING_CONTACT`, `TARGET_SCHOOL`,
  `OTHER`.
- `watch_notification_override`: `INHERIT`, `ENABLED`, `DISABLED`.
- `watch_successor_policy`: `MANUAL`, `AUTO_FOLLOW_DIRECT`.

`ROLE_FAMILY` is not added as a watch type in M9. It would duplicate the role-family preference
set, create conflicting alert semantics, and provide no identity-history benefit. It can be added
later only if a product surface needs a separately named, separately notified role-family watch.

### Columns and constraints

The evolved table should contain:

| Column | Purpose |
| --- | --- |
| `id`, `user_id` | Stable private watch identity and owner |
| `item_type` | Closed watch target union |
| `company_id` | Typed company target |
| `opportunity_id` | Typed canonical-opportunity target |
| `recruiter_profile_id` | Typed recruiter target; recruiter profile is the current recruiter API identity |
| `school_id` | Typed school target |
| `legacy_job_id` | Source-posting provenance for a migrated M6/M8 `JOB` watch only |
| `origin`, `watch_reason` | Why/how the watch exists without storing arbitrary private prose |
| `notification_override` | Per-watch tri-state override |
| `successor_policy` | Explicit, reversible opportunity successor behavior |
| `state` | Active versus historical state |
| `superseded_by_watchlist_item_id` | Link from a historical watch to an automatically created successor watch |
| `created_at`, `updated_at` | Lifecycle timestamps |
| `removed_at`, `superseded_at` | State evidence; no hard delete |
| `legacy_metadata` | Read-only preservation of any non-empty old `metadata`; never used for M9 decisions |

Enforce exactly one typed target for every non-deprecated item type. All shared-target foreign keys
use `ON DELETE RESTRICT`; deletion must not erase private user intent. User deletion still cascades
the entire private row.

Use one partial unique index per active typed target, for example
`(user_id, opportunity_id) WHERE state='ACTIVE' AND opportunity_id IS NOT NULL`. A removed watch may
be added again as a new row, preserving each watch cycle instead of rewriting history.

### API behavior

- A duplicate active add returns the existing row with `created=false`; concurrent calls rely on
  the partial unique index, not a check-then-insert race.
- `DELETE` performs an idempotent soft removal. It sets `state=REMOVED` and `removed_at` but never
  deletes the row.
- A list response returns the original target plus a derived `resolution` object for a superseded
  opportunity. The resolver follows a bounded, cycle-checked successor chain.
- `PATCH` is included for notification override and successor policy. Neither setting belongs in
  opaque metadata.

## 3. Recruiting preference schema

Preferences are private, compact, explicit, and normalized. Company preference remains the company
watchlist; it is not duplicated into a profile array.

### Scalar row

Create one `user_recruiting_preferences` row per user only after the user first saves settings:

| Column | Meaning |
| --- | --- |
| `user_id` | Primary key and cascading owner foreign key |
| `graduation_year` | Nullable validated year; null means unset |
| `us_work_authorized` | Nullable explicit answer; never inferred |
| `requires_employer_sponsorship` | Nullable explicit answer; never inferred |
| `preference_version` | Monotonically increasing integer for ranking reproducibility |
| `created_at`, `updated_at` | Private settings audit timestamps |

Do not collect citizenship in M9. An opportunity's `CITIZENSHIP_REQUIRED` constraint therefore
remains `UNKNOWN` for hard eligibility. If a later product decision collects citizenship, it needs
a separate privacy review and explicit consent.

### Normalized selections

Use small owner-scoped child tables with `(user_id, value)` uniqueness:

- `user_preferred_role_families` using the existing `role_family` enum;
- `user_preferred_early_career_tracks` with `INTERNSHIP` and `NEW_GRAD`;
- `user_preferred_employment_types` using the existing employment enum, excluding `UNKNOWN`;
- `user_preferred_experience_levels` using the existing level enum, excluding `UNKNOWN`;
- `user_preferred_workplace_modes` with `REMOTE`, `HYBRID`, and `ONSITE`;
- `user_preferred_locations`; and
- `user_target_schools`, referencing canonical `schools`.

`user_preferred_locations` stores a closed location kind (`CITY_REGION_COUNTRY`, `REGION_COUNTRY`,
`COUNTRY`, `REMOTE_REGION`), normalized city/region/country/remote-region fields, and a bounded
display label. Matching uses only those fields and M8 structured locations. M9 does not add a
geocoder, location API, or bundled location dataset.

An empty selection table means “no preference configured,” not “match nothing.” PATCH replaces
each supplied set transactionally after trimming, canonical enum validation, deduplication, and
stable sorting. Omitted fields remain unchanged. Explicit `null` clears nullable scalar values.
`preference_version` increments only when normalized state materially changes.

Target schools serve preference matching for campus signals. A school watch is stronger explicit
notification intent and remains a separate watchlist item.

## 4. Deterministic recommendation algorithm

Implement one pure scorer shared by the recommendation API and alert evaluator:

```text
algorithm name: deterministic-opportunity-priority
algorithm version: v1
factor contract: opportunity-priority-factors-v1
```

The scorer accepts an immutable preference snapshot, watch snapshot, canonical opportunity facts,
and one captured `asOf` timestamp. It performs no network calls and reads no resume data. The same
inputs, algorithm version, and `asOf` value must produce byte-for-byte identical factor results,
score, category, reasons, and ordering.

### Weighted factors

Hard eligibility is evaluated first and is not part of these 100 configured weight units.

| Factor | Weight | Full match | Partial match | Mismatch | Unknown/not applicable |
| --- | ---: | --- | --- | --- | --- |
| `COMPANY_PREFERENCE` | 18 | Opportunity or company actively watched | None | Not watched when the user has target company/opportunity watches | Excluded if no such watches exist |
| `ROLE_MATCH` | 18 | Canonical known role is selected | None in v1 | Known role is not selected | Excluded when no role preference or role is `OTHER`/unknown |
| `EARLY_CAREER_TRACK` | 12 | Explicit internship/new-grad fact intersects selected track | Both-track opportunity intersects one selected track: 10 | Explicit known track does not intersect | Excluded when unset or source facts are not explicit enough |
| `EXPERIENCE_LEVEL` | 10 | Known level is selected | None in v1 | Known level is not selected | Excluded when unset or level is `UNKNOWN` |
| `EMPLOYMENT_TYPE` | 8 | Known type is selected | None in v1 | Known type is not selected | Excluded when unset or type is `UNKNOWN` |
| `LOCATION_MATCH` | 12 | Exact city/region/country: 12 | region/country: 10; remote region: 10; country only: 6 | All explicit locations are outside selected locations | Excluded when unset or all opportunity locations are unknown |
| `WORKPLACE_MODE` | 8 | Exact selected mode | `MIXED` intersects selected modes: 6 | Known mode does not intersect | Excluded when unset or mode is `UNKNOWN` |
| `FRESHNESS` | 6 | Opened/reopened within 24 hours: 6 | <=3d: 5; <=7d: 4; <=14d: 2 | Older: 0 | Always available for active opportunities |
| `DEADLINE_URGENCY` | 4 | Due in <=1 day: 4 | <=3d: 3; <=7d: 2; <=14d: 1 | Later: 0 | Excluded when no reliable future deadline exists |
| `SOURCE_CONFIDENCE` | 4 | Official ATS: 4 | official company: 3; reviewed direct: 2; community: 1 | unreviewed: 0 | Always available because authority has an explicit value |

For multi-location opportunities, any viable explicit location may earn the best applicable
location score; a job is not penalized because a second listed office is outside the user's
preferences. Contradictory member-posting facts are reported and resolved conservatively through
the canonical source/authority rules; they are not silently collapsed into a negative.

### Score and coverage

Every factor has one state: `MATCH`, `PARTIAL`, `MISMATCH`, `UNKNOWN`, or `NOT_APPLICABLE`.
`UNKNOWN` and `NOT_APPLICABLE` contribute neither earned points nor denominator weight. This keeps
unknown evidence from becoming an assumed mismatch.

```text
Recommendation Score = round(100 * earned_points / available_weight)
```

If `available_weight=0`, the score is null and the category is `LOW_PRIORITY` with
`INSUFFICIENT_EVIDENCE`. Return a coarse evidence-coverage label:

- `HIGH`: available weight >= 70;
- `MEDIUM`: available weight 40-69; and
- `LOW`: available weight < 40.

Recommendation category is intentionally stricter than the displayed score:

- `HIGH_PRIORITY`: score >= 70, available weight >= 50, and at least two known personal-preference
  factors;
- `MEDIUM_PRIORITY`: score >= 40 and available weight >= 35;
- `LOW_PRIORITY`: every other non-ineligible result; and
- `NOT_ELIGIBLE`: any definitive hard-constraint failure.

This prevents a fresh official posting with almost no user preferences from looking like a fully
personalized high-priority recommendation. The score is labeled **Recommendation Score** and is
documented as deterministic prioritization, never as acceptance likelihood or hiring probability.

### Freshness and stable ordering

Freshness uses the most recent canonical `OPENED` or `REOPENED` change, not a duplicate source
posting's `last_seen_at`. Existing pre-M9 opportunities fall back to their canonical earliest
first-seen date and never receive a fake M9 “new” event.

Capture database time once per ranking decision. Sort with this total order:

1. hard-eligibility bucket: `ELIGIBLE`, then `UNKNOWN`, then `NOT_ELIGIBLE` when requested;
2. recommendation category;
3. score descending, with null last;
4. reliable deadline ascending, null last;
5. effective canonical opened time descending; and
6. opportunity UUID ascending.

The cursor contains the signed/validated `asOf`, preference version, algorithm version, filter
fingerprint, and last sort tuple. A preference or algorithm version mismatch starts a new ranking
decision rather than mixing pages from two rankings.

### Explanations

Internally use stable codes, for example:

- positive: `WATCHED_COMPANY`, `WATCHED_OPPORTUNITY`, `ROLE_FAMILY_MATCH`, `INTERNSHIP_MATCH`,
  `GRADUATION_YEAR_ELIGIBLE`, `LOCATION_EXACT_MATCH`, `REMOTE_MODE_MATCH`, `NEWLY_OPENED`;
- partial/unknown: `LOCATION_REGION_MATCH`, `LOCATION_UNKNOWN`, `WORKPLACE_MODE_UNKNOWN`,
  `GRADUATION_REQUIREMENT_UNKNOWN`, `SOURCE_UNREVIEWED`;
- mismatch: `ROLE_FAMILY_MISMATCH`, `LOCATION_MISMATCH`, `WORKPLACE_MODE_MISMATCH`; and
- hard: `OPPORTUNITY_CLOSED`, `DEADLINE_PASSED_CONFIRMED`, `GRADUATION_YEAR_INELIGIBLE`,
  `SPONSORSHIP_UNAVAILABLE`, `WORK_AUTHORIZATION_REQUIRED`.

The API maps codes to bounded deterministic display text. It never returns or persists raw job
descriptions as diagnostics.

## 5. Hard-constraint handling

Evaluate hard constraints before weighted factors. A hard result contains status, stable reason
codes, and evidence state; it never contributes `-10` or another arbitrary point deduction.

Here, `ELIGIBLE` means **no known hard blocker under the user's configured constraints**, not a
claim that the employer will accept the user. Return `UNKNOWN` when lifecycle is unknown or a
configured hard preference cannot be evaluated from reliable explicit opportunity evidence. With
an open opportunity and no configured personal hard constraints, the result is `ELIGIBLE` under
that limited definition.

| Input | Result |
| --- | --- |
| Opportunity is `SUPERSEDED` | Do not rank it; resolve to active successor or report resolution |
| Canonical lifecycle is `CLOSED` | `NOT_ELIGIBLE` |
| Reliable explicit deadline has passed and no fresher authoritative open evidence conflicts | `NOT_ELIGIBLE` |
| Lifecycle is `UNKNOWN` | Eligibility `UNKNOWN`; keep visible at low priority |
| User graduation year and authoritative explicit allowed years conflict | `NOT_ELIGIBLE` |
| User graduation year matches authoritative explicit eligibility | `ELIGIBLE` reason; no weighted points |
| User requires sponsorship and authoritative source says sponsorship unavailable | `NOT_ELIGIBLE` |
| User explicitly lacks U.S. authorization and authoritative source explicitly requires it | `NOT_ELIGIBLE` |
| User requires sponsorship and authoritative source says sponsorship available | Positive eligibility reason; no weighted points |
| Citizenship requirement with no explicit user citizenship setting | `UNKNOWN`, never mismatch |
| Missing, parser-only ambiguous, stale, or conflicting constraint evidence | `UNKNOWN` |

“Authoritative explicit” means explicit structured evidence selected under M8 canonical-source and
reviewed source-authority rules. An unreviewed community claim cannot hard-reject a user. A passed
deadline that conflicts with fresh authoritative `OPEN` evidence becomes `UNKNOWN` plus a conflict
reason instead of `NOT_ELIGIBLE`.

The normal feed excludes `NOT_ELIGIBLE` items because they failed a hard condition, not because
their score was low. `includeIneligible=true` allows inspection with the reason. Low-priority
eligible/unknown items are included by default.

## 6. Recommendation and versioning model

### Canonical change ledger

Add a small append-only domain ledger, `opportunity_change_events`, to make canonical changes and
open cycles explicit. This is not recommendation analytics; it is canonical domain evidence used
by freshness, suppression release, and alerts.

Store:

- opportunity and company;
- event type: `BASELINE`, `CREATED`, `OPENED`, `REOPENED`, `CLOSED`, `MATERIAL_FACTS_CHANGED`,
  `DEADLINE_CHANGED`, `MERGED`, or `SPLIT`;
- monotonically increasing opportunity change version;
- previous/current lifecycle when relevant;
- a SHA-256 material fingerprint over scoring/alert fields;
- bounded reason codes and resolution-decision/correlation identifiers;
- occurred time; and
- uniqueness on `(opportunity_id, change_version)` plus an idempotency fingerprint.

The material fingerprint includes canonical role, level, employment type, early-career track,
graduation eligibility facts, structured location/workplace facts, explicit eligibility
constraints, canonical deadline, lifecycle/open-cycle identity, canonical source, and authority.
It excludes descriptions, source-posting duplicate count, ordinary `last_seen_at` refreshes, and
other non-material text.

M8 recomputation appends a change only after comparing old and new material projection in the same
domain transaction. Merge/split operations append their explicit event. The migration writes
`BASELINE` rows for existing opportunities, marked pre-cutover and ineligible for new-opening
alerts.

### Reuse and extend M6 ranking tables

Keep the current `ranking_decisions` columns and add:

- captured `as_of`;
- `preference_version`;
- `filter_fingerprint`;
- optional `request_id`; and
- a check restricting M9 opportunity surfaces to the registered algorithm/version.

`candidate_set_version` is the SHA-256 fingerprint of the ordered candidate opportunity IDs and
their material change versions under the exact filter/as-of contract. `candidate_count` is the
exact count before page limiting. Together with the input/filter fingerprint and algorithm
version, this records the considered set without persisting source text or creating a second
candidate analytics table.

Extend `recommendation_impressions` with:

- typed `opportunity_id` foreign key while retaining the generic M6 fields for compatibility;
- `recommendation_category` and `eligibility_status`;
- `evidence_coverage` and `available_weight`;
- stable `reason_codes`, `mismatch_codes`, and `hard_constraint_codes` arrays;
- bounded `factor_values` JSON containing only factor code, state, earned weight, and available
  weight; and
- `algorithm_version` is inherited and validated through the parent decision.

No description excerpt, resume text, authorization prose, or raw structured-requirement evidence
is stored in recommendation diagnostics.

Each rendered recommendation surface creates one `ranking_decision` and ordered impression rows
for exactly the items returned to that surface. Disable framework prefetch for these endpoints so
an impression corresponds to a delivered surface, not speculative loading. The response includes
opaque impression IDs; `RECOMMENDATION_OPENED` accepts only an owner-scoped impression ID, and the
server derives the score/version/opportunity from its immutable row. A client cannot submit a
score, rank, reason, or algorithm version.

Supported initial surfaces are `DASHBOARD`, `OPPORTUNITIES`, `COMPANY`, `DAILY_RECOMMENDATIONS`,
and `WATCHLIST`. Unknown surface strings are rejected for M9 writes.

## 7. Alert schema and rules

### Alert record

Create private `alerts` with:

| Field group | Columns |
| --- | --- |
| Identity/owner | `id`, `user_id`, `alert_type` |
| Canonical subjects | nullable typed opportunity, company, recruiter profile, school, campus event, recruiting date, interview question association, or calendar item IDs |
| Trigger evidence | opportunity change/evaluation request IDs, trigger fingerprint, reminder window |
| Explanation | rule version, algorithm version when recommendation-based, stable reason codes, bounded deterministic title/body snapshots |
| Deduplication | semantic `dedupe_fingerprint`, dedupe contract version |
| State | `created_at`, `occurred_at`, `shown_at`, `opened_at`, `read_at`, `dismissed_at`, `expires_at` |
| Reconciliation | nullable `superseded_by_alert_id` |

The API derives state using this precedence:

1. `DISMISSED` when `dismissed_at` is set;
2. `EXPIRED` when superseded or `expires_at <= now()`;
3. `READ` when `read_at` is set; otherwise
4. `UNREAD`.

Read, dismissed, expired, and merge-reconciled alerts are retained. Title/body are versioned
template snapshots so history does not change when display copy changes. They may contain the
public company/opportunity/event name but never raw descriptions or private preference values.

### Alert types and v1 rules

| Alert type | Deterministic rule |
| --- | --- |
| `WATCHED_COMPANY_OPPORTUNITY_OPENED` | New `OPENED`/`REOPENED` canonical event after watch activation; active company watch; not hard-ineligible; if early-career preferences are configured, the opportunity must match one selected track |
| `RECOMMENDED_OPPORTUNITY_OPENED` | New open cycle after notification activation; `HIGH_PRIORITY`; eligibility not `NOT_ELIGIBLE`; at least medium evidence coverage; never previously alerted for this open cycle |
| `APPLICATION_DEADLINE_APPROACHING` | Reliable future canonical deadline crosses exactly the 7-, 3-, or 1-day window; relevant opportunity/company watch or high-priority recommendation |
| `OPENING_WINDOW_STARTED` | Recruiting date of `EXPECTED_OPENING_WINDOW` or `APPLICATION_OPEN` begins; company watched or preferences match; retain date certainty in the explanation |
| `WATCHED_RECRUITER_DISCOVERED` | New recruiter projection intersects a watched company, watched school, or target school after activation |
| `WATCHED_RECRUITER_ACTIVITY` | Material recruiter activity for an explicitly watched recruiter, or for a watched-company recruiter when that type is enabled |
| `CAMPUS_EVENT_DISCOVERED` | New campus event intersects a target/watched school and a watched company; both sides are required in v1 |
| `INTERVIEW_INTELLIGENCE_UPDATED` | Canonical interview question association is added or materially updated for a watched company/opportunity; observation-count carry-forward alone is not material |
| `CALENDAR_ACTION_DUE` | Owner's non-deleted `TODO` calendar item becomes due; completed, skipped, or cancelled items do not alert |

Rule inputs must be temporally gated. Creating a watch or enabling a type does not generate a
backlog of “newly opened” alerts for older events. Recommendation pages may still rank older open
opportunities. M9 baseline events are never alert triggers.

A user can configure a minimum recommendation category for the recommended-opening alert, but M9
exposes only the safe fixed choices `HIGH_PRIORITY` or disabled; arbitrary score thresholds are
deferred until the v1 score is calibrated.

### Notification preferences

Create:

- `user_notification_preferences`: owner row, `in_app_enabled`, activation timestamp, settings
  version, timestamps;
- `user_alert_type_preferences`: normalized `(user, alert_type)` enabled rows and update time.

The in-app master switch always wins. Otherwise an applicable watch override wins over the alert
type default; `INHERIT` uses the type setting. An explicit per-watch `ENABLED` may override a type
default but cannot bypass a disabled in-app master switch.

Document defaults in the API rather than deriving them from placeholder UI. V1 defaults enable
watch-driven openings, watched deadline/window/recruiter/campus/interview signals, and due calendar
actions. `RECOMMENDED_OPPORTUNITY_OPENED` defaults disabled until the user explicitly enables it.
There is no retroactive alert fanout when defaults or settings change.

## 8. Alert deduplication

Deduplication is semantic and database-enforced. Compute a versioned SHA-256 fingerprint from
normalized identifiers; place a unique constraint on `(user_id, dedupe_fingerprint)`, then insert
with `ON CONFLICT DO NOTHING` in the same transaction as in-app delivery.

Examples:

```text
user | WATCHED_COMPANY_OPPORTUNITY_OPENED | resolved-opportunity | open-cycle-event | dedupe-v1
user | RECOMMENDED_OPPORTUNITY_OPENED | resolved-opportunity | open-cycle-event | dedupe-v1
user | APPLICATION_DEADLINE_APPROACHING | resolved-opportunity | deadline-fact-version | 3_DAY | dedupe-v1
user | CAMPUS_EVENT_DISCOVERED | canonical-campus-event | projection-version | dedupe-v1
user | INTERVIEW_INTELLIGENCE_UPDATED | company-question-association | material-update-event | dedupe-v1
user | CALENDAR_ACTION_DUE | calendar-item | due-date-version | due-window | dedupe-v1
```

Do not include source-posting ID, collector run ID, work attempt ID, or ordinary retry ID. An
algorithm update also does not re-alert an already alerted open cycle; the semantic dedupe contract
version changes only when product semantics intentionally change.

Concurrent workers may evaluate the same event. Both must resolve the same normalized target and
fingerprint; the unique index selects one winner. The losing transaction treats conflict as
successful idempotent completion. Unit tests of an in-memory deduper are insufficient; concurrency
must be covered by a PostgreSQL integration test.

When a deadline changes, pending alerts for the old fact version expire and new 7/3/1 windows use
the new deadline version. A retry of the same date projection is not a new version.

## 9. Notification provider architecture

Define a narrow application interface:

```text
NotificationProvider.deliver(NotificationCandidate) -> DeliveryResult
```

The candidate contains an owner, typed alert, canonical subjects, semantic fingerprint, template
version, reason codes, and expiry. The provider does not rank or decide eligibility.

M9 registers exactly one provider:

- `IN_APP`: performs the unique alert insert transactionally and returns `CREATED` or
  `ALREADY_EXISTS`.

The channel enum/interface may name future `EMAIL`, `PUSH`, `DISCORD`, and `SMS` capabilities in
code documentation, but the M9 database/API allowlist exposes only `IN_APP`. No credential,
provider SDK, webhook, email service, phone number, delivery attempt, or external outbox is needed
for M9 or `ZERO_COST_MODE`.

A future non-transactional provider must add a durable delivery outbox/attempt ledger on M7, with
provider-specific idempotency and consent. It must not send first and stamp later. FreeHire's
external flow explicitly permits a rare duplicate after that crash window, so that delivery
ordering is not adopted.

## 10. Orchestration integration

Add M9 to M7; do not create cron tables, an alert daemon, or a second scheduler.

### Work types and domain requests

Add two closed work types:

- `ALERT_FANOUT`: global trigger expansion; and
- `ALERT_EVALUATE`: owner-scoped deterministic rule evaluation and in-app insert.

Do not add `RECOMMENDATION_REFRESH` in M9. Recommendation scoring is pure and request-time, and the
alert evaluator invokes the same scorer. Do not add `ALERT_EXPIRY`; expiry is derived from
`expires_at` and old rows are retained.

Create a domain `alert_evaluation_requests` table rather than encoding alert state in work-item
payloads. A request records trigger type/version, bounded typed subject IDs, causal domain-event
ID, optional owner for child requests, parent request, semantic request fingerprint, and status.
It contains no raw page, description, preference snapshot, or alert body.

`ALERT_FANOUT` consumes one ownerless request and inserts only the affected owner requests. Examples:

- opportunity open change -> users watching its company/opportunity plus users eligible for the
  enabled recommendation rule;
- recruiter/campus/interview event -> users whose explicit watch/target-school index intersects;
- scheduled due scan -> users with a deadline/window/calendar item entering a reminder window.

Each child request enqueues one `ALERT_EVALUATE` work item with the same `user_id`. The handler
loads only that owner's preferences/watches/settings, computes candidates, inserts alerts, and
completes under the existing M7 lease/fencing rules.

Add a `PERSONALIZATION` work class and a narrowly scoped `WORKER_PERSONALIZATION` service-principal
permission. Admin UI/service scope does not gain this permission. Claim/list/requeue repositories
must retain owner constraints; existing rules prohibiting admin requeue of owner work continue to
apply. Global fanout uses a reviewed database repository method and returns only target user IDs,
not preference contents, to the work control plane.

### Trigger sources

Enqueue an idempotent ownerless request only after the domain transaction commits for:

- canonical opportunity create/open/reopen/material change/deadline change/merge/split;
- recruiting-date material change;
- recruiter/campus projection events;
- canonical interview-intelligence add/material update; and
- calendar item material due-date/status change.

M7 schedules enqueue periodic `ALERT_FANOUT` due scans for deadline 7/3/1 windows, opening windows,
and calendar actions. Use bounded catch-up so downtime produces the still-relevant reminder window,
not one alert per missed poll. Database fingerprints make schedule replay and worker retry safe.

Scheduled and event-driven paths converge on the same evaluation request and alert fingerprint.
They cannot produce two semantic alerts.

## 11. Opportunity merge, split, close, and reopen behavior

### Merge

If watched opportunity A is superseded by B:

1. Never update the historical watch's `opportunity_id`.
2. Keep it active with original target A and return `resolvedOpportunityId=B` plus the resolution
   path while successor policy is `MANUAL`.
3. If the user previously selected `AUTO_FOLLOW_DIRECT` and the M8 resolution contains one
   unambiguous direct successor, create a linked watch for B, mark the A watch `SUPERSEDED`, and set
   `superseded_by_watchlist_item_id` in one transaction.
4. If B is already actively watched, link the historical A watch to that existing row rather than
   create a duplicate.
5. Undoing automatic follow removes the derived successor watch only when it has not since become
   independent user intent; otherwise it converts origin to `USER`. The predecessor watch remains
   available to restore.

Alert reconciliation takes an advisory lock on the resolved successor. Existing unread alerts for
both A and B are retained in history, one earliest alert becomes visible primary, and the others
are marked superseded/expired with `superseded_by_alert_id`. Future fingerprints resolve the
successor chain before insertion. Merge itself does not generate a new opening alert.

Recommendation and suppression reads resolve A to B while retaining A as the recorded original
user target. Instrumentation records both original and resolved IDs as bounded UUID context, not a
rewritten history row.

### Split

A split can produce multiple plausible active opportunities, so it is never auto-followed. The
original watch remains on its original canonical identity. The API exposes candidate children
derived from M8 temporal memberships and resolution decisions and asks the user to add the desired
watch explicitly. If the original itself stays active, it continues normally. If it becomes
superseded, resolution is shown but no ambiguous successor watch is created.

Existing alerts and dismissals remain attached to their original canonical identity. New child
opportunities can generate alerts only from a post-split open cycle and only when the ordinary
rules match; the split operation itself is not “newly opened.”

### Company identity change

Current company alias/name/slug edits preserve `companies.id`, so a company watch remains intact.
There is no canonical company merge/supersession model in the current implementation. M9 must not
invent silent company-row replacement. A future company merge feature is blocked from release
until it adds append-only company lineage and applies the same traced successor policy to watches
and alerts.

### Close and reopen

- Closing an opportunity keeps its watch and history, makes it hard-ineligible for the normal feed,
  and expires unacted opening/deadline alerts when no longer useful.
- Reopening appends a new `REOPENED` open-cycle event. The watch remains valid, suppression may be
  released under the versioned material-change rule, and a new alert may be created because its
  fingerprint contains the new open-cycle event.
- Ordinary source liveness refresh and duplicate-source attachment do not create a reopen event.

## 12. APIs

All endpoints use the existing success/error envelopes, same-origin mutation protection, session
ownership, Zod contracts, bounded pagination, and cross-user `404` behavior. No endpoint accepts a
`userId`, owner ID, score, rank, reason code, or algorithm version from the browser.

### Recruiting preferences

```text
GET   /api/me/recruiting-preferences
PATCH /api/me/recruiting-preferences
```

`GET` returns normalized sorted selections, nullable explicit authorization answers, and
`preferenceVersion`. `PATCH` is a partial transactional replacement of supplied fields. Reject
unknown enums, invalid graduation years, inconsistent location shapes, `UNKNOWN` as a selected
value, duplicate normalized locations, and school IDs that do not exist. Return the new normalized
snapshot and incremented version only on a material change.

### Watchlists

```text
GET    /api/watchlist?type=&state=&limit=&cursor=
POST   /api/watchlist
PATCH  /api/watchlist/:id
DELETE /api/watchlist/:id
```

`POST` accepts a closed discriminated union such as `{type:"OPPORTUNITY", opportunityId, reason}`.
The server validates the shared target and derives all other fields. `GET` returns target summaries,
state, notification/successor settings, and traced opportunity resolution. `PATCH` changes only
notification override or successor policy. `DELETE` soft-removes an owner row and is idempotent.

Do not add generic `{entityType, entityId}` SQL string interpolation. The route validates a closed
union and calls a typed repository branch.

### Opportunity recommendation and suppression

```text
GET    /api/recommendations/opportunities
POST   /api/recommendations/impressions/:id/open
POST   /api/opportunities/:id/dismiss
DELETE /api/opportunities/:id/dismissal
```

Recommendation query parameters:

- `limit` (1-50, default 20);
- opaque `cursor`;
- `includeLowPriority` (default `true`);
- `includeIneligible` (default `false`);
- `company` canonical UUID/slug filter; and
- `roleFamily` validated enum filter.

Low priority is included by default so low score alone does not hide an opportunity. Company/role
filters change the candidate-set fingerprint but do not change the v1 scoring formula.

Each item returns:

```text
opportunity
recommendationScore          nullable integer 0-100
recommendationCategory       HIGH_PRIORITY | MEDIUM_PRIORITY | LOW_PRIORITY | NOT_ELIGIBLE
eligibility                  ELIGIBLE | UNKNOWN | NOT_ELIGIBLE
evidenceCoverage             HIGH | MEDIUM | LOW
reasons[]
potentialMismatches[]
hardConstraints[]
generatedAt
algorithmVersion
impressionId
```

Do not expose internal factor JSON, source raw evidence, or preference values. A diagnostic admin
endpoint must not be added; an admin does not automatically have access to private results.

The open endpoint accepts only the immutable owner-scoped impression ID. The dismissal endpoint
accepts an optional closed reason enum, never arbitrary hidden prompt/profile content.

### Alerts and notification preferences

```text
GET   /api/alerts?state=&type=&limit=&cursor=
GET   /api/alerts/:id
POST  /api/alerts/shown
POST  /api/alerts/:id/open
PATCH /api/alerts/:id
POST  /api/alerts/:id/dismiss
POST  /api/alerts/mark-all-read

GET   /api/notification-preferences
PATCH /api/notification-preferences
```

`PATCH /api/alerts/:id` supports only `{read: true|false}`; clearing read is allowed but never
clears opened history. Dismiss is idempotent. Mark-all-read updates only the caller's active unread
alerts and returns the affected count. `shown` accepts a bounded list of server-issued, owner-owned
alert IDs after the UI renders them; the server records first shown time and instrumentation.
`open` atomically records first open/read time and `ALERT_OPENED`.

`GET /api/alerts/:id` is read-only. It does not fabricate an open event because a crawler or
prefetch loaded the URL.

Notification PATCH exposes only the in-app master switch and closed alert-type settings in M9.
Future channel names are not accepted before a provider is actually implemented.

### UI surfaces planned for implementation

- Wire the existing Settings visual scaffolding to real preference and notification APIs; remove
  uncontrolled/default-only values and show `UNKNOWN`/unset clearly.
- Add typed watch/unwatch controls to opportunity, company, recruiter, and school pages.
- Add an opportunity-first recommendation section to the dashboard and opportunities page with
  score label, reasons, potential mismatches, unknown evidence, and dismiss/restore.
- Add a private alert center/badge with unread, read, dismiss, and expired treatment.
- Never display the score as a probability or guarantee.

## 13. Privacy model

Classify the following as private user data:

- watchlist items and history;
- recruiting and work-authorization preferences;
- notification settings;
- ranking decisions, recommendation impressions, and suppressions;
- alerts, their read/open/dismiss state, and owner evaluation requests; and
- M9 product events.

Controls:

1. Every private table has a concrete `users(id)` owner foreign key with account-deletion cascade.
2. Every repository query includes owner in the predicate; compound owner foreign keys protect
   parent/child ranking, watch-successor, alert, and evaluation relationships where applicable.
3. APIs derive ownership from the authenticated session and map cross-user access to `404`.
4. Admin service scope can see operational aggregate counts but not rows, titles, preferences,
   recommendation history, watches, or alerts. No “admin override” repository function is added.
5. The personalization worker gets a separate least-privilege scope. Work-item/admin list views
   show request IDs/statuses, not preference or alert content.
6. Product events and diagnostics use stable reason codes and UUIDs, not descriptions,
   authorization prose, email, resume text, DOM, or raw source content.
7. Explicit work-authorization fields are optional, private, exportable, and deletable. They are
   never inferred from name, school, location, citizenship, resume, or browsing behavior.
8. Privacy export includes human-readable watches, settings, dismissals, and alerts plus safe
   ranking/impression metadata. Account deletion removes all private rows through tested cascades.
9. Logs redact request bodies for preference and notification mutation routes and never log the
   preference snapshot or alert body.

Shared companies, opportunities, recruiters, schools, events, and interview intelligence remain
public/shared domain data. Linking a private row to a shared entity does not make the private row
shared.

## 14. Instrumentation

Add and activate these exact product event types:

- `OPPORTUNITY_SAVED`;
- `OPPORTUNITY_DISMISSED`;
- `RECOMMENDATION_SHOWN`;
- `RECOMMENDATION_OPENED`;
- `ALERT_SHOWN`;
- `ALERT_OPENED`;
- `WATCHLIST_ADDED`; and
- `WATCHLIST_REMOVED`.

The existing dormant `JOB_SAVED`, `JOB_DISMISSED`, and `RECOMMENDATION_IMPRESSION` enum values
remain unused compatibility values. M9 uses opportunity-first names and does not rewrite old
events.

Server-authoritative emission rules:

| Event | Authoritative moment |
| --- | --- |
| `WATCHLIST_ADDED` | Active watch insert succeeds; duplicate no-op does not emit again |
| `WATCHLIST_REMOVED` | Active watch transitions to removed; repeated delete does not emit |
| `OPPORTUNITY_SAVED` | Opportunity watch insert succeeds; accompanies, but does not replace, watchlist-added |
| `OPPORTUNITY_DISMISSED` | New active suppression is recorded |
| `RECOMMENDATION_SHOWN` | A persisted impression is delivered on a non-prefetched recommendation surface |
| `RECOMMENDATION_OPENED` | Owner opens an existing impression through its opaque ID; first open only |
| `ALERT_SHOWN` | Rendered alert IDs are owner-validated and first-shown timestamp is recorded |
| `ALERT_OPENED` | Owner opens an existing alert; first open only |

Use deduplication keys for retrying mutations and batched shown events. Do not emit a fake open,
dismissal, or watch because an alert was generated or a recommendation was scored.

The denominator contract is:

- candidate-set fingerprint and exact candidate count on `ranking_decisions`;
- algorithm/version and captured input fingerprint;
- exact displayed item, position, score, reason codes, and shown time on impressions; and
- subsequent open/save/dismiss actions referencing the immutable impression when available.

No model is trained in M9. No embedding, resume feature, or unshown candidate is mislabeled as an
impression.

## 15. Dismissal and suppression behavior

Create private `opportunity_suppressions` rather than overloading watchlist state:

| Column | Purpose |
| --- | --- |
| `id`, `user_id` | Private suppression identity/owner |
| `opportunity_id` | Original canonical target; never silently rewritten |
| `suppression_rule_version` | `material-change-suppression-v1` |
| `basis_change_version`, `basis_material_fingerprint` | Opportunity state the user dismissed |
| `reason_code` | Optional closed user reason |
| `dismissed_at` | Action time |
| `released_at`, `release_reason` | Restore/material-change history |
| `expires_at` | Optional future policy seam; null in v1 |

Allow one active suppression per `(user, opportunity)` with a partial unique index. A new dismissal
after release creates a new historical row.

V1 suppression removes the opportunity from dashboard/recommendation surfaces by default while
its material fingerprint is unchanged. It does not delete or close the shared opportunity, remove
a watch, or suppress explicit direct navigation.

Release automatically only for:

- a genuine `REOPENED` open cycle;
- material role, level, employment, early-career, location, workplace, graduation-eligibility,
  work-authorization, deadline, or lifecycle change; or
- explicit user restore.

Do not release for a source-posting duplicate, membership-only merge with no material fact change,
ordinary `last_seen_at`, description-only edit, observation-count increase, algorithm-version
change, or alert retry. On merge, suppression resolution follows the successor for filtering but
keeps the original suppression row and material basis. On ambiguous split, it does not silently
propagate to every child.

The recommendation API may expose `suppressed=true` only on an explicit dismissed-items view; it
does not repeatedly resurface an unchanged dismissal.

## 16. Migration strategy

Use one reviewed additive M9 migration plus a dedicated migration smoke script, following the M6-
M8 pattern. The production migration must not depend on a network service or background worker to
finish.

### Preflight and additive schema

1. Assert current migration sequence is through `0010` and the schema matches the M8 constraints.
2. Add new enums/values, tables, columns, foreign keys, append-only triggers, and indexes.
3. Add owner compound keys before adding child references.
4. Preserve existing product-event enum values and data.
5. Backfill canonical `BASELINE` change events with a recorded M9 cutover timestamp; never label
   them `OPENED` or enqueue alerts.

### Watchlist conversion

For every old `COMPANY` row:

- retain the same row ID, owner, company, created time, and metadata preservation;
- set state active, origin migration/user-compatible, and default successor/notification settings;
- switch company deletion behavior from cascade to restrict.

For every old `JOB` row:

1. Join its source job to the single active M8 `job_opportunity_postings` membership.
2. Store the old job ID as `legacy_job_id` and change the target type to `OPPORTUNITY`.
3. Preserve row ID, owner, creation time, and non-empty metadata.
4. Set origin `MIGRATED_SOURCE_POSTING`.
5. If multiple source-job watches for the same user resolve to one opportunity, keep the oldest
   row as active, mark later rows `SUPERSEDED`, and link them to the primary row. Never discard
   them.

The migration fails with a diagnostic if an old job watch has zero or multiple active opportunity
memberships. It must not guess, set the private target null, or create an orphan. M8's invariant
should make this zero in a healthy database.

Keep deprecated `JOB` enum support only so PostgreSQL history remains migration-safe; an end-of-
migration assertion requires zero current `JOB` rows and all M9 APIs reject it.

### Preference and notification backfill

- Do not infer recruiting preferences from viewed jobs, events, resume data, school email, current
  placeholder controls, or company history.
- Do not create user preference rows merely to fill defaults. An absent row means all recruiting
  preferences unset and version zero.
- Notification defaults are resolved by the documented server contract. Record activation at M9
  cutover/first setting mutation, and never generate pre-activation alerts.

### Private integrity checks

The smoke migration must prove:

- user counts and identity ciphertext/token hashes are unchanged;
- every private M9 row has a valid owner;
- all legacy job watches are represented and traceable;
- there are no duplicate active watches or suppressions;
- baseline canonical events cannot alert;
- account deletion cascades all M9 private rows while shared domain entities remain; and
- two-user fixtures survive with distinct watches/preferences/alerts and no cross-owner child
  relationship.

## 17. Index and performance strategy

### Indexes

Add or verify:

- one partial active unique index per watch target type and
  `(user_id, state, created_at DESC, id)` for list/history;
- preference child primary/unique indexes beginning with `user_id`, plus reverse indexes on school,
  role, and normalized location keys for alert fanout;
- active opportunity composite indexes over lifecycle/role/early-career/latest-opened and company;
- structured location lookup indexes that include active membership job IDs;
- opportunity change indexes on `(opportunity_id, change_version DESC)` and
  `(event_type, occurred_at, id)`;
- ranking decision `(user_id, created_at DESC)` and impression
  `(user_id, opportunity_id, shown_at DESC)` indexes;
- suppression active partial unique and `(user_id, dismissed_at DESC)` indexes;
- alert unique `(user_id, dedupe_fingerprint)`, mailbox
  `(user_id, created_at DESC, id)`, and partial unread
  `(user_id, created_at DESC, id) WHERE read_at IS NULL AND dismissed_at IS NULL AND
  superseded_by_alert_id IS NULL` indexes;
- alert subject indexes for merge reconciliation and scheduled deadline lookup; and
- evaluation request ready/idempotency indexes plus owner work lookup.

Do not put `now()` in a partial-index predicate. Runtime expiry remains a query predicate backed by
`expires_at` in the mailbox index.

### Query strategy

- Score only active canonical opportunities; join source postings only to obtain selected
  structured facts/authority. Never rank one row per source posting.
- Compute deterministic factors in bounded SQL/domain projections and use keyset pagination.
- Apply explicit company/role query filters before scoring, but never silently add a popularity or
  paid-source filter.
- Compute the exact candidate count and ordered fingerprint for the decision. Do not substitute a
  page count for the denominator.
- Avoid permanent per-user x catalogue materialization in M9. It would multiply private storage,
  complicate invalidation, and is unnecessary at the current scale.
- Alert fanout starts from the changed entity and indexed watch/preference intersections; it does
  not cross join every user with every opportunity.
- Batch owner request insertion and alert insertion. Existing M7 leases and `SKIP LOCKED` divide
  work; database uniqueness resolves races.

Required performance gates:

- `EXPLAIN (ANALYZE, BUFFERS)` fixtures at 10,000 active canonical opportunities for default and
  filtered recommendation queries;
- an opt-in 1,000,000-opportunity plan/benchmark to detect full source-posting scans and unbounded
  materialization;
- fanout fixture with at least 10,000 users/watches and a hot watched company;
- mailbox/unread query fixture with 100,000 alerts for one synthetic user; and
- concurrency test with two workers evaluating the same trigger.

If the million-row benchmark cannot meet the agreed latency, optimize the deterministic SQL/index
path first. A cached refresh work type is a measured follow-up, not an unreviewed M9 requirement.

## 18. Reference-repository reuse

The audit covered the licensed repositories under `/Users/jaynapatel/Desktop/github repos` and
kept source-code licensing separate from dataset licensing. No dataset is approved for M9.

### Useful components

| Reference file/concept | License | Adaptation category | Attribution requirement | Expected saving |
| --- | --- | --- | --- | ---: |
| FreeHire `migrations/0090_user_notifications.sql` and `internal/db/queries/notifications.sql`: owner-scoped in-app ledger, idempotent read, mark-all-read, unread partial index | MIT, copyright 2026 freehire contributors | `ADAPT_WITH_ATTRIBUTION`; translate invariants into RecruitIntel SQL/API ownership and add dismiss/expire/dedupe/canonical FKs | Extend `THIRD_PARTY_NOTICES.md` FreeHire M9 description; retain MIT copyright/license for substantial adaptation and note modifications | 1-2 days |
| FreeHire `internal/notify/notify.go`, `internal/notify/match.go`, and `internal/db/queries/subscriptions.sql`: provider seam and `(subscription, job)` idempotent match ledger | MIT | `ADAPT_WITH_ATTRIBUTION` for the provider seam and retry/dedupe test ideas; use M7 instead of its cron runner | Same FreeHire notice; cite exact files near any substantial translation | 1-2 days |
| FreeHire `internal/cvmatch/aggregate.go` and `aggregate_test.go`: unavailable/unknown categories leave numerator and denominator | MIT | `ADAPT_WITH_ATTRIBUTION` into an original TypeScript deterministic scorer with evidence coverage and hard constraints | Same FreeHire notice and module comment if substantially translated | 1 day |
| FreeHire `internal/savedsearch/savedsearch.go`, `repository.go`, and `internal/db/queries/saved_searches.sql`: owner predicates, duplicate handling, closed validation | MIT | `ARCHITECTURE_INSPIRATION`; apply to typed watch routes, not saved query strings | Cite in implementation record; if logic is substantially translated, upgrade to MIT notice | <1 day |
| FreeHire saved-job reminder specifications under `openspec/changes/centralize-lifecycle-notifications/`: cancellation when intent/status no longer qualifies | MIT repository boundary | `ARCHITECTURE_INSPIRATION`; adapt tests to close/read/dismiss/disabled rules | Cite in implementation record; no code attribution needed unless text/code is copied | <1 day |

The FreeHire notification delivery sequence sends externally and then stamps completion; its own
comment allows a rare duplicate after a crash. M9 explicitly does **not** copy that behavior. An
in-app alert is committed once with its unique semantic fingerprint.

### Reviewed but not reused for M9

| Repository/component | Decision and reason |
| --- | --- |
| Job Board Aggregator | MIT code has no material watch/recommendation/alert implementation. Its `data/` tree is CC BY-NC 4.0 and is not imported. Existing M8 attribution remains sufficient. |
| Hiring Agent | Resume/LLM-centric scoring conflicts with no-ML/no-resume M9; its PyMuPDF-derived component has AGPL concerns. Do not use. |
| OpenClaw | M7 already adapted the useful MIT scheduling/SSRF concepts. M9 uses RecruitIntel's M7 implementation directly; no new OpenClaw code is needed. |
| WeSight | MIT root, but its agent/IM/provider bundle is much broader than an in-app deterministic alert engine. No M9 reuse. |
| Notchi | GPL-3.0-only. Architecture inspiration only; no code incorporation into the MIT product. It offers no superior M9 domain model. |
| Simplify internship/new-grad repositories | No license. Do not copy code, listings, labels, or datasets. |
| LeetCode companywise snapshot | No license and Premium-derived provenance. Do not use data or collection logic. |

Expected direct planning/implementation saving from the approved FreeHire concepts is roughly
3-5 engineering days. All M9 domain schema, canonical-identity behavior, scoring weights, privacy
model, and M7 integration remain RecruitIntel-specific.

## 19. Testing

No test may call a live notification provider, paid API, model, embedding service, or resume
service. Use deterministic clocks, UUIDs, canonical fixtures, and PostgreSQL for uniqueness/race
tests.

### Watchlists

- add each entity type, list, patch override/policy, remove, and re-add;
- concurrent duplicate add creates one active row and one outcome event;
- two users may watch the same entity but cannot see or mutate each other's rows;
- opportunity watch is canonical, not source-posting based;
- merge preserves original target, exposes successor, and does not auto-follow by default;
- explicit direct auto-follow is linked, deduplicated, and reversible;
- ambiguous split never auto-follows;
- company alias/name change keeps the watch by stable ID;
- close/reopen keeps watch history; and
- target deletion is restricted while user deletion cascades.

### Preferences

- PATCH normalization, sorting, deduplication, partial updates, explicit clearing, and no-op version;
- valid/invalid graduation year;
- allowed/unknown enum rejection;
- location shape and country-code validation;
- target-school existence;
- optional authorization fields stay nullable and private;
- no preference inference from product events or existing records; and
- owner isolation for reads and writes.

### Recommendations and hard constraints

- watched company/opportunity boosts priority;
- matching and wrong role families;
- internship/new-grad match, mismatch, and ambiguous false/unknown;
- graduation-year eligible, explicit mismatch, unknown, and conflicting evidence;
- location exact/region/country/remote match, mismatch, multi-location match, and unknown;
- workplace exact, mixed partial, mismatch, and unknown;
- experience and employment match/mismatch;
- explicit sponsorship/work-authorization match, mismatch, and unknown;
- closed suppression, lifecycle unknown visibility, confirmed passed deadline, and conflicting open
  evidence;
- freshness and 14/7/3/1 deadline boundaries with an injected clock;
- source authority mapping;
- unknown categories leave the denominator and coverage is correct;
- low priority is included by default;
- deterministic total order, cursor stability, and same inputs/as-of -> same result;
- algorithm/preference version change starts a new decision;
- candidate count/fingerprint and impression denominator are correct;
- one canonical opportunity appears despite multiple member source postings;
- superseded opportunities resolve rather than duplicate;
- no resume table/read/network dependency; and
- response copy never labels the score as probability.

Use golden fixtures for v1 factor results and reason-code order. An intentional score/weight change
requires a new algorithm version and new goldens; never silently edit v1.

### Alerts

- every listed alert rule's positive and negative path;
- watched company new open and distinct reopen cycle;
- high recommendation threshold plus coverage gate;
- deadline exactly at 7/3/1 windows, missed-window catch-up, changed deadline, and passed deadline;
- confirmed/estimated opening windows retain certainty;
- recruiter discovery/activity watch intersections;
- campus requires target/watched school plus watched company;
- interview association add/material update alerts, but commit carry-forward does not;
- calendar due ignores done/skipped/cancelled/deleted items;
- master/type/watch notification precedence and disabled suppression;
- pre-watch, pre-activation, and migration-baseline events do not back-alert;
- source duplicate and retry create no duplicate alert;
- merge leaves one visible alert with traceable historical duplicates;
- read, unread, shown, open, dismiss, expire, mark-all-read, and idempotent repetition;
- cross-user alert ID is `404`; and
- title/body diagnostics contain no raw job description or private preference values.

### Dismissal and instrumentation

- dismissal suppresses immediate resurfacing without deleting the opportunity;
- source refresh/duplicate/description-only change does not release;
- material location/role/eligibility/deadline change and reopen do release;
- explicit restore and second dismissal preserve separate history;
- split does not propagate suppression ambiguously;
- one ranking decision and exact impressions are recorded for each surface;
- shown/opened events occur only on real owner-owned rows and first behavior;
- opportunity saved/dismissed and watch add/remove events occur only on state transition;
- browser cannot forge score, rank, algorithm version, reason codes, or another user's impression;
  and
- append-only triggers still permit account-deletion cascade but reject direct mutation.

### Orchestration and migration

- event transaction enqueues one semantic fanout request;
- scheduled scanner creates due work without a second scheduler;
- owner fanout and evaluator scopes are enforced;
- lease expiry/retry/dead-letter/fenced late completion follow M7 behavior;
- two workers cannot create duplicate alerts;
- schedule catch-up emits only still-relevant windows;
- M8 source-job watches migrate to canonical opportunities with provenance;
- duplicate legacy watches consolidate without deletion;
- corrupt zero/multiple membership aborts migration;
- no private orphan, cross-owner child, identity regression, or retroactive alert;
- clean database and realistic M8-upgrade smoke paths; and
- two-user fixtures cover every new private table.

## 20. Documentation

During implementation:

1. Promote this plan into a canonical `docs/watchlists-recommendations-alerts.md` implementation
   record with final schema, state machines, reason-code catalogue, and exact score formula.
2. Update `docs/final-architecture-roadmap.md` only after M9 is complete, not when implementation
   begins.
3. Update `docs/canonical-job-graph.md` with the change-event ledger and traced private successor
   behavior; retain the rule that source postings are evidence.
4. Update `docs/identity-privacy-audit.md` with new private tables, worker scope, export/delete
   coverage, and explicit work-authorization handling.
5. Update `docs/orchestration-source-governance.md` with personalization work types, class,
   schedules, fanout/evaluation boundary, and recovery runbook.
6. Update recruiting calendar, recruiter/campus, and GitHub intelligence documents with their
   material alert trigger contracts and non-triggering events.
7. Add API documentation and examples for preferences, watchlists, recommendations, dismissals,
   alerts, and notification preferences.
8. Add an operator runbook for queue depth, dead letters, dedupe conflicts, alert lag, and safe
   replay without exposing private content.
9. Extend `THIRD_PARTY_NOTICES.md` if FreeHire logic is substantially adapted, naming the exact M9
   source files and RecruitIntel modifications.
10. Document that `ZERO_COST_MODE` registers only in-app delivery and that no provider credential
    is required.

## 21. Definition of done

M9 is done only when all of the following are true:

- Users can persist and privately manage company, canonical opportunity, recruiter, and school
  watches through real UI/API flows.
- Every legacy source-job watch is traceably preserved as a canonical-opportunity watch.
- Merge, split, company-identity, close, and reopen behavior matches the explicit rules above and
  never silently rewrites user intent.
- Recruiting preferences are normalized, explicit, optional, private, validated, and wired to the
  Settings UI; no sensitive/private attribute is inferred.
- The versioned v1 scorer uses only existing RecruitIntel canonical/structured data, has a published
  exact formula, separates hard eligibility, preserves unknown, returns explanations/mismatches,
  includes low priority, and never uses resume/ML/LLM data.
- Recommendation surfaces contain no source-posting duplicates and produce stable ordering for
  stable inputs/as-of time.
- M6 ranking decisions and impressions record candidate-set fingerprint/count, algorithm version,
  position, score, reason codes, coverage, and genuine shown/open behavior.
- Versioned suppression prevents immediate redisplay and releases only for documented material
  change or user restore.
- Every v1 alert type is implemented from canonical/shared events and explicit private settings.
- A retry, duplicate source posting, merge, schedule replay, or two concurrent workers cannot
  produce two visible semantic alerts.
- In-app alert read/dismiss/expire history is retained and owner-isolated.
- M7 is the only scheduler; personalization work is leased, fenced, retryable, observable, and
  least-privilege.
- All requested unit, integration, API, UI, migration, privacy, performance, and concurrency tests
  pass without live external calls.
- `ZERO_COST_MODE=true` supports the entire milestone with no paid API, paid model, paid
  notification provider, or paid recommendation service.
- Documentation, migration smoke coverage, privacy export/delete behavior, operational runbook,
  and required attribution are complete.

## 22. Risk and complexity

Overall complexity is **high**. The scoring arithmetic is small; the difficult work is preserving
identity and private intent across canonical changes while making alerts race-safe and observable.

| Risk | Level | Control |
| --- | --- | --- |
| Merge/split silently changes or duplicates private intent | High | Immutable original targets, successor links, explicit follow policy, merge reconciliation, adversarial tests |
| Duplicate alerts under retry/concurrency/source duplication | High | Canonical event identity, semantic fingerprint, database uniqueness, transactional in-app insert, PostgreSQL race tests |
| Unknown structured evidence becomes a false mismatch | High | Five-state factors, unknown excluded from denominator, hard constraints require authoritative explicit evidence, coverage label |
| Score appears more certain than evidence | High | Coverage/category gates, reasons and mismatches, “Recommendation Score” language, no hiring probability claim |
| Ranking instrumentation records prefetched/unshown results | Medium-high | Disable prefetch, create impressions only for delivered surface items, explicit owner-validated shown/open handling |
| Canonical recomputation creates noisy change events | High | Versioned material fingerprint excluding descriptions/liveness/duplicates, golden transition tests |
| Fanout exposes or scans all private profiles | High | Dedicated personalization scope, owner child requests, indexed intersection queries, operational metadata only |
| Deadline/source conflicts cause false rejection or reminder | Medium-high | Reviewed authority gate, conflict -> `UNKNOWN`, deadline fact versioning, old-alert expiry |
| Existing Settings visuals are mistaken for consent/data | Medium | No inferred migration, real controlled fields, explicit notification contract and activation cutoff |
| Recommendation query degrades as catalogue grows | Medium-high | Canonical-only indexed SQL, keyset pagination, exact benchmark gates, measured optimization before caching |
| PostgreSQL enum/table migration damages legacy watches | High | Additive/deprecated enum strategy, preflight assertions, traceable consolidation, clean and M8-upgrade smoke tests |
| External notification scope creeps into M9 | Medium | Only `IN_APP` registered/exposed; future providers require separate durable-delivery milestone |
| Reference code introduces license/data problems | Low with controls | FreeHire MIT attribution only; no datasets; reject GPL, AGPL-risk, unlicensed, and CC BY-NC data |

### Recommended implementation sequence after approval

1. **Contracts and migration:** types, watch evolution, preferences, change events, ranking
   extensions, suppressions, alerts, notification settings, evaluation requests, and smoke tests.
2. **Private settings and intent:** owner-scoped repositories/APIs, Settings UI, typed watch UI,
   migration fixtures, privacy export/delete.
3. **Pure recommendation core:** opportunity fact projection, hard constraints, v1 scorer, stable
   cursor/order, explanations, decisions/impressions, dismiss/restore.
4. **Canonical event integration:** material fingerprint/change ledger hooks in creation,
   recomputation, merge, split, recruiting-date, recruiter/campus, interview, and calendar paths.
5. **M7 alert integration:** personalization scope, fanout/evaluate handlers, due schedules,
   provider seam, unique in-app insert, retry/concurrency tests.
6. **Product surfaces and hardening:** recommendation feed, alert center, instrumentation, performance
   plans, privacy/security review, operations docs, attribution, and full regression suite.

Each phase should land with its own migration/API compatibility tests, but no partial phase should
enable alert schedules until the canonical change ledger, user preference defaults, dedupe unique
constraint, and owner-isolation tests are all complete.

---

**Approval gate:** This document is the complete M9 planning pass. Do not begin Milestone 9
implementation until the plan is approved.
