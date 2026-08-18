# Public web recruiting intelligence

Milestone 3 adds a bounded, provider-independent pipeline for permitted public recruiting pages. It discovers candidate URLs, fetches public HTML safely, extracts normalized text, classifies relevance and reliability with deterministic rules, preserves independent evidence, aggregates compatible claims, and emits immutable recruiting events. It does not scrape authenticated sites, run browser automation, call an LLM, or create a second job database.

## Architecture

```text
Company -> query templates -> SearchProvider -> candidate URLs
        -> durable WEB_SEARCH requests

candidate -> WEB_FETCH -> safe HTML fetch -> normalized document + content hash
          -> unchanged: update liveness and stop
          -> changed/new: durable WEB_PROCESS request

document -> source/reliability rules -> relevance rules -> date/information extraction
         -> source observation -> lightweight claim -> RecruitingEvent
```

PostgreSQL is the coordination boundary. Each CLI invocation claims and completes one durable request, so cron, GitHub Actions, Supabase scheduling, or a later queue can invoke the same finite worker. External HTTP, pure extraction, and persistence remain separate interfaces.

## Data model

Migration `0003_public_web_intelligence.sql` adds:

- `schools`: canonical school names, reviewed aliases, and domains used only for deterministic evidence links;
- `public_web_search_queries`: provider-neutral query configuration, budget, status, and next permitted run;
- `public_web_candidates`: one canonical URL per company plus discovery/fetch/relevance state;
- `public_web_candidate_discoveries`: many-to-many query/result provenance with result rank;
- `public_web_documents`: immutable normalized text snapshots keyed by candidate and content hash; raw HTML is not retained;
- `public_recruiting_observations`: source-specific structured evidence with dates, reliability, confidence, entity links, and a unique fingerprint;
- `public_recruiting_claims` and `public_recruiting_claim_observations`: lightweight aggregates that retain all independent sources and expose conflicts;
- `public_web_work_requests` and `public_web_runs`: durable work state and run metrics;
- optional public-web candidate/observation links on `recruiting_events`.

Candidate identity is `(company_id, canonical_url)`. Document identity is `(candidate_id, content_hash)`. Observation and event fingerprints are unique SHA-256 values. Retrying a completed content version cannot duplicate its evidence or events.

## Search provider and query templates

`SearchProvider` exposes only:

```python
name: str
async search(query: str, *, max_results: int) -> Sequence[SearchResult]
```

Business logic never reads provider-specific response shapes. Milestone 3 registers the `static` provider:

- with `PUBLIC_WEB_STATIC_RESULTS_FILE=/absolute/path/results.json`, it loads deterministic results from a JSON object keyed by exact query text;
- without the variable, it remains a valid inert provider that returns no results;
- it needs no network credential and is suitable for local operation, tests, and provider development.

The JSON shape is:

```json
{
  "\"Stripe\" internship 2027": [
    {
      "url": "https://stripe.com/jobs/university/internships",
      "title": "University internships",
      "snippet": "Applications open September 1, 2026.",
      "rank": 1,
      "metadata": {}
    }
  ]
}
```

Generated queries cover early career, university/campus recruiting, application deadlines, interview experiences, role focus, internship/new-grad focus, optional school and graduation year, and bounded `site:reddit.com`/`site:github.com` references. Search parameters configure `minimumIntervalSeconds` (60–2,592,000), `maxResults` (1–100), and `maxFetches` (0–`maxResults`). The API skips queries whose `nextAllowedRunAt` is still in the future.

To add a live provider:

1. Implement `SearchProvider` under `public_web` and map its response to `SearchResult`.
2. Keep credentials, pagination, quota/rate handling, and provider errors inside the adapter.
3. Register the provider by name in the CLI composition root.
4. Add offline fixtures for empty, duplicate, malformed, paginated, and rate-limited responses.
5. Verify the provider's API terms before enabling it. Do not scrape search-result HTML.

## URL normalization and safe fetching

Canonicalization lowercases/IDNA-normalizes hosts, removes fragments and default ports, normalizes paths, sorts retained query parameters, and removes known tracking keys including `utm_*`, `gclid`, and `fbclid`. It retains non-tracking query parameters because they may identify different content.

`SafePublicWebFetcher`:

- permits HTTP/HTTPS only and rejects credentials, malformed ports, localhost, private, loopback, link-local, multicast, reserved, and otherwise non-global destinations;
- resolves every requested URL and every redirect target before fetching;
- uses manual redirects with a configured maximum;
- checks cached `robots.txt` policy and treats `401`/`403` robots responses as disallow-all;
- uses explicit timeouts, bounded retries/backoff, a per-host rate limiter, and an identifying user agent;
- accepts HTML/XHTML only and enforces both declared and streamed response-size limits;
- retains only safe response headers and normalized extracted data, never raw HTML;
- does not execute JavaScript, solve CAPTCHAs, rotate browser identities, or bypass access controls.
- rejects LinkedIn hosts and LinkedIn redirect targets before HTTP; public search-result/profile URLs may remain stored references.

Operators remain responsible for source terms and permission. A successful technical fetch is not itself authorization to collect a site.

## Extraction, hashes, and change detection

The HTML extractor reads title, meta description, canonical URL, headings, deterministic published-time metadata, JSON-LD objects, and main/article text. Script, style, navigation, footer, form, template, and common cookie/consent boilerplate are excluded. JSON-LD is parsed as data and is never evaluated.

The normalized content hash covers stable extracted content rather than raw HTML. Cosmetic whitespace and footer-year changes therefore do not create a new document version. A matching candidate hash updates `last_fetched_at` and stops. A new hash creates an immutable document and queues `WEB_PROCESS`.

Additional extractors should implement `ContentExtractor`, accept a bounded `FetchedDocument`, return validated `ExtractedDocument`, and receive pure fixture tests. They must not execute embedded code or weaken the fetcher's content boundary.

## Source classification and relevance

Source classification uses the URL and reviewed company/school configuration, never a company-name mention alone:

- reviewed company careers URLs/domains -> `COMPANY_CAREERS`, `COMPANY_BLOG`, or `COMPANY_PUBLIC_PAGE`, reliability `OFFICIAL`/`HIGH`;
- `.edu` career pages -> `UNIVERSITY`, reliability `HIGH`;
- GitHub -> `GITHUB`, reliability `MEDIUM`;
- known public forums such as Reddit -> `FORUM`, reliability `LOW`;
- other pages -> `PUBLIC_WEB`/`OTHER`, reliability `UNKNOWN` or rule-derived.

Reliability is ranking metadata, not truth. Deterministic relevance weighs recruiting terms such as internship, new grad, university/campus recruiting, career fair, application/deadline, interview, recruiter, hiring, students, and supported role-family signals. It returns `RELEVANT`, `POSSIBLY_RELEVANT`, or `NOT_RELEVANT` with transparent signals and reasons.

## Observations, dates, claims, and events

Observation types are:

`INTERNSHIP_OPENING_SIGNAL`, `NEW_GRAD_OPENING_SIGNAL`, `APPLICATION_DATE`, `APPLICATION_DEADLINE`, `CAREER_FAIR`, `CAMPUS_VISIT`, `EARLY_CAREER_PROGRAM`, `INTERVIEW_EXPERIENCE`, `RECRUITING_ANNOUNCEMENT`, `ROLE_FAMILY_SIGNAL`, `SCHOOL_RECRUITING_SIGNAL`, and `GENERAL_RECRUITING_SIGNAL`.

Dates preserve precision (`EXACT`, `RANGE`, `MONTH`, `APPROXIMATE`, `UNKNOWN`) and certainty (`CONFIRMED`, `ESTIMATED`, `HISTORICAL`, `CLAIMED`). Ambiguous phrases are not converted into invented exact dates. Company-owned pages may produce confirmed dates; historical/forum wording remains historical or claimed.

Each observation retains company, source, candidate, immutable document, optional job/school link, normalized evidence, source URL/classification/reliability, date fields, content hash, confidence, metadata, discovery/verification timestamps, and fingerprint. A canonical page URL is linked to an existing job only when it resolves to exactly one job for that company; public-web processing never creates jobs.

Claims group observations by company, observation type, and normalized subject. One source is `SINGLE_SOURCE`; multiple agreeing sources are `SUPPORTED`; multiple distinct dates are `CONFLICTING`. All observations remain queryable and the aggregate records source/date counts instead of silently selecting a winner.

New evidence emits the applicable existing event type: `RECRUITING_ARTICLE_DISCOVERED`, `APPLICATION_DATE_SIGNAL`, `CAMPUS_EVENT_DISCOVERED`, `INTERVIEW_REPORT_DISCOVERED`, or `HIRING_SIGNAL`. A materially changed relevant company careers document may emit `CAREER_PAGE_CHANGED`. Unique event fingerprints prevent retry duplicates.

## Worker operation

Queue searches with the admin API, then run each returned request:

```bash
uv run recruitintel-collectors public-web-work --request-id REQUEST_UUID
```

The three work types are:

- `WEB_SEARCH`: run one configured query, canonicalize/deduplicate results, and enqueue at most `maxFetches` candidates;
- `WEB_FETCH`: validate/fetch/extract/hash one candidate and enqueue processing only for new content;
- `WEB_PROCESS`: classify the current immutable document and transactionally persist observations, claims, links, and events.

After a successful `WEB_PROCESS`, Milestone 4 consumes the just-created observations through the recruiter/campus processor. Existing observation IDs can be replayed with `recruiter-campus-process` without fetching their pages again. See `docs/recruiter-campus-intelligence.md`.

Runs record start/end/status, company, provider/query where applicable, candidates, fetched/relevant counts, observations/events created, duration, and errors. Work claims increment attempt count atomically. Retryable failures return to `PENDING` with bounded exponential delay until `maxAttempts`; SSRF/robots denials become blocked/terminal. A PostgreSQL one-running-run-per-source constraint prevents concurrent processing of the same source.

## Stable frontend API contracts

All success responses use `{ "data": ..., "meta"?: ... }`. Errors use `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Company identifiers accept a canonical slug or UUID. UUID path parameters are validated. Mutation routes require `Authorization: Bearer $RECRUITINTEL_ADMIN_TOKEN` and return `503 ADMIN_TOKEN_NOT_CONFIGURED` when the server token is absent.

### `GET /api/companies/:identifier/web-intelligence`

Returns:

```json
{
  "data": {
    "companyId": "uuid",
    "candidateCounts": { "total": 2, "pending": 0, "relevant": 2, "blocked": 0 },
    "observationCount": 5,
    "claimCounts": { "total": 4, "conflicting": 1 },
    "latestObservations": ["PublicRecruitingObservation"],
    "latestClaims": ["PublicRecruitingClaim"]
  }
}
```

### `GET /api/companies/:identifier/recruiting-observations`

Query: `limit=1..100`, `offset=0..10000`, optional `type=<observation type>`. Returns `{ data: PublicRecruitingObservation[], meta: { total, limit, offset } }`.

`PublicRecruitingObservation` is:

```json
{
  "id": "uuid",
  "companyId": "uuid",
  "type": "APPLICATION_DATE",
  "title": "Applications open September 1",
  "summary": "Normalized summary",
  "evidenceText": "Bounded normalized evidence",
  "occurredAt": null,
  "dateStart": "2026-09-01",
  "dateEnd": null,
  "datePrecision": "EXACT",
  "dateCertainty": "CONFIRMED",
  "confidence": 0.95,
  "contentHash": "64 lowercase hex characters",
  "discoveredAt": "RFC3339 timestamp",
  "lastVerifiedAt": "RFC3339 timestamp",
  "linkedJobId": null,
  "linkedSchool": { "id": "uuid", "name": "School", "slug": "school" },
  "source": {
    "id": "uuid",
    "name": "Source name",
    "type": "PUBLIC_WEB",
    "classification": "COMPANY_CAREERS",
    "reliability": "OFFICIAL",
    "reliabilityScore": 0.95,
    "url": "https://example.com/page",
    "candidateId": "uuid",
    "canonicalUrl": "https://example.com/page",
    "provider": "static"
  },
  "metadata": {}
}
```

`linkedSchool` is nullable.

### `GET /api/recruiting-observations/:id`

Returns `{ data: PublicRecruitingObservation }`; `400` for a malformed UUID and `404` when absent.

### `GET /api/companies/:identifier/recruiting-claims`

Query: `limit=1..100`, `offset=0..10000`. Returns `{ data: PublicRecruitingClaim[], meta: { total, limit, offset } }`.

`PublicRecruitingClaim` contains `id`, `companyId`, `type`, `title`, `normalizedSubject`, `status` (`SINGLE_SOURCE | SUPPORTED | CONFLICTING`), nullable `preferredObservationId`, `lastVerifiedAt`, `confidence`, `supportingSourceCount`, complete `observations`, and `metadata`.

### `GET /api/companies/:identifier/search-queries`

Returns `{ data: WebSearchQuery[], meta: { total } }`. Each query includes `id`, `companyId`, `provider`, `templateKey`, `query`, nullable `roleFamily`/`school`/`graduationYear`/`focus`, `budget`, `status`, `lastRunAt`, `lastSuccessAt`, `lastResultCount`, `nextAllowedRunAt`, and `metadata`.

### `POST /api/companies/:identifier/web-search`

Admin-authenticated. Body:

```json
{
  "provider": "static",
  "roleFamily": "SOFTWARE_ENGINEERING",
  "school": "UT Austin",
  "graduationYear": 2027,
  "focus": "BOTH",
  "minimumIntervalSeconds": 86400,
  "maxResults": 10,
  "maxFetches": 5
}
```

All fields have defaults except optional role/school/year. Returns HTTP `202`:

```json
{
  "data": {
    "requests": [
      {
        "id": "uuid",
        "workType": "WEB_SEARCH",
        "status": "PENDING",
        "companyId": "uuid",
        "searchQueryId": "uuid",
        "candidateId": null,
        "requestedAt": "RFC3339 timestamp"
      }
    ],
    "queriesGenerated": 10,
    "skippedByBudget": 0
  }
}
```

### `POST /api/web/candidates/:id/fetch`

Admin-authenticated. Returns HTTP `202 { data: PublicWebWorkRequest }`, `400` for a malformed UUID, or `404` when the candidate is absent. An already active fetch request is returned idempotently.

## Future LLM boundary

`LLMRecruitingExtractor` is an interface only and is disabled. A future opt-in implementation may receive bounded normalized relevant text—not raw HTML—must key/cache results by content hash, require validated structured output, treat all page text as hostile data rather than instructions, and preserve the deterministic pipeline as the fallback. No Milestone 3 operation requires an LLM.

## Troubleshooting

- `search provider 'x' is not configured`: use `provider: "static"` or register a reviewed adapter in the CLI.
- Static searches return zero candidates: set `PUBLIC_WEB_STATIC_RESULTS_FILE` and ensure its keys exactly match the generated query strings shown by the search-query API.
- `UnsafeUrlError`: the URL is malformed, contains credentials, or resolves to a non-public address.
- `RobotsDeniedError`: the candidate remains blocked; do not bypass the policy.
- `RestrictedSiteError`: LinkedIn or another explicitly restricted target remains a URL reference and is never fetched.
- `ResponseTooLargeError`/unsupported content: raise limits only after reviewing the source; V1 accepts public HTML/XHTML only.
- Search requests are skipped: inspect `nextAllowedRunAt` and the configured minimum interval.
- Work returns to `PENDING`: inspect `collector_errors`, `attemptCount`, `nextAttemptAt`, and the related `public_web_runs` row.
- No new event on a re-fetch: unchanged normalized content and already-fingerprinted evidence are intentional no-ops.

## Deferred scope

Milestone 3 itself does not add recruiter/person graph modeling. Milestone 4 layers that graph on these immutable observations without changing public-web candidate or document identity. Calendar backend, watchlists, alerts, application tracking, activity scoring, authenticated LinkedIn collection, live commercial search credentials, browser/JavaScript rendering, LLM extraction, embeddings, and ML remain deferred.
