# Zero-cost discovery operations

RecruitIntel's canonical operating mode spends $0 on search. Official/free ATS endpoints, known
sources, GitHub, university pages, and policy-permitted direct crawling provide the core discovery
loop. General search is optional supplemental coverage.

## Runtime path

```text
Company configuration
  -> existing SourceEndpoint?
       -> yes: monitor source directly
       -> no: careers URL or company-homepage discovery seed
             -> pinned/robots-aware fetch
             -> bounded recruiting-link and ATS fingerprint analysis
             -> durable SourceEndpoint + candidate/schedule
             -> supported collector or normal public-web processing

GitHub repositories and university sources run in their existing independent lanes.
Only an unresolved coverage gap may use a reviewed local/free SearchProvider.
```

The source graph is the existing `sources` table extended by migration 0009. Domain state remains
in its existing ATS, GitHub, public-web, and recruiting-intelligence tables. Source knowledge does
not create a recruiting fact; facts still require normal fetch, extraction, provenance, and
fingerprint processing.

## Required configuration

No search credential is required:

```dotenv
ZERO_COST_MODE=true
PUBLIC_WEB_STATIC_RESULTS_FILE=
SEARXNG_BASE_URL=
```

`ZERO_COST_MODE=true` is the default even when the variable is absent. Leave
`SEARXNG_BASE_URL` empty unless operating and reviewing a local instance. Greenhouse and Lever's
configured public feeds and unauthenticated GitHub use can run without commercial search; an
optional `GITHUB_TOKEN` only increases official GitHub API limits.

## Enabling a direct source

Source governance remains fail-closed:

1. Verify the company domain or provider identity.
2. Review collection method, terms, robots expectations, retention, rate, and allowed use.
3. Record the source policy and, for direct HTTP, an exact host rule.
4. Enable the source and its direct schedule.
5. Run one finite `WEB_FETCH`/ATS worker and inspect safe run/source-health metadata.

Configured careers URLs and homepage seeds are persisted even when their policy is not executable,
but their schedules remain disabled until this review occurs. Recognition of Ashby, Workday,
SmartRecruiters, iCIMS, SuccessFactors, or BambooHR URLs records useful source knowledge only;
collectors and production approval for those providers are later work.

## Optional SearXNG

SearXNG must be operated by the RecruitIntel operator or another explicitly trusted party. Do not
depend on arbitrary public instances. JSON output must be enabled. The RecruitIntel adapter allows
local HTTP for loopback/private/single-label service names and requires HTTPS for remote hosts; it
follows no redirects and uses no ambient proxy.

SearXNG is licensed AGPL-3.0. RecruitIntel consumes only its HTTP API and includes no copied SearXNG
implementation. Network/service deployment and any corresponding license obligations remain part
of the operator's separate deployment review.

### Upstream engines

No SearXNG engine is approved or automatically configured by RecruitIntel.

| Engine class                                 | RecruitIntel default                 | Reason                                                                                     |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Operator-owned search/index service          | `REVIEW_REQUIRED`                    | The operator must document the API, retention, rate, and use policy.                       |
| Official API with a free allowance           | `REVIEW_REQUIRED`                    | Free allowance, credentials, storage rights, and hard-stop behavior are provider-specific. |
| Consumer search-result page engine           | `BLOCKED` unless separately approved | Technical support in SearXNG does not establish permission for automated/metasearch use.   |
| Arbitrary public SearXNG instance/engine set | Unsupported                          | Availability, privacy, engine configuration, and terms cannot be trusted or controlled.    |

For each engine, record whether automated/metasearch access is permitted, whether a key is
required, whether usage is truly free, whether normalized result fields may be retained, and
whether attribution/deletion obligations fit RecruitIntel's provenance model. If no satisfactory
set exists, do not enable SearXNG. Direct source workflows remain functional.

## Budget invariants

Provider descriptors and database budgets both record cost category and zero-cost eligibility:

- `FREE`: estimated and paid spend per call must both be zero.
- `FREE_TIER`: paid spend per call must be zero, and local daily/monthly allowance must end before
  any overage.
- `PAID`: rejected in zero-cost mode.

The database reservation happens before network I/O and is never released after an uncertain
timeout. Daily/monthly rollover uses PostgreSQL UTC time. Provider/credential slots coordinate
concurrent workers. Usage rows contain aggregate counts/costs only—never query text, URLs, result
payloads, credentials, or user data.

## Verification and recovery

Migration 0009 can be validated without changing the development database:

```bash
DATABASE_URL=postgresql://... pnpm --filter @recruitintel/db smoke:migration-0009
```

The smoke creates an isolated database, applies 0001–0008, creates realistic legacy source state,
applies 0009, verifies provenance/backfill and configured-career source knowledge, exercises
concurrent free-provider reservations, proves paid execution is rejected, and drops the database.

Before applying migration 0009 to non-development data, take the normal PostgreSQL backup, stop
scheduler/worker processes, apply the migration and deployment together, verify source/candidate/
schedule counts and all policies, then restart workers with search schedules still disabled. Restore
the backup if source rows, policy linkages, or schedules fail reconciliation.

## Known limitations

- Zero-cost operation has less broad/fresh general-web coverage than a commercial index.
- Only Greenhouse and Lever ATS collectors are implemented today.
- Direct HTML discovery cannot see links rendered only by client-side JavaScript.
- A company with no useful configured domain/page may remain undiscovered until GitHub, university,
  manual, optional local search, or future browser intake supplies a source.
- SearXNG does not provide unrestricted upstream search rights and may be blocked or rate-limited by
  its configured engines.
- No person-name/recruiter-profile general-search templates are enabled.

These limitations reduce discovery breadth, not the correctness or provenance requirements of
facts that RecruitIntel does collect.
