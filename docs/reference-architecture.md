# RecruitIntel reference architecture review

Reviewed locally on 2026-08-17. The RecruitIntel workspace was empty at review time, so the recommendation is to create a new monorepo here rather than modify an unrelated project.

This review is architectural, not a code-import plan. No reference code or datasets are copied into RecruitIntel.

## Reference inventory

| Project                                  | Local path                                                                               | Purpose                                                              | License visible locally                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| FreeHire                                 | `/Users/jaynapatel/Desktop/github repos/freehire-main`                                   | Large first-party job catalogue spanning many ATS providers          | MIT                                                |
| Job Board Aggregator                     | `/Users/jaynapatel/Desktop/github repos/job-board-aggregator-main`                       | Multi-ATS scraper, static job UI, trend tracking, and anomaly checks | Code: MIT. Curated company datasets: CC BY-NC 4.0. |
| Simplify Summer 2027 Internships         | `/Users/jaynapatel/Desktop/github repos/Summer2027-Internships-dev`                      | Curated internship listings and deterministic README generation      | No license file or grant found                     |
| Simplify New Grad Positions              | `/Users/jaynapatel/Desktop/github repos/New-Grad-Positions-dev`                          | Curated new-graduate listings and generated README tables            | No license file or grant found                     |
| LeetCode Companywise Interview Questions | `/Users/jaynapatel/Desktop/github repos/leetcode-companywise-interview-questions-master` | Company/recency-partitioned snapshots of question metadata           | No license file or grant found                     |

## FreeHire

### Purpose and architecture

FreeHire is the most relevant system-level reference. It is a Go/PostgreSQL application with a SvelteKit frontend and many run-once workers. Provider-specific board configuration is data (YAML), while each ATS implementation is an adapter registered behind a shared `Source` interface. One provider file is processed per worker run, allowing independent schedules and failure isolation.

Its ingest path is effectively:

```text
provider board configuration
  -> provider adapter
  -> normalized job
  -> deterministic derived fields and fingerprints
  -> idempotent PostgreSQL upsert
  -> transactional downstream work records
```

Notable implementation details found in the source:

- `jobs` has a database uniqueness constraint on `(source, external_id)`.
- A content hash distinguishes a changed posting from an unchanged re-fetch.
- Unchanged jobs take a cheap path that refreshes `last_seen_at` without reindexing.
- Closing is soft (`closed_at`) and a reappearing posting can reopen.
- Provider boards run with bounded concurrency, and a single board failure is isolated.
- Board health and cooldown state is persisted instead of held in worker memory.
- Run-once workers make cron/GitHub Actions viable without a queue daemon.
- Provider adapters use public, read-only ATS endpoints and normalize to one shape.
- Full-catalogue pagination failure is treated carefully because partial results must not close the missing tail.
- HTML is sanitized before persistence and deterministic derivation is centralized.
- PostgreSQL-backed outboxes separate ingestion from expensive downstream work.

### Ideas worth adapting

- Provider registry plus small, independently tested adapters.
- Configuration as data: company/provider/board identifiers should not be embedded in adapter code.
- A single normalized job contract and centralized derivation/fingerprinting.
- Database-enforced provider identity uniqueness.
- Run-once workers with persisted run/error records.
- Cheap unchanged writes and event generation only for meaningful transitions.
- Soft close and reopen semantics.
- Never infer closures from an incomplete or failed full-board fetch.
- Transactionally persist current state, immutable snapshot/provenance, and event together.

### Things not to copy

- The large Go service and its many product-specific packages; RecruitIntel's selected stack is Next.js plus Python.
- Search infrastructure, embeddings, CV tooling, application tracking, or LLM enrichment; none belongs in Milestone 1.
- Production-specific proxy and anti-blocking machinery. RecruitIntel will use documented public endpoints and must not evade access controls.
- Source catalogues wholesale. Even when code is MIT, external facts and provider terms must be reviewed independently.

### License concerns

The repository contains an MIT license. Architectural ideas are safe to learn from. If any non-trivial implementation were later ported, its copyright notice and MIT terms would need preservation. RecruitIntel currently copies no code.

## Job Board Aggregator

### Purpose and architecture

This project fetches seven ATS families using Python `requests` and `ThreadPoolExecutor`, merges the results into static gzip chunks, and serves them through a client-side JavaScript UI. Worker counts vary by provider. A daily GitHub Actions job performs the scrape, merge, trend snapshot, anomaly check, and data deployment.

Its merge step uses provider-aware identity keys, preserves `first_seen`, and retains previously seen records for a bounded stale period. Trend data is append-only JSONL. A deterministic title-keyword scorer assigns intern/entry/mid/senior tiers. A simple rolling standard-score check reports large per-provider volume changes.

### Ideas worth adapting

- Per-provider concurrency and rate policies instead of one global aggressive setting.
- Deterministic title classification with explicit keyword rules and tests.
- Preserve `first_seen` across re-fetches.
- Append-only operational trend history and basic provider-volume sanity checks.
- CI smoke tests that validate provider response shapes and constructed URLs.
- Keep scraping, normalization, persistence, and presentation as distinct concerns.

### Things not to copy

- URL-only deduplication as a general rule; RecruitIntel should prefer `(source_id, external_id)` and use URLs as evidence, not universal identity.
- Thirty-day age pruning as a substitute for source-aware closure detection.
- Flat-file snapshots as the system of record; immutable event history and relational provenance require PostgreSQL.
- Browser-like user-agent rotation or any behavior intended to work around controls. RecruitIntel will identify itself where appropriate and respect published limits and terms.
- The static frontend/data-repository deployment model, which cannot support transactional entity/event relationships.

### License concerns

The code is MIT, but the README explicitly licenses curated company datasets under CC BY-NC 4.0. That non-commercial restriction is incompatible with an unrestricted future commercial product unless separate permission is obtained. We should not import the company JSON files. Provider identifiers used in RecruitIntel should be entered from first-party company information or user-owned research.

## Simplify Summer 2027 Internships

### Purpose and architecture

The repository stores normalized listing dictionaries in JSON and deterministically generates categorized Markdown/HTML tables. Python modules separate schema validation, filtering, stale marking, category assignment, sorting, formatting, and contribution processing. GitHub Actions validate input, type-check with mypy, lint/format with Ruff, and regenerate README files. Workflow concurrency prevents overlapping updates.

### Ideas worth adapting

- Treat presentation artifacts as generated output, never as the canonical record.
- Validate every required field before publishing.
- Centralize deterministic category rules and keep them testable.
- Explicit active/inactive state and stable IDs in curated contributions.
- CI concurrency controls for scheduled or mutation-producing jobs.

### Things not to copy

- The listing dataset or generated README tables.
- Simplify tracking/application links and branding.
- Fixed age thresholds as proof that a first-party posting closed.
- Category lists verbatim; RecruitIntel has its own documented role-family vocabulary.

### License concerns

No license file or explicit code/data grant was found locally. Without a license, copyright remains reserved by default. Treat both code and listing data as reference-only and do not redistribute, modify, or incorporate them without permission. Individual job facts may also be governed by their original sources and must be collected directly with provenance.

## Simplify New Grad Positions

### Purpose and architecture

This repository is similar in product shape to the internship list: JSON listing records are turned into grouped README tables by Python scripts, and issue-driven GitHub Actions process contributions and refresh generated views.

### Ideas worth adapting

- Separate canonical structured data from generated views.
- Preserve listing IDs and active state across updates.
- Make human contributions pass through the same validation/normalization pipeline as automated input.

### Things not to copy

- Listing contents, formatting implementation, tracking links, or company groupings.
- Repository-specific issue automation before RecruitIntel has a real manual-ingest requirement.

### License concerns

No license file or explicit permission grant was found locally. Use it only as architectural inspiration. Do not import its dataset or code.

## LeetCode Companywise Interview Questions

### Purpose and architecture

The repository is a data snapshot organized by company directory and time window. CSVs contain question ID, URL, title, difficulty, acceptance, and frequency. Its README says the data was gathered using authenticated LeetCode Premium access and browser automation.

The useful modeling insight is that a canonical question is distinct from a company/time/source observation. The repository itself does not implement the provenance-rich normalization RecruitIntel needs.

### Ideas worth adapting later

- One canonical question linked to many company observations.
- Recency windows should be derived from dated observations rather than duplicating canonical questions into separate datasets.
- Preserve the original source and observation time for each company/question claim.

### Things not to copy

- Any CSV data, frequency values, or scraper code.
- Authenticated scraping or collection that depends on a paid account.
- Credentials in source code (the reference README describes that pattern); RecruitIntel must never do this.

### License and terms concerns

No license was found. The data also appears derived from authenticated/premium functionality, creating material copyright, contract, and provenance concerns. RecruitIntel should not ingest this repository. A future interview-question integration needs a separately reviewed, permitted source and must store source-specific observations rather than presenting scraped frequency as ground truth.

## Cross-reference conclusions

The patterns worth carrying forward are consistent across the strongest references:

1. Keep provider code behind a small adapter contract.
2. Normalize before hashing and persistence.
3. Make source identity and event identity unique in PostgreSQL.
4. Preserve `first_seen`, refresh `last_seen`, and soft-close only after a complete successful sync.
5. Use deterministic classification and validation before optional AI.
6. Run bounded, observable, independently schedulable workers.
7. Keep immutable history; generated UI views are projections.
8. Treat licenses for code and datasets separately.

RecruitIntel will implement those ideas independently in the chosen TypeScript/Python stack.

## License-aware acceleration decisions

The detailed repository-by-repository decision record is in `docs/open-source-reuse-audit.md`. The concrete accelerators are:

- **FreeHire (MIT):** adapt provider-specific pagination/normalization edge cases from `internal/sources/{ashby,workday,smartrecruiters,icims,successfactors,bamboohr}.go`; adapt board-namespaced identity from `internal/sources/identity.go`; adapt field-delimited hash test strategy from `internal/jobhash`; and adapt cheap-write/reopen/failure tests from `cmd/ingest`. Any substantial translation must carry the freehire contributors' MIT notice. Do not import its catalogue or redesign RecruitIntel around its Go/SQL domain.
- **Job Board Aggregator (MIT code):** a future location milestone may directly reuse `scripts/geolocation.py` under a third-party namespace with the Riley Dorrington MIT notice and a separately licensed location dataset. Adapt `scripts/check_anomalies.py` for source-volume health checks and consult individual provider mappings/tests. Do not reuse randomized browser user-agent behavior, URL-only identity, fixed-age closure logic, or the CC BY-NC 4.0 `data/` tree.
- **Simplify Summer 2027 / New Grad (no license):** use only as examples of table/schema variability and generated-projection architecture. No source, constants, README rows, application links, or data may be copied.
- **LeetCode Companywise Questions (no license; Premium-derived data):** do not use code or data. Its only retained design insight is the original conclusion that one canonical question must link to many dated company/source observations.

For GitHub Intelligence, no audited repository provides an eligible reusable API client or commit-aware parser system. RecruitIntel will implement that boundary against the official GitHub API using the maintained HTTP dependency already in the project, and all parser fixtures will be synthetic.
