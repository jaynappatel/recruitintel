# Recruiter and campus recruiting intelligence

Milestone 4 adds a provenance-first person, recruiter, school, role-focus, and campus-event graph. It consumes Milestone 3 `public_recruiting_observations`; it does not introduce another crawler, queue, or source of truth. Deterministic rules create only explicit entities and relationships. Ambiguous references remain unresolved, and weak evidence remains visibly weak.

Calendar synchronization, alerts, application tracking, activity scoring, predictive ML, authenticated LinkedIn access, browser automation, and mandatory LLM extraction are not part of this milestone.

## Architecture

```text
SearchProvider -> WEB_SEARCH -> candidate
candidate -> WEB_FETCH -> immutable normalized document
document -> WEB_PROCESS -> public recruiting observation
                            |
                            v
                  deterministic recruiter/campus processor
                            |
          +-----------------+-------------------+
          |                 |                   |
       Person -> RecruiterProfile         CampusRecruitingEvent
                    |                             |
          immutable RecruiterEvidence      observation evidence
             /              \
    school relationship    role focus
```

`WEB_PROCESS` calls the downstream processor after Milestone 3 commits the normalized observations. Existing observations can be processed without another fetch:

```bash
uv run recruitintel-collectors recruiter-campus-process \
  --observation-id PUBLIC_RECRUITING_OBSERVATION_UUID
```

The command is finite and idempotent. No `RECRUITER_PROCESS` or `CAMPUS_PROCESS` queue was added because PostgreSQL's existing `WEB_PROCESS` lifecycle already owns the relevant document transition.

## Data model

Migration `0004_recruiter_campus_intelligence.sql` adds:

- `people`: canonical and normalized names plus optional first/last names;
- `recruiter_profiles`: a person/company role projection, public profile reference, confidence, evidence recency, categories, and status;
- `recruiter_evidence`: immutable source evidence with an optional Milestone 3 observation, school, and role-family link;
- `recruiter_school_relationships` and `recruiter_school_evidence`: derived school relevance and its complete evidence set;
- `recruiter_role_focus` and `recruiter_role_evidence`: derived role-family relevance and its complete evidence set;
- `school_aliases`: unique normalized reviewed aliases; `schools` also gains city, state/region, and country;
- `campus_recruiting_events` and `campus_recruiting_event_evidence`: current event projections plus every independent public observation;
- `campus_event_recruiters`: explicit recruiter/event evidence links;
- `unresolved_recruiter_observations`: unknown or ambiguous people, schools, companies, and insufficient evidence;
- optional recruiter, school, and campus-event links on `recruiting_events`.

Evidence rows are append-only in application code. Current profile/relationship/event rows are query projections and may be updated when stronger or newer evidence arrives.

## Person and recruiter identity

Person names use Unicode NFKC, case folding, punctuation-to-space normalization, and collapsed whitespace. A profile is resolved only by:

1. an exact normalized public profile URL, with a unique existing person;
2. an exact normalized person name within the same company; or
3. creation of a new person/profile.

Similar-looking names are not fuzzy-merged. More than one exact candidate is `AMBIGUOUS_PERSON` and remains unresolved. A retry of the same evidence reuses the profile and evidence fingerprint. A verified public profile URL can reuse one person across multiple company profiles, but a name alone cannot merge identities across companies.

`RecruiterProfile.status` is `ACTIVE | UNVERIFIED | STALE | INACTIVE`. Deterministic web processing sets `ACTIVE` only when recent official/high-reliability evidence explicitly names the configured company. Manual creation defaults to `UNVERIFIED`. API projections override a stored `ACTIVE` status with `STALE` once its verification age exceeds 180 days; stale records are retained.

## Recruiter role classification

Title rules are pure, ordered regular expressions and can return more than one specific category:

`UNIVERSITY_RECRUITING`, `EARLY_CAREER`, `TECHNICAL_RECRUITING`, `TALENT_ACQUISITION`, `CAMPUS_PROGRAMS`, `UNIVERSITY_PROGRAMS`, `EMERGING_TALENT`, `GENERAL_RECRUITING`, or `OTHER`.

Specific matches suppress the generic recruiter match. For example, `Early Talent Technical Recruiter` becomes `EARLY_CAREER` plus `TECHNICAL_RECRUITING`. Obvious titles never require an LLM.

Role-focus extraction reuses the existing role-family vocabulary: `SOFTWARE_ENGINEERING`, `AI_ML`, `DATA_SCIENCE`, `DATA_ENGINEERING`, `PRODUCT`, `DESIGN`, `SECURITY`, `CLOUD_DEVOPS`, `QUANT`, `HARDWARE`, and `OTHER`.

## School resolution

School resolution is exact and alias-driven. `UT Austin`, `University of Texas at Austin`, and `The University of Texas at Austin` resolve together only when reviewed aliases point to the same school. Alias normalization removes a leading/standalone `the`, normalizes `&` to `and`, folds case/punctuation, and collapses whitespace.

Unknown schools produce `UNKNOWN_SCHOOL`; collisions produce `AMBIGUOUS_SCHOOL`. Neither is silently dropped or guessed. One casual mention can create evidence but receives only the relationship strength justified by that evidence.

## Evidence and relationship strength

Each recruiter claim has source, URL, bounded evidence text, observed/published time, SHA-256 content hash and fingerprint, reliability class, confidence, optional public observation, metadata, and optional school/role target. Evidence types are:

`EMPLOYMENT`, `UNIVERSITY_RECRUITING`, `SCHOOL_CONNECTION`, `ROLE_FOCUS`, `CAMPUS_EVENT`, `RECRUITING_ANNOUNCEMENT`, `PUBLIC_PROFILE`, and `OTHER`.

Relationship strength is categorical: `HIGH | MEDIUM | LOW | LIMITED_EVIDENCE`. The deterministic calculation uses:

- official/high/medium source reliability;
- one, two, or at least three independent source IDs;
- an explicit relationship mention;
- a matching recruiting title;
- verification within 90 days.

The API exposes the rule reasons, such as `two_independent_sources`, `explicit_relationship_mention`, and `verified_within_90_days`. It does not expose a fabricated percentage. Confidence remains source/extraction ranking metadata and is not a probability that employment is true.

Conflicting title evidence is preserved. A higher-confidence observation can update the current title projection, while categories are unioned and every immutable evidence row remains queryable.

## Freshness

API freshness is calculated from the relevant last verification/observation time:

- `CURRENT`: 0–90 days;
- `AGING`: 91–180 days;
- `STALE`: more than 180 days;
- `UNKNOWN`: no timestamp.

Every freshness object contains `status`, `ageDays`, and `lastVerifiedAt`. Stale filtering is optional and defaults to including stale data so historical evidence is not hidden.

## Campus events

Event types are `CAREER_FAIR`, `INFO_SESSION`, `COMPANY_VISIT`, `TECH_TALK`, `COFFEE_CHAT`, `HACKATHON`, `RECRUITING_EVENT`, `INTERVIEW_EVENT`, and `OTHER`.

The event projection preserves company, optional school, date/time fields, date precision/certainty, location/virtual state, registration URL, source, confidence, and metadata. Identity is a versioned hash of company, type, optional school, date key, and normalized title. Independent observations attach through `campus_recruiting_event_evidence`; a retry does not duplicate the event. Ambiguous dates remain date-only/month/approximate/unknown values inherited from Milestone 3 rather than invented timestamps.

## Public-web and LinkedIn policy

The extractor reads recruiter names/titles from JSON-LD `Person` metadata or conservative named-person/title text patterns. It also uses reviewed school aliases, explicit role terms, event keywords, and dates already normalized by Milestone 3. It never re-fetches an observation's page.

Public search results may retain a LinkedIn profile URL as a source reference. `SafePublicWebFetcher` rejects `linkedin.com` and all subdomains before DNS/HTTP and applies the same rule to redirects. RecruitIntel does not use authenticated scraping, cookies, browser automation, CAPTCHA handling, anti-bot evasion, or restricted page content. A manually submitted LinkedIn URL is stored as a URL only and is not fetched.

The configured search provider remains Milestone 3's `SearchProvider`. Local/default operation uses `static`; set `PUBLIC_WEB_STATIC_RESULTS_FILE` to an absolute JSON fixture path. A production search API adapter must be terms-reviewed and registered by name; no live provider credential is required or bundled by Milestone 4.

## Recruiting events

New evidence can emit:

- `RECRUITER_DISCOVERED` for a new recruiter profile;
- `RECRUITER_ACTIVITY` for new non-school evidence on an existing recruiter;
- `SCHOOL_RECRUITING_SIGNAL` for new recruiter/school evidence;
- `CAMPUS_EVENT_DISCOVERED` for a new campus event.

Fingerprints include company, source, event type, and causal evidence/profile/event key. Retries are no-ops.

## Stable APIs

All success responses use `{ "data": ..., "meta"?: ... }`. Errors use `{ "error": { "code", "message" } }`. List queries accept `limit=1..100` and `offset=0..10000`. Company/school identifiers are a UUID or canonical slug; recruiter IDs are UUIDs.

### Recruiters

`GET /api/companies/:identifier/recruiters`

Optional query: `category`, `roleFamily`, `school`, `includeStale=true|false`, `limit`, `offset`. Returns recruiter summaries plus pagination metadata.

`GET /api/recruiters/:id`

Returns a recruiter detail including all evidence.

`GET /api/recruiters/:id/evidence`

Returns immutable evidence rows plus pagination metadata.

Recruiter summary/detail fields are:

```json
{
  "id": "uuid",
  "personId": "uuid",
  "name": "Jane Smith",
  "company": { "id": "uuid", "name": "Stripe", "slug": "stripe" },
  "title": "University Recruiter",
  "categories": ["UNIVERSITY_RECRUITING"],
  "location": null,
  "publicProfileUrl": null,
  "status": "UNVERIFIED",
  "confidence": 0.9,
  "firstSeenAt": "RFC3339",
  "lastSeenAt": "RFC3339",
  "lastVerifiedAt": "RFC3339",
  "freshness": { "status": "CURRENT", "ageDays": 0, "lastVerifiedAt": "RFC3339" },
  "schoolFocus": [
    {
      "school": "SchoolSummary",
      "strength": "HIGH",
      "reasons": ["two_independent_sources", "explicit_relationship_mention"],
      "evidenceCount": 2,
      "confidence": 0.9,
      "status": "ACTIVE",
      "firstObservedAt": "RFC3339",
      "lastObservedAt": "RFC3339",
      "freshness": "Freshness"
    }
  ],
  "roleFocus": [
    {
      "roleFamily": "SOFTWARE_ENGINEERING",
      "strength": "MEDIUM",
      "reasons": ["single_source", "explicit_relationship_mention"],
      "evidenceCount": 1,
      "confidence": 0.8,
      "firstObservedAt": "RFC3339",
      "lastObservedAt": "RFC3339",
      "freshness": "Freshness"
    }
  ],
  "evidence": ["RecruiterEvidence; detail endpoint only"]
}
```

An evidence row exposes `id`, `recruiterProfileId`, `source { id, name, type, reliabilityScore }`, nullable `recruitingObservationId`, `sourceUrl`, `evidenceType`, `evidenceText`, `observedAt`, nullable `publishedAt`, `contentHash`, `fingerprint`, `reliability`, `confidence`, nullable `school`, nullable `roleFamily`, and `metadata`.

### Campus events

`GET /api/companies/:identifier/campus-events`

`GET /api/schools/:identifier/events`

Optional query: `eventType`, `includePast=true|false`, `limit`, `offset`. Each event exposes all fields described in Campus events plus company/school/source summaries, freshness, fingerprint, and `evidenceCount`.

### Schools

`GET /api/schools` — optional `query`, `limit`, and `offset`.

`GET /api/schools/:identifier` — returns a `SchoolSummary` with `id`, `canonicalName`, `slug`, aliases, primary domain, location fields, and timestamps.

`GET /api/schools/:identifier/companies` — returns `{ company, recruiterCount, campusEventCount, lastObservedAt }[]`.

`GET /api/schools/:identifier/recruiters` — returns recruiter summaries focused on that school; supports `includeStale`, `limit`, and `offset`.

### Admin writes

Both routes require an authenticated admin session or an active hashed service token with the
`ADMIN_MUTATE` scope. They store a `MANUAL` source and never fetch the submitted URL.

`POST /api/companies/:identifier/recruiters` requires:

```json
{
  "name": "Jane Smith",
  "title": "University Recruiter",
  "sourceUrl": "https://example.edu/events/company",
  "evidenceText": "Jane Smith is the listed recruiter contact."
}
```

Optional fields: `location`, `publicProfileUrl`, RFC3339 `observedAt`, `confidence` (default `0.5`), `reliability` (default `UNKNOWN`), `schoolIdentifiers`, `roleFamilies`, and `metadata`. Returns HTTP 201 recruiter detail. Unknown schools become unresolved records.

`POST /api/recruiters/:id/evidence` requires `sourceUrl`, `evidenceType`, and `evidenceText`. Optional fields are `observedAt`, `publishedAt`, `reliability`, `confidence`, `schoolIdentifier`, `roleFamily`, and `metadata`. Returns HTTP 201 recruiter detail. The evidence fingerprint makes a retried identical body idempotent.

## Unresolved records

Reasons are `UNKNOWN_PERSON`, `AMBIGUOUS_PERSON`, `UNKNOWN_SCHOOL`, `AMBIGUOUS_SCHOOL`, `AMBIGUOUS_COMPANY`, `INSUFFICIENT_EVIDENCE`, and `UNSUPPORTED_FORMAT`. Status is `PENDING | RESOLVED | IGNORED`. Each row retains raw names/title, source/evidence, content hash, observation link when available, and a unique fingerprint. There is no fuzzy or silent auto-resolution.

## Future LLM extraction

`RecruiterCampusLLMExtractor` is an interface only and is disabled by default. A future opt-in adapter may receive bounded normalized observation text, must validate structured output, cache by content hash/model/prompt version, treat source text as hostile data, and preserve deterministic fallback and provenance. No current worker or API needs an LLM.

## Troubleshooting

- No recruiter was created: the deterministic extractor requires a structured `Person` with title or an explicit multi-token name adjacent to a recognized recruiter title. Inspect `unresolved_recruiter_observations`.
- School did not link: add a reviewed `school_aliases.normalized_alias`; do not use fuzzy matching.
- Strength seems low: inspect `reasons`, evidence source IDs, reliability, title match, and observation age. Repeated evidence from one source is not independent support.
- Profile says stale: inspect `lastVerifiedAt` and evidence; stale data is deliberately retained.
- A retry created no event: evidence/event fingerprints intentionally make identical work a no-op.
- LinkedIn candidate is blocked: retain the public URL or add permitted independent evidence; do not bypass `RestrictedSiteError`.
- No general-search results: direct ATS/company/GitHub/university discovery remains the canonical
  zero-cost path. `static` is intentionally inert unless `PUBLIC_WEB_STATIC_RESULTS_FILE` is set;
  an optional operator-controlled SearXNG provider still requires source/engine review.
- Worker processed the web observation but no graph rows: ensure CLI composition includes `PostgresRecruiterCampusRepository`, then rerun `recruiter-campus-process` for that observation.

## Deferred scope

No calendar backend or Google Calendar sync, alerts, watchlists, application tracking, activity-score ML, predictive ML, authenticated social scraping, or frontend redesign was implemented. Those remain later milestones.
