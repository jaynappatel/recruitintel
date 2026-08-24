# Search provider integration and zero-cost discovery

RecruitIntel does not require a paid search API. General web search is a supplemental discovery
mechanism after official/free feeds and durable known sources. Gate 7.1A preserves a provider-neutral
search boundary; Gate 7.1A.1 adds the zero-cost runtime policy, direct-source graph, and optional
operator-controlled SearXNG adapter. No live commercial provider or general-search schedule is
enabled by these gates.

The canonical discovery order is:

```text
KNOWN SOURCE
-> OFFICIAL ATS/API
-> KNOWN COMPANY CAREER/EARLY-CAREER PAGE
-> DIRECT DOMAIN DISCOVERY
-> GITHUB / UNIVERSITY SOURCE
-> LOCAL OR REVIEWED FREE SEARCH PROVIDER
-> OPTIONAL COMMERCIAL PROVIDER
```

Known ATS or company-career coverage short-circuits matching internship/new-grad search queries.
Once a useful source is learned, its own schedule monitors it; RecruitIntel does not repeatedly use
a general index to rediscover it.

## Canonical SearchProvider contract

There is one protocol in `services/collectors/.../public_web/search.py`:

```python
class SearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def search(self, request: SearchRequest) -> SearchBatch: ...
```

`SearchRequest` contains a bounded query and result maximum plus optional country, language,
freshness, include-domain, and exclude-domain fields. `SearchBatch` contains bounded normalized
results plus provider calls, cost units, estimated cost, paid spend, quota/reset metadata, and a
truncation flag. `SearchResult` permits only a canonical URL, bounded title/snippet, rank,
`WEB`/`NEWS` kind, publication time, page offset, and section rank.

Raw provider responses, response headers, credentials, and unknown metadata are never persisted.
A returned URL is untrusted candidate provenance, not a recruiting fact. Any later page retrieval
still requires an executable destination policy and passes through M7 DNS-pinned transport,
redirect revalidation, robots policy, content limits, and normal deterministic processing.

## Durable source graph

Migration `0009_zero_cost_discovery.sql` extends the existing `sources` table as the canonical
`SourceEndpoint`; it does not create a competing source model. Every source retains:

- company, URL/type/provider/external identity;
- discovery method and deterministic fingerprint;
- first-seen and last-verified timestamps;
- confidence and bounded provenance;
- source-policy linkage and enabled state; and
- the source endpoint from which it was discovered, where applicable.

Configured `companies.careers_url` values become durable company-career sources, candidates, and
direct-fetch schedules. If only `companies.website` exists, the homepage becomes one low-frequency
discovery seed. Already-permitted fetched pages are inspected with a bounded deterministic link
parser. It recognizes same-domain recruiting links and ATS URL fingerprints for Greenhouse, Lever,
Ashby, Workday, SmartRecruiters, iCIMS, SuccessFactors, and BambooHR. Only Greenhouse and Lever are
currently collector-supported. Recognition of another ATS creates fail-closed source knowledge; it
does not approve or execute an unsupported collector.

Common-path planning is bounded to `/careers`, `/jobs`, `/early-careers`, `/internships`, and
`/university`. It is not a large brute-force probe. Unknown hosts and review-required providers are
never scheduled automatically. The same source fingerprint and `(provider, external_key)` identity
make rediscovery idempotent. Future browser intake can record `USER_BROWSER` provenance into this
same graph without changing source or collector contracts.

See `docs/zero-cost-discovery.md` for the operational source policy and limitations.

## Zero-cost enforcement

`ZERO_COST_MODE` defaults to `true`. In that mode:

- descriptors marked `PAID` or not zero-cost-eligible are rejected before adapter execution;
- the transactional PostgreSQL reservation independently rejects paid execution;
- actual paid spend requested by an adapter must be zero;
- `FREE_TIER` providers may reserve only within a local request/cost allowance and cannot request a
  paid overage;
- missing commercial credentials do not affect startup; and
- commercial provider schedules and budgets remain disabled.

`search_provider_budgets` records `FREE`, `FREE_TIER`, or `PAID`, zero-cost eligibility, daily and
monthly request limits, monthly estimated-cost limits, a monthly paid-spend limit, and enabled
state. `search_provider_usage_daily` stores only aggregate reservations. PostgreSQL serializes on a
provider/credential-slot budget row before network I/O, so concurrent workers cannot oversubscribe
the local cap. Reservations are not released after timeouts because the upstream may already have
received or billed the request.

This local control is authoritative for RecruitIntel even when a vendor also offers account-side
limits. Zero-cost mode never treats vendor credits as permission to incur a charge.

## Available adapters

### Static

`StaticSearchProvider` remains development/test-only. With
`PUBLIC_WEB_STATIC_RESULTS_FILE=/absolute/path/results.json`, it loads deterministic synthetic
results keyed by exact query text; without that variable it returns no results. It makes no network
calls and needs no credential.

### SearXNG

`SearXNGProvider` is an optional HTTP client for an operator-controlled SearXNG instance. Set
`SEARXNG_BASE_URL` only after local policy review. The adapter calls the instance's `/search`
endpoint using JSON format, sends bounded pagination/language/freshness parameters, follows no
redirects, ignores ambient proxies, bounds response bytes/results, canonicalizes/deduplicates URLs,
and retains only the canonical result contract.

SearXNG's API requires JSON format to be enabled; a disabled format can return `403`. SearXNG is
AGPL-3.0, but RecruitIntel only integrates with a separately operated HTTP service and copies no
SearXNG source. A local deployment still has operational requirements and may use a limiter backed
by Valkey. Refer to the [SearXNG Search API](https://docs.searxng.org/dev/search_api.html),
[container installation](https://docs.searxng.org/admin/installation-docker.html),
[limiter documentation](https://docs.searxng.org/admin/searx.limiter.html), and
[AGPL license](https://github.com/searxng/searxng/blob/master/LICENSE).

SearXNG is metasearch software, not a grant of rights from its upstream engines. RecruitIntel ships
no production engine allowlist and marks the SearXNG policy `REVIEW_REQUIRED`/`NOT_REVIEWED` with a
disabled budget. Public SearXNG instances are unsupported as production infrastructure. Before an
operator enables a local instance, every configured engine must be reviewed for automated access,
credentials, free allowance, retention, attribution, and permitted use. If that review cannot
establish a satisfactory engine set, keep general search disabled; direct discovery continues.

### You.com

`YouSearchProvider` is retained as an isolated, offline-tested optional adapter. It is not
registered in the runtime, its policy remains `REVIEW_REQUIRED`, its budget is disabled, and it is
not zero-cost-eligible. `YDC_API_KEY` is not a RecruitIntel runtime setting and is not required to
start or operate the product. Automated tests inject synthetic `httpx.MockTransport` responses and
make no live or paid calls.

### Brave Search

No Brave adapter is implemented in Gate 7.1A.1. Brave currently advertises monthly credits but
also requires a payment method for API plans, and storage rights depend on the selected plan. That
does not satisfy the default no-paid-dependency path. A future optional `FREE_TIER` adapter is
possible only if then-current terms permit the retained fields and the local budget can hard-stop
before any paid request. See the [official API page](https://brave.com/search/api/) and
[official API terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service).

## Source-policy boundary

Search-query sources reference the selected provider's policy through compound foreign keys.
Unknown providers default to `REVIEW_REQUIRED`; `REVIEW_REQUIRED` and `BLOCKED` cannot be enqueued
or executed. Policy is checked at enqueue and immediately before execution. The policy for the
search API is separate from the destination host policy for a returned URL.

Person-name and recruiter-profile search templates remain absent from production configuration.
No provider adapter or self-hosted engine changes that restriction.

## Environment configuration

```dotenv
# Canonical default. No paid provider can run.
ZERO_COST_MODE=true

# Optional operator-controlled SearXNG service; omit for the normal direct-source path.
SEARXNG_BASE_URL=

# Optional deterministic local/test fixtures.
PUBLIC_WEB_STATIC_RESULTS_FILE=
```

No commercial search API key is required. A configured SearXNG URL alone is not sufficient: its
source policy and zero-cost budget must also be explicitly reviewed and enabled, and its upstream
engine set remains the operator's responsibility.

## Optional commercial-provider activation (Gate 7.1B)

Gate 7.1B is optional and is not a prerequisite for Milestone 8 or normal $0 operation. A specific
commercial provider must remain disabled until all of these are complete:

1. written provider authorization for RecruitIntel's use;
2. explicit permission to retain the canonical result fields;
3. commercial/recruiting-intelligence use approval;
4. clarification of individual/recruiter evidence use;
5. documented termination and deletion obligations;
6. a production credential stored only in the worker secret manager;
7. an offline/manual recruiting-query quality benchmark;
8. a reviewed source-policy record with allowed uses, restrictions, rates, retention, reviewer,
   date, and version;
9. a zero-cost classification decision (`FREE_TIER` only when local hard-stop is possible) and
   approved transactional budget; and
10. explicit production registry and schedule activation.

A credential alone never bypasses registry, policy, budget, or schedule gates.
