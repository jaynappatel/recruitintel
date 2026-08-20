# Open-source reuse audit (Milestone 2 historical scope)

> **Superseded for post-Milestone-5 planning.** This document records the smaller
> Milestone 2 audit. The complete architecture-acceleration audit, including all
> ten repositories currently present in the reference directory, is in
> `docs/final-architecture-roadmap.md`. In particular, the old statement below
> that no copyleft repository was present is no longer true: the later reference
> set includes GPL-3.0-only Notchi, and HackerRank Hiring Agent bundles an
> AGPL-licensed PyMuPDF-derived module despite its MIT root license.

Audited on 2026-08-17 for the repositories present in `/Users/jaynapatel/Desktop/github repos`. The audit separates source-code licensing from dataset licensing and evaluates compatibility with RecruitIntel's MIT distribution. Architecture remains RecruitIntel-owned; an upstream adapter may feed RecruitIntel contracts but may not redefine Company, Job, RecruitingEvent, InterviewQuestion, Source, Observation, Watchlist, Calendar, or application tracking.

No source code or datasets from these repositories were copied into RecruitIntel during this audit.

## Decision summary

| Repository                               | Code license     | Dataset license                                                                                      | Primary recommendation                                                                       |
| ---------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| FreeHire                                 | MIT              | Repository states pipeline/data are open; provenance for external facts still requires source review | ADAPT WITH ATTRIBUTION                                                                       |
| Job Board Aggregator                     | MIT              | `data/`: CC BY-NC 4.0                                                                                | ADAPT WITH ATTRIBUTION for code; DO NOT USE datasets in unrestricted/commercial distribution |
| Simplify Summer 2027 Internships         | No license found | No license found                                                                                     | ARCHITECTURE INSPIRATION ONLY                                                                |
| Simplify New Grad Positions              | No license found | No license found                                                                                     | ARCHITECTURE INSPIRATION ONLY; DO NOT USE listing data                                       |
| LeetCode Companywise Interview Questions | No license found | No license found; authenticated/Premium origin                                                       | DO NOT USE                                                                                   |

At the time of this narrower audit, no GPL, LGPL, or AGPL repository was in its
five-repository inventory. That conclusion must not be applied to the expanded
reference set. No copyleft reference code is proposed for incorporation.

## FreeHire

**Repository:** `/Users/jaynapatel/Desktop/github repos/freehire-main`  
**Upstream identified locally:** `strelov1/freehire`  
**License:** MIT, copyright 2026 freehire contributors.  
**Compatibility:** Compatible with RecruitIntel's MIT distribution when the upstream copyright and permission notice are preserved in copies or substantial adaptations.

### Relevant functionality

- broad provider adapter catalogue and configuration-driven board ingestion;
- fixed provider identities and board-namespaced external IDs;
- public ATS pagination and response normalization;
- deterministic content hashes and separate role-identity fingerprints;
- cheap liveness refresh for unchanged postings;
- source/board-scoped stale handling, soft closure, and reopening;
- transactionally coordinated current-state writes and downstream outboxes;
- location normalization dictionaries and deterministic classification;
- extensive provider fixtures and failure-path integration tests.

### Reuse recommendation

**ADAPT WITH ATTRIBUTION.** FreeHire is Go while RecruitIntel collectors are Python, so direct file vendoring would create a second runtime and couple RecruitIntel to upstream database/domain types. Substantial translations of the algorithms remain derivative adaptations and must preserve the MIT notice in `THIRD_PARTY_NOTICES.md` and near the adapted module.

### Files/modules worth using

- `internal/sources/greenhouse.go`, `lever.go`, `ashby.go`, `workday.go`, `smartrecruiters.go`, `icims.go`, `successfactors.go`, and `bamboohr.go`: provider endpoint/pagination edge cases for future adapters;
- corresponding `internal/sources/*_test.go`: response-shape and pagination cases that can inform independently structured fixtures;
- `internal/sources/identity.go`: board-namespaced provider identity and safe SQL-pattern scoping;
- `internal/jobhash/jobhash.go`, `rolefingerprint.go`, and tests: field-delimited hashing and separation of content-change identity from role/repost identity;
- `cmd/ingest/store.go` and `store_cheap_write_integration_test.go`: cheap unchanged writes, reopen behavior, and transactional downstream gating;
- `cmd/ingest/board_health.go` and stale-sweep tests: preventing partial provider failure from closing unrelated jobs;
- `internal/location/*.go`: deterministic work-mode/country/city parsing, subject to a separate license/provenance review of `cities15000.tsv` before copying data;
- `internal/atsboard/board.go`: configuration validation for provider board definitions.

### Attribution requirements

For copied or substantially translated code, retain:

```text
Copyright (c) 2026 freehire contributors
SPDX-License-Identifier: MIT
Derived from https://github.com/strelov1/freehire
```

Also reproduce the upstream MIT license text in `THIRD_PARTY_NOTICES.md` or alongside any clearly vendored module and describe RecruitIntel modifications.

### Risk/concerns

- Do not copy production proxy/anti-blocking behavior or anything that conflicts with provider terms.
- Provider endpoints and terms are independent of the repository's MIT code license and must be verified at implementation time.
- Source catalogues contain facts/configuration whose provenance may differ from code licensing; do not bulk-import them.
- Location data may have its own upstream license even though the surrounding Go code is MIT.
- FreeHire's domain and SQL are not RecruitIntel's domain; only adapter-level logic and tests should cross the boundary.

## Job Board Aggregator

**Repository:** `/Users/jaynapatel/Desktop/github repos/job-board-aggregator-main`  
**Upstream identified locally:** `Feashliaa/job-board-aggregator`  
**Code license:** MIT, copyright 2026 Riley Dorrington.  
**Dataset license:** README declares curated datasets under `data/` CC BY-NC 4.0.  
**Compatibility:** MIT code is compatible with attribution. CC BY-NC data is not suitable for an unrestricted future commercial RecruitIntel distribution without separate permission.

### Relevant functionality

- Python ATS fetchers and provider-specific concurrency choices;
- Workday, Ashby, iCIMS, Paylocity, BambooHR, Greenhouse, and Lever mappings;
- deterministic job-tier keyword classification;
- provider-aware job deduplication and `first_seen` preservation;
- location parsing and geolocation lookup;
- append-only daily provider/tier trend counts and simple anomaly detection;
- static chunk generation and manifest-based loading.

### Reuse recommendation

**ADAPT WITH ATTRIBUTION** for narrowly selected MIT code. `scripts/geolocation.py` is a candidate for **REUSE DIRECTLY** in a future location milestone if it is isolated under a third-party namespace, retains the MIT notice, receives tests, and uses a separately licensed location dataset. Use the anomaly formula as a small attributed adaptation if activity-volume monitoring is added.

Do **not** reuse `scripts/scraper.py` wholesale. It mixes network policy, random browser user agents, normalization, concurrency, and storage; parts conflict with RecruitIntel's identifying-user-agent and adapter-boundary policies.

### Files/modules worth using

- `scripts/geolocation.py`: reusable parsing/lookup logic, excluding `data/locations.json` unless separately permitted;
- `scripts/check_anomalies.py`: rolling count baseline and standard-score sanity check;
- `scripts/scraper.py`: endpoint/payload research for future providers only; adapt individual mappings into RecruitIntel adapters;
- `scripts/tests/test_paylocity.py` and `scripts/tests/test_suite/`: provider/date/URL edge cases;
- `scripts/merge_data.py`: provider-aware identity examples and first-seen preservation, but not its 30-day stale policy;
- `js/chunk_worker.js` and `js/jobs_loader.js`: only if a future static export needs chunked offline projections; not relevant to the PostgreSQL product path.

### Attribution requirements

Any copied or substantially adapted code must retain:

```text
Copyright (c) 2026 Riley Dorrington
SPDX-License-Identifier: MIT
Derived from https://github.com/Feashliaa/job-board-aggregator
```

Include the upstream MIT text and modification notes in `THIRD_PARTY_NOTICES.md` or the vendored directory.

### Risk/concerns

- Do not import `data/*.json`, salary shards, locations, company catalogues, or generated job chunks under RecruitIntel's MIT-only distribution: the declared CC BY-NC 4.0 terms restrict commercial use.
- Never rotate browser-like user agents to evade controls.
- URL-only identity and fixed age-based stale deletion are weaker than RecruitIntel's source/external-ID identity and complete-sync closure guard.
- Any provider mapping still requires first-party endpoint and terms verification.

## Simplify Summer 2027 Internships

**Repository:** `/Users/jaynapatel/Desktop/github repos/Summer2027-Internships-dev`  
**Upstream identified locally:** `SimplifyJobs/Summer2027-Internships`  
**License:** No license file, package license field, or explicit grant was found.  
**Compatibility:** No permission to copy, modify, or redistribute source or data. Copyright remains reserved by default.

### Relevant functionality

- validated JSON listing schema;
- deterministic active/off-season filtering;
- title category rules with short-keyword boundaries;
- generated README tables from structured records;
- GitHub Actions-safe output formatting;
- listing analytics and validation commands.

### Reuse recommendation

**ARCHITECTURE INSPIRATION ONLY.** Independently implement schema validation, parser fixtures, deterministic classification, and generated projections. Do not translate or copy code, constants, README tables, icons, URLs, or listing data.

### Files/modules worth studying only

- `list_updater/listings.py`, `category.py`, `formatter.py`, `readme_generator.py`, `analytics.py`, and `github.py`;
- `pyproject.toml` for its small Python quality-tool setup;
- README table shapes as examples of formats a generic GitHub parser may encounter, without using rows as fixtures.

### Attribution requirements

No attribution can cure the absence of a license. Obtain explicit permission or an upstream license before any code/data reuse.

### Risk/concerns

- Both code and dataset are unlicensed.
- Application/tracking links and branding are project-specific.
- Age thresholds are not authoritative closure evidence.
- RecruitIntel tests must use wholly synthetic tables, not copied rows.

## Simplify New Grad Positions

**Repository:** `/Users/jaynapatel/Desktop/github repos/New-Grad-Positions-dev`  
**Upstream identified locally:** `SimplifyJobs/New-Grad-Positions`  
**License:** No license file or explicit grant found.  
**Compatibility:** No permission to copy or redistribute. This local snapshot contains README/listing data but no reusable implementation modules.

### Relevant functionality

- grouped HTML/Markdown job tables;
- repeated-company row conventions;
- visible active/inactive markers and multiple application links;
- long-lived archived snapshots.

### Reuse recommendation

**ARCHITECTURE INSPIRATION ONLY** for parser-shape requirements and **DO NOT USE** for listing data. Create synthetic multi-company/repeated-row fixtures independently.

### Files/modules worth studying only

- `README.md` and archived README files for structural variability;
- `CONTRIBUTING.md` for human contribution workflow concepts.

### Attribution requirements

No source or dataset may be copied without an explicit license or permission.

### Risk/concerns

- No licensed code is present to accelerate implementation.
- Listing facts, tracking links, HTML, logos, and presentation are copyrighted/unlicensed.
- Repository history should not be imported as RecruitIntel historical truth.

## LeetCode Companywise Interview Questions

**Repository:** `/Users/jaynapatel/Desktop/github repos/leetcode-companywise-interview-questions-master`  
**Upstream identified locally:** `snehasishroy/leetcode-companywise-interview-questions`  
**License:** No license file or explicit grant found.  
**Dataset origin:** README says data was gathered with LeetCode Premium credentials/browser automation.  
**Compatibility:** Not eligible for copying into RecruitIntel.

### Relevant functionality

- company-directory and recency-window organization;
- CSV question fields such as ID, URL, title, difficulty, acceptance, and frequency;
- evidence that canonical questions must be separate from company/time observations.

### Reuse recommendation

**DO NOT USE.** Do not copy CSVs, frequency values, rows, directory names as a catalogue, or scraper code. RecruitIntel's CSV parser and normalization tests must use synthetic data. A future production source needs independent rights/terms review and public/permitted access.

### Files/modules worth studying only

- `README.md` for provenance/terms risk;
- CSV headers only as generic format inspiration, not the row data.

### Attribution requirements

No attribution resolves the missing license or possible LeetCode contractual restrictions. Explicit permission from the relevant rights holders would be required.

### Risk/concerns

- authenticated/Premium scraping conflicts with RecruitIntel's public/permitted-source policy;
- no license applies to code or data;
- frequency and recency values may be proprietary and cannot be represented as RecruitIntel truth;
- credentials must never be embedded or automated as described by the reference README.

## Recommended reuse and time savings

### Direct reuse

- No audited code should be directly reused for Milestone 2: none provides a suitable licensed GitHub API/change/parser layer.
- In a later location milestone, consider vendoring the MIT `scripts/geolocation.py` from Job Board Aggregator with attribution while substituting an independently licensed dataset. Estimated saving: **2–4 engineering days**.

### Dependencies instead of copying

- Continue using maintained `httpx` for GitHub HTTP rather than copying an upstream client or adding a redundant SDK.
- Use Python's safe standard-library `csv`, `json`, `base64`, `html.parser`, and hashing/path modules for the initial parsers.
- If YAML is required later, add a maintained safe-loader dependency after its license/security review rather than implementing YAML or copying parser code.
- Do not copy GitHub Actions output helpers; platform-native actions or a small original boundary are sufficient.

### Adapt with attribution

- FreeHire provider endpoint/pagination edge cases and identity/hash tests for future ATS adapters: **2–5 days saved per complex provider**, potentially **3–6 weeks** across Workday, SmartRecruiters, iCIMS, SuccessFactors, BambooHR, and Ashby.
- Job Board Aggregator anomaly monitoring: **1–2 days saved** when provider-volume health checks are implemented.
- Job Board Aggregator provider mappings: **1–3 days saved per provider**, after removing user-agent evasion and converting to RecruitIntel contracts.

### Inspiration only / prohibited

- Both Simplify repositories remain architecture inspiration only because no license was found.
- The LeetCode repository and its dataset must not be used.
- Job Board Aggregator's `data/` tree must not be imported into an unrestricted/commercial product without separate permission because it is CC BY-NC 4.0.

For the current Milestone 2, the architecture study saves an estimated **1–2 engineering days** by clarifying parser shapes, canonical-question separation, and failure/closure rules, but produces no copyable GitHub implementation. Across later ATS/location/operations milestones, approved reuse could save approximately **4–8 engineering weeks**.
