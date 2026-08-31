# Milestone 12 implementation plan: explicit browser companion

## Authoritative objective

Milestone 12 is the browser-companion intake described in
`final-architecture-roadmap.md`: an MV3 side panel scans only the currently
rendered `http(s)` careers or job page after an explicit user gesture, ranks
bounded candidate jobs, and sends only a user-selected candidate into the
existing canonical RecruitIntel workflows. It is not browser automation,
autofill, autonomous application submission, a second job graph, a second
identity system, or an arbitrary web scraper.

## Architecture and ownership

The extension is a thin client. It uses `activeTab` and explicit scripting;
there is no `<all_urls>` permission, form/cookie/localStorage collection, page
navigation, content execution, or server secret in its bundle. It records only
sanitized, bounded structured candidates and a provenance summary. DOM and
JSON-LD are untrusted data, never HTML to render or instructions to execute.

The existing M6 `extension_grants` table becomes the scoped bearer capability:
hashed opaque `PAGE_SCAN`/`JOB_IMPORT` grants are issued, refreshed, and
revoked by a Better-Auth owner session. Extension calls authenticate with the
grant; browser request values never supply an owner ID. Scan sessions,
snapshots, candidates, and decisions are private owner-scoped data. Existing
companies, sources, jobs, and M8 opportunities remain shared intelligence.

## Intake contract

The extension removes controls, scripts, styles, hidden/invisible text,
query/fragment URL data, and oversized values before sending a structured
snapshot. The server validates the same caps and URL policy. LinkedIn and
non-http(s) pages are rejected. A snapshot supports at most 100 candidates;
the deterministic extractor supports job grids, single job pages, JSON-LD,
duplicate URL collapse, and SPA re-scan through an explicit new gesture.

Selecting a candidate is idempotent. Exact normalized application URL matches
reuse an existing M8 source posting/opportunity. New postings are permitted
only under an already known company source whose source policy is
`ALLOWED`/`ALLOWED_WITH_LIMITS`; otherwise the private decision is recorded as
`POLICY_BLOCKED` and no shared fact is created. No server fetch occurs in this
milestone, so no SSRF, anti-bot bypass, or policy bypass is introduced.

The selection can create an M10 application or plan using their existing
owner-scoped APIs/domain services and can request an M11 exact match only for
an explicitly supplied owner resume version. Historical opportunity references
remain immutable; current M8 successor/mismatch is exposed separately.

## Security, privacy, and cost

All private reads/mutations use compound owner predicates. Grant revocation,
cross-user identifiers, malformed IDs, stale candidate revisions, and failed
IDOR writes return safe errors without mutation. Export includes M12 private
structured records but excludes grant tokens/hashes and all credentials.
Deletion cascades private M12 data without deleting shared canonical facts.

M12 has no paid dependency, model call, external detail fetch, or new worker
provider. `ZERO_COST_MODE=true` therefore remains fully usable with paid spend
and model spend at zero. The extension contains original, dependency-free code;
no third-party code was copied, so no new attribution notice is required.

## Permanent acceptance coverage

Coverage includes a synthetic 40-job grid, JSON-LD/single-job parsing, SPA
re-scan, duplicate collapse, iframe/control/invisible/malicious DOM exclusion,
URL restrictions, grant expiry/revocation, owner IDOR/no-mutation, duplicate
and concurrent capture/selection, policy-blocked selection, canonical dedup,
M9/M10/M11 linkage, export/delete, merge/split/re-merge, migration
preservation, and a real Better-Auth production HTTP lifecycle.

## Definition of done

- [x] Additive migration and private ownership constraints apply/rerun cleanly.
- [x] MV3 side-panel extension implements explicit bounded scan and selected-only upload.
- [x] Scoped grant lifecycle and authenticated owner APIs are complete.
- [x] Selected candidates deduplicate into M8 and may flow to M10/M11 without fabricated data.
- [x] Privacy, IDOR, concurrency, canonical lineage, and production HTTP tests pass.
- [x] Fresh full acceptance preserves M1-M11, Google ciphertext, zero-cost totals, and a clean worktree.
