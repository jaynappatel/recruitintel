# GitHub and interview-question intelligence

Milestone 2 adds commit-aware GitHub ingestion without coupling GitHub HTTP, parsing, RecruitIntel normalization, or PostgreSQL persistence. Repository content is untrusted text: RecruitIntel uses the official API, never clones or executes code, and never sends collected text to an LLM.

## Architecture

```text
Next.js mutation API                  PostgreSQL WorkItem + typed worker
POST sync -> github_sync_requests        GitHubSyncRunner
                                                  |
                                     OfficialGitHubClient
                                                  |
                            metadata -> latest commit SHA
                                      | unchanged -> finish
                                      v
                              compare/tree + watched paths
                                      |
                              bounded file fetches
                                      |
                 document parser -> semantic parser -> normalizer
                                      |
                  resolved records + unresolved observations
                                      |
                           one PostgreSQL transaction
                 projections / provenance / immutable events
                                      |
                         typed APIs and analytics
```

PostgreSQL is the scheduler and orchestration boundary. `POST /api/github/sync/:repositoryId`
creates or returns one durable domain request; its trigger enqueues an orchestration WorkItem without
moving repository/SHA state out of GitHub tables. The supervised worker claims the GitHub lane with
a fenced lease and typed handler. Scheduled repository syncs use the same path. The web request
never starts provider work.

## Data model and identity boundaries

The schema separates three concepts:

1. `interview_questions` is the canonical problem. Deterministic normalized title and optional LeetCode slug/number identify it.
2. `company_interview_questions` is the company/question relationship and aggregate first/last seen, observation count, confidence, role family, and interview stage.
3. `interview_question_observations` is immutable source evidence containing repository, path, commit SHA, source URL, observed timestamp, raw title, metadata, and a unique fingerprint.

`unresolved_github_observations` preserves job/question rows that cannot be resolved safely. Unknown company names are never guessed or discarded. Ambiguous canonical-question identities are preserved there for review.

Repositories are many-to-many with companies through `github_repository_company_links`. A link owns watched paths, explicit company mappings, and an enabled flag. Multi-company files resolve rows against the canonical global company/alias index; enabled links determine repository configuration and recipients of repository-update events.

## Authentication and environment

`GITHUB_TOKEN` is optional and increases official API limits:

```dotenv
GITHUB_TOKEN=github_pat_redacted
```

It is worker-only, passed as an authorization header, never persisted, and never logged. Use the smallest GitHub permission set needed to read configured repositories.

Mutation routes accept an authenticated admin session or a hashed service-principal token with the
single `ADMIN_MUTATE` scope. Create the latter once:

```bash
DATABASE_URL=postgresql://... pnpm --filter @recruitintel/db service-principal:create
```

The command prints the opaque token once and stores only its SHA-256 hash. Send that value as
`Authorization: Bearer <value>`. Never use the GitHub provider token as the admin credential.

## Repository configuration

Attach a repository to a company:

```bash
curl -X POST http://localhost:3000/api/companies/stripe/github-repositories \
  -H "Authorization: Bearer $RECRUITINTEL_ADMIN_BEARER" \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryUrl": "https://github.com/example/interview-questions",
    "repositoryType": "INTERVIEW_QUESTIONS",
    "parserType": "AUTO",
    "watchedPaths": ["questions/stripe.md"],
    "companyMappingRules": {"aliases": ["Stripe, Inc."]},
    "enabled": true
  }'
```

Repository types are `INTERNSHIP_LIST`, `NEW_GRAD_LIST`, `INTERVIEW_QUESTIONS`, `COMPANY_REPOSITORY`, and `OTHER`. Parser types are `AUTO`, `MARKDOWN_TABLE`, `CSV`, `JSON`, `INTERNSHIP_LIST`, and `INTERVIEW_QUESTIONS`.

Only HTTPS `github.com/<owner>/<repository>` URLs and safe relative watched paths are accepted. `companyMappingRules.aliases` adds reviewed exact aliases for the linked company; it never enables fuzzy matching. A missing company column resolves only if the repository has exactly one enabled company link.

## Run a sync

Queue a request:

```bash
curl -X POST http://localhost:3000/api/github/sync/REPOSITORY_UUID \
  -H "Authorization: Bearer $RECRUITINTEL_ADMIN_BEARER"
```

The continuous worker executes it:

```bash
uv run recruitintel-collectors scheduler
uv run recruitintel-collectors worker --classes GITHUB
```

For a deterministic local smoke, use `--once`; direct production execution that bypasses a durable
request is intentionally unavailable:

```bash
uv run recruitintel-collectors worker --classes GITHUB --once
```

Each run creates `collector_runs` and `github_sync_runs` records with previous/current SHA, files inspected, parsed/new/updated/unchanged/unresolved counts, duration, errors, and last known rate limit.

## Sync lifecycle and idempotency

1. Load the repository, source, links, and reliability.
2. Read official metadata/default branch and the latest commit SHA.
3. If the SHA equals `last_processed_commit_sha`, finish without fetching files.
4. Compare commits when possible. Initial or incomplete comparisons fall back to a recursive Git tree.
5. Intersect files with watched paths and supported extensions; default maximum is 50 and the hard maximum is 200.
6. Fetch selected files from the Contents API with bounded concurrency.
7. Parse, normalize, and retain unresolved records.
8. Persist current state, provenance, counts, and events in one transaction.
9. Advance `last_processed_commit_sha` only after that transaction succeeds.

Observation fingerprints include repository, path, commit, record type, company key, and normalized item identity. Event fingerprints include event type, company, source, repository, subject, and causal commit. Database uniqueness makes same-commit retries idempotent. Failed runs never advance processing state.

## Parser plugins

Document parsers turn untrusted text into row dictionaries:

- `MarkdownTableParser` reads GitHub-flavored pipe tables without rendering HTML;
- `CSVParser` uses Python's standard CSV reader;
- `JSONParser` accepts object arrays or `records`, `items`, `data`, `questions`, or `jobs` arrays.

Semantic parsers map header aliases into domain-neutral parsed records:

- `InterviewQuestionParser` reads company, problem/title, URL, difficulty, topics, role, and stage;
- `InternshipListParser` reads company, role/title, location, application URL, and description.

`ParserRegistry` selects `.md`, `.markdown`, `.csv`, or `.json` document parsing and then semantic behavior from repository/parser type. YAML is intentionally absent. If needed later, install a maintained safe-loader after license/security review; never use unsafe object construction.

To add a parser:

1. Add a pure parser under `services/collectors/src/recruitintel_collectors/github/parsers`.
2. Return Pydantic parsed records; do not import PostgreSQL or call GitHub.
3. Register only explicit formats/extensions.
4. Add wholly synthetic fixtures for valid, malformed, duplicate, empty, and multi-company input.
5. Prove input is never evaluated or executed.
6. Run Ruff, mypy, pytest, and the PostgreSQL end-to-end test.

## Question normalization

Normalization uses Unicode NFKC, whitespace folding, punctuation-insensitive tokens, explicit number prefixes, and LeetCode problem URL/slug parsing. These all resolve to normalized title `number of islands`:

- `LC 200 - Number of Islands`
- `200. Number of Islands`
- `Number of Islands`
- `leetcode.com/problems/number-of-islands`

Slug, number, and normalized title are cross-checked in persistence. Conflicting identities become unresolved observations instead of guessed merges. No LLM is involved.

## GitHub job lists

Internship/new-grad rows become the existing `NormalizedJob`; there is no parallel job schema. Role/experience classification reuses Milestone 1 rules, with repository type supplying explicit early-career context. GitHub content hashes exclude commit-specific provenance, so a new commit containing unchanged job content does not emit `JOB_CHANGED`.

The job projection and every imported job observation retain repository ID/URL, path, commit SHA, source URL, and observed timestamp. Milestone 2 does not close GitHub-list jobs from incremental changed-file absence; closure needs a complete repository-scope snapshot policy.

## Rate limits, failures, and security

The client reads GitHub `Limit`, `Remaining`, `Used`, and `Reset` headers. Remaining/reset values are logged without credentials and persisted on repository/sync records. At zero remaining calls, the client stops before another request and records a retryable failure. Transient network/server failures use bounded retries/backoff; response bytes and selected file counts are bounded.

Repository text cannot choose a new request host, execute code, access local files, or become a prompt. All API calls use fixed `api.github.com` endpoints.

## Stable frontend API contracts

Success uses `{ "data": ... }`; list routes also return `meta`. Errors use `{ "error": { "code": string, "message": string } }`. Frontends must consume these contracts rather than database tables. Executable Zod schemas and inferred types are in `packages/types/src/index.ts`.

```ts
type RoleFamily =
  | "SOFTWARE_ENGINEERING"
  | "AI_ML"
  | "DATA_SCIENCE"
  | "DATA_ENGINEERING"
  | "PRODUCT"
  | "DESIGN"
  | "SECURITY"
  | "CLOUD_DEVOPS"
  | "QUANT"
  | "HARDWARE"
  | "OTHER";
```

### `GET /api/companies/:identifier/github-repositories`

Returns `data: CompanyGitHubRepository[]`, `meta: { total }`:

```ts
interface CompanyGitHubRepository {
  id: string;
  owner: string;
  repositoryName: string;
  repositoryUrl: string;
  defaultBranch: string | null;
  repositoryType:
    | "INTERNSHIP_LIST"
    | "NEW_GRAD_LIST"
    | "INTERVIEW_QUESTIONS"
    | "COMPANY_REPOSITORY"
    | "OTHER";
  parserType:
    | "AUTO"
    | "MARKDOWN_TABLE"
    | "CSV"
    | "JSON"
    | "INTERNSHIP_LIST"
    | "INTERVIEW_QUESTIONS";
  enabled: boolean;
  linkEnabled: boolean;
  watchedPaths: string[];
  companyMappingRules: Record<string, unknown>;
  lastSeenCommitSha: string | null;
  lastProcessedCommitSha: string | null;
  lastCheckedAt: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `POST /api/companies/:identifier/github-repositories`

Requires admin bearer authentication. Accepts the attachment object above and returns status 201 with `data: CompanyGitHubRepository`.

```ts
interface AttachGitHubRepositoryRequest {
  repositoryUrl: string;
  repositoryType: CompanyGitHubRepository["repositoryType"];
  parserType?: CompanyGitHubRepository["parserType"]; // default AUTO
  watchedPaths?: string[]; // default []
  companyMappingRules?: Record<string, unknown>; // default {}
  enabled?: boolean; // default true
}
```

### `POST /api/github/sync/:repositoryId`

Requires admin bearer authentication and returns status 202. Repeated calls return the existing active request:

```ts
interface GitHubSyncRequest {
  id: string;
  githubRepositoryId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  requestedAt: string;
}
```

### `GET /api/companies/:identifier/interview-questions`

Query: `limit` 1–100, `offset` 0–10000, `sort=most_observed|recent`. The envelope includes `meta: { limit, offset, sort }` and:

```ts
interface InterviewQuestionAnalytics {
  items: Array<{
    id: string;
    canonicalTitle: string;
    normalizedTitle: string;
    leetcodeSlug: string | null;
    leetcodeNumber: number | null;
    difficulty: "EASY" | "MEDIUM" | "HARD" | null;
    topics: string[];
    roleFamily: RoleFamily | null;
    interviewStage: string | null;
    confidence: number;
    observationCount: number;
    sourceCount: number;
    firstObservedAt: string;
    lastObservedAt: string;
  }>;
  aggregates: {
    totalQuestions: number;
    totalObservations: number;
    totalSources: number;
    topicCounts: Array<{ key: string; count: number }>;
    difficultyCounts: Array<{ key: string; count: number }>;
  };
  ordering: "OBSERVATION_COUNT_THEN_RECENCY" | "RECENCY_THEN_OBSERVATION_COUNT";
}
```

### `GET /api/interview-questions/:id`

Returns the 200 newest provenance observations:

```ts
interface InterviewQuestionDetail {
  question: {
    id: string;
    canonicalTitle: string;
    normalizedTitle: string;
    leetcodeSlug: string | null;
    leetcodeNumber: number | null;
    difficulty: "EASY" | "MEDIUM" | "HARD" | null;
    topics: string[];
    createdAt: string;
    updatedAt: string;
  };
  companies: Array<{
    companyId: string;
    companyName: string;
    companySlug: string;
    observationCount: number;
    sourceCount: number;
    firstObservedAt: string;
    lastObservedAt: string;
    confidence: number;
    roleFamily: RoleFamily | null;
    interviewStage: string | null;
  }>;
  observations: Array<{
    id: string;
    companyId: string;
    companyName: string;
    companySlug: string;
    sourceId: string;
    sourceName: string;
    githubRepositoryId: string | null;
    repositoryUrl: string | null;
    sourceUrl: string;
    sourcePath: string;
    commitSha: string;
    observedAt: string;
    rawTitle: string;
    metadata: Record<string, unknown>;
  }>;
}
```

## Troubleshooting

- **401 mutation:** sign in as an active admin or send an active, unexpired hashed service token.
- **403 mutation:** the authenticated user is not an admin or the service principal lacks
  `ADMIN_MUTATE`.
- **Request stays `PENDING`:** verify the GitHub worker lane and scheduler are running, the repository
  policy is reviewed/executable, and the worker database role is bound to `GITHUB`.
- **Rate-limit failure:** inspect safe attempt/source-health reset metadata and `collector_errors`;
  the durable retry eligibility respects GitHub's reset timestamp rather than sleeping a worker.
  Configure a permitted `GITHUB_TOKEN` when appropriate.
- **No files inspected:** verify watched paths and supported extensions.
- **Too many files:** narrow paths or deliberately set `metadata.max_files_per_sync`, up to 200.
- **Unresolved company:** add a reviewed global alias or link-local alias; never add fuzzy guesses.
- **Unresolved question:** inspect raw identity/conflict evidence before an administrative repair.
- **Parse failure:** fix configuration or input format. The processed SHA remains unchanged and retry-safe.

## Deferred scope

Milestone 2 does not implement public-web search, recruiter discovery, authenticated LinkedIn/LeetCode scraping, calendars, alerts, LLM extraction, embeddings, or ML. It does not add product UI components; its contracts are ready for separately scoped frontend integration.
