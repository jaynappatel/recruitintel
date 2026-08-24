# Search provider integration: Gate 7.1A and Gate 7.1B

Gate 7.1A provides the provider-neutral contracts, offline You.com adapter, policy linkage,
transactional usage budgets, deterministic failure mapping, and synthetic tests. It does **not**
authorize or activate a live provider. Gate 7.1B is the separate commercial/policy/quality cutover.

## Canonical contract

There is one `SearchProvider` protocol in `public_web/search.py`:

```python
class SearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def search(self, request: SearchRequest) -> SearchBatch: ...
```

`SearchRequest` contains `query`, `max_results`, optional `country_code`, `language`, `freshness`,
and mutually exclusive `include_domains`/`exclude_domains`. Queries, result counts, and domain
lists are bounded and validated before an adapter runs.

`SearchBatch` contains normalized results plus `provider_calls`, `cost_units`,
`estimated_cost_micros`, optional provider quota remaining/reset metadata, and `truncated`.
`SearchResult` contains only canonical URL, bounded title/snippet, rank, `WEB`/`NEWS` kind,
optional publication time, and the allowlisted page-offset/section-rank metadata. Unknown provider
fields are never retained.

The registry is the only provider selection boundary used by public-web domain logic. Static JSON
fixtures and later production providers implement the same protocol; provider response types never
enter candidate, observation, or recruiting-fact logic.

## Offline You.com adapter

`YouSearchProvider` is an adapter-only implementation in Gate 7.1A:

- POSTs only to the fixed `https://api.you.com/v1/search` URL;
- authenticates only with `X-API-Key` and never writes the credential to work, logs, diagnostics,
  database rows, or returned models;
- requests snippets only and omits extraction, highlights, live crawl, research, and full-page
  options;
- disables redirects and ambient proxy configuration (`trust_env=False`);
- bounds streamed response bytes before JSON parsing, validates outer sections, skips malformed
  individual records, canonicalizes/deduplicates URLs, rejects unsafe literal destinations, and
  enforces the requested result maximum;
- reserves one estimated billable call before each outbound attempt and never releases it after a
  timeout or uncertain transport outcome;
- uses the M7 distributed `PROVIDER` limiter for a provider/credential slot; and
- maps quota/rate/auth/permanent/transient failures into the existing durable retry classes.

Automated tests inject `httpx.MockTransport`; they do not contact You.com or any paid API. The
adapter is deliberately absent from `RuntimeWorkHandlers`, so possessing an environment variable
cannot activate it in Gate 7.1A. The admin web-search request schema also accepts only `static`
until Gate 7.1B changes that boundary deliberately.

## Fail-closed policy and source linkage

Migration `0008_search_provider_foundation.sql` adds explicit `static` and `you` source policies.
The You policy is `REVIEW_REQUIRED`, `NOT_REVIEWED`, has no reviewed timestamp/person, and has no
allowed production uses. Its default budget is disabled. Migration-created static policy is also
fail-closed; the development seed alone gives static synthetic fixtures a development-only policy.

Every `public_web_search_queries` row has `provider_policy_id`. Compound foreign keys prove that:

1. the selected provider name identifies that policy; and
2. the orchestration source references that same provider policy.

Unknown legacy provider names are migrated into `REVIEW_REQUIRED` policy records without inventing
terms approval. Enqueue and execution still check the selected provider policy. Changing it to
`BLOCKED` or leaving it review-required prevents queued work from reaching an adapter.

The provider policy governs the search API call. A returned URL is only untrusted candidate
provenance. Candidate source-policy lookup remains separate: unknown destination hosts do not
produce fetch work, and known hosts still pass the M7 source policy, pinned DNS transport,
redirect-by-redirect validation, robots rules, response limits, and normal public-web extraction.
Search results never create recruiting observations/facts directly.

Person-name and recruiter-profile query templates are not present in the production query
generator and must not be added before the provider agreement explicitly permits that use.

## Usage and cost controls

`search_provider_budgets` stores a non-secret provider/credential-slot label, daily request limit,
monthly estimated-cost limit, cost per call, and enabled flag. `search_provider_usage_daily` stores
only UTC daily aggregate reservations. It contains no API key, query, URL, response, user, or result.

`reserve_search_provider_usage` serializes on the budget row, uses PostgreSQL `now()`, verifies the
call-cost calculation, checks the bound `WEB_SEARCH`/`WORKER_GLOBAL` service principal, applies both
limits, and atomically increments the daily bucket before network I/O. Concurrent workers cannot
oversubscribe a limit. A denied daily/monthly reservation becomes durable `RATE_LIMITED` work with a
bounded retry time. Disabled/missing budget is a permanent safe configuration error.

Gate 7.1A creates the proposed You `default` slot at 200 requests/day and USD 30,000,000 micros
($30) estimated monthly cost, but `enabled=false`. The API key is never stored in these tables.

## Retained data boundary

Subject to Gate 7.1B written permission, RecruitIntel is designed to retain only:

- canonical result URL;
- title up to 500 characters;
- combined snippet up to 2,000 characters;
- result rank and WEB/NEWS kind;
- optional publication timestamp;
- allowlisted page offset and section rank; and
- aggregate call/cost/quota/run counters.

It never persists raw search responses, search UUIDs, provider account details, authors, thumbnails,
favicons, response headers, full page content, highlights, HTML, or provider credentials.

## Gate 7.1B prerequisites and activation checklist

Gate 7.1B remains blocked until **all** of the following are complete:

1. Obtain written provider authorization for RecruitIntel's production use.
2. Obtain explicit permission to retain the exact fields listed above.
3. Confirm commercial recruiting-intelligence use is approved.
4. Clarify whether individual/recruiter evidence discovery is permitted; keep those templates
   disabled unless explicitly approved.
5. Record termination, retained-data deletion, and provider-requested deletion obligations.
6. Provision the production API key in the server/worker secret manager as `YDC_API_KEY`; never add
   it to `.env.example` values, database state, WorkItems, or browser configuration.
7. Run the approved manual recruiting-query quality benchmark without committing paid responses.
8. Record a reviewed `you` source policy with reviewer, review time, permitted uses, retention,
   restrictions, rate/cost settings, and policy version.
9. Add the runtime provider factory, read the secret only in the worker composition root, enable the
   reviewed budget, and enable production search schedules only after an operational smoke.

Gate 7.1B must also reconfirm the production API URL/request schema against the then-current official
documentation before activation. A credential alone is never sufficient to bypass policy, budget,
registry, or schedule gates.
