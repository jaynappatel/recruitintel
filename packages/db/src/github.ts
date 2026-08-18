import { getDatabase } from "./index";

export interface AttachGitHubRepositoryInput {
  repositoryUrl: string;
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
  watchedPaths: string[];
  companyMappingRules: Record<string, unknown>;
  enabled: boolean;
}

export interface CompanyGitHubRepositoryRecord {
  id: string;
  owner: string;
  repositoryName: string;
  repositoryUrl: string;
  defaultBranch: string | null;
  repositoryType: string;
  parserType: string;
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

export interface GitHubSyncRequestRecord {
  id: string;
  githubRepositoryId: string;
  status: string;
  requestedAt: string;
}

type Row = Record<string, unknown>;
type SafeJson = null | string | number | boolean | SafeJson[] | { [key: string]: SafeJson };

function toSafeJson(value: unknown): SafeJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(toSafeJson);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSafeJson(item)]));
  }
  throw new TypeError("Company mapping rules must contain only JSON values");
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected a database string");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new TypeError("Expected a database timestamp");
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new TypeError("Expected a database number");
}

function mapRepository(row: Row): CompanyGitHubRepositoryRecord {
  return {
    id: stringValue(row.id),
    owner: stringValue(row.owner),
    repositoryName: stringValue(row.repository_name),
    repositoryUrl: stringValue(row.repository_url),
    defaultBranch: nullableString(row.default_branch),
    repositoryType: stringValue(row.repository_type),
    parserType: stringValue(row.parser_type),
    enabled: Boolean(row.enabled),
    linkEnabled: Boolean(row.link_enabled),
    watchedPaths: Array.isArray(row.watched_paths) ? row.watched_paths.map(stringValue) : [],
    companyMappingRules: (row.company_mapping_rules ?? {}) as Record<string, unknown>,
    lastSeenCommitSha: nullableString(row.last_seen_commit_sha),
    lastProcessedCommitSha: nullableString(row.last_processed_commit_sha),
    lastCheckedAt: iso(row.last_checked_at),
    rateLimitRemaining: nullableNumber(row.rate_limit_remaining),
    rateLimitResetAt: iso(row.rate_limit_reset_at),
    createdAt: iso(row.created_at) ?? "",
    updatedAt: iso(row.updated_at) ?? "",
  };
}

function parseRepositoryUrl(value: string): {
  owner: string;
  repositoryName: string;
  repositoryUrl: string;
} {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0]?.toLowerCase() ?? "";
  const repositoryName = (parts[1] ?? "").replace(/\.git$/i, "").toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    parts.length !== 2 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(owner) ||
    !/^[a-z0-9._-]{1,100}$/.test(repositoryName)
  ) {
    throw new ValueError("Invalid GitHub repository URL");
  }
  return { owner, repositoryName, repositoryUrl: `https://github.com/${owner}/${repositoryName}` };
}

class ValueError extends Error {}

const repositorySelect = `
  select gr.id, gr.owner, gr.repository_name, gr.repository_url, gr.default_branch,
         gr.repository_type, gr.parser_type, gr.enabled, l.enabled as link_enabled,
         l.watched_paths, l.company_mapping_rules, gr.last_seen_commit_sha,
         gr.last_processed_commit_sha, gr.last_checked_at, gr.rate_limit_remaining,
         gr.rate_limit_reset_at, gr.created_at, gr.updated_at
  from public.github_repository_company_links l
  join public.github_repositories gr on gr.id = l.github_repository_id
`;

export async function listCompanyGitHubRepositories(
  companyId: string,
): Promise<CompanyGitHubRepositoryRecord[]> {
  const sql = getDatabase();
  const rows = await sql.unsafe(
    `${repositorySelect}
     where l.company_id = $1::uuid
     order by gr.repository_type, gr.owner, gr.repository_name`,
    [companyId],
  );
  return rows.map(mapRepository);
}

export async function attachCompanyGitHubRepository(
  companyId: string,
  input: AttachGitHubRepositoryInput,
): Promise<CompanyGitHubRepositoryRecord> {
  const coordinates = parseRepositoryUrl(input.repositoryUrl);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [source] = await transaction`
      insert into public.sources (
        source_type, provider, external_key, name, base_url, reliability, metadata
      ) values (
        'GITHUB', 'github', ${`${coordinates.owner}/${coordinates.repositoryName}`},
        ${`GitHub: ${coordinates.owner}/${coordinates.repositoryName}`},
        ${coordinates.repositoryUrl}, 0.650, ${transaction.json({ official_api: true })}
      )
      on conflict (provider, external_key) do update set
        base_url = excluded.base_url, enabled = true
      returning id
    `;
    if (!source) throw new Error("GitHub source upsert returned no row");
    const [repository] = await transaction`
      insert into public.github_repositories (
        source_id, owner, repository_name, repository_url,
        repository_type, parser_type, enabled
      ) values (
        ${stringValue(source.id)}::uuid, ${coordinates.owner}, ${coordinates.repositoryName},
        ${coordinates.repositoryUrl}, ${input.repositoryType}, ${input.parserType}, ${input.enabled}
      )
      on conflict (owner, repository_name) do update set
        repository_url = excluded.repository_url,
        repository_type = excluded.repository_type,
        parser_type = excluded.parser_type,
        enabled = excluded.enabled
      returning id
    `;
    if (!repository) throw new Error("GitHub repository upsert returned no row");
    const repositoryId = stringValue(repository.id);
    await transaction`
      insert into public.github_repository_company_links (
        company_id, github_repository_id, watched_paths, company_mapping_rules, enabled
      ) values (
        ${companyId}::uuid, ${repositoryId}::uuid, ${input.watchedPaths},
        ${transaction.json(toSafeJson(input.companyMappingRules))}, ${input.enabled}
      )
      on conflict (company_id, github_repository_id) do update set
        watched_paths = excluded.watched_paths,
        company_mapping_rules = excluded.company_mapping_rules,
        enabled = excluded.enabled
    `;
    const rows = await transaction.unsafe(
      `${repositorySelect}
       where l.company_id = $1::uuid and gr.id = $2::uuid`,
      [companyId, repositoryId],
    );
    if (!rows[0]) throw new Error("GitHub repository attachment query returned no row");
    return mapRepository(rows[0]);
  });
}

export async function enqueueGitHubSync(
  repositoryId: string,
): Promise<GitHubSyncRequestRecord | null> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [repository] = await transaction`
      select id from public.github_repositories where id = ${repositoryId}::uuid and enabled
    `;
    if (!repository) return null;
    const [row] = await transaction`
      insert into public.github_sync_requests (github_repository_id)
      values (${repositoryId}::uuid)
      on conflict (github_repository_id) where status in ('PENDING', 'RUNNING')
      do update set metadata = public.github_sync_requests.metadata
      returning id, github_repository_id, status, requested_at
    `;
    if (!row) throw new Error("GitHub sync request insert returned no row");
    return {
      id: stringValue(row.id),
      githubRepositoryId: stringValue(row.github_repository_id),
      status: stringValue(row.status),
      requestedAt: iso(row.requested_at) ?? "",
    };
  });
}
