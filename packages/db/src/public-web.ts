import { createHash } from "node:crypto";

import { getDatabase, type Page } from "./index";

export interface PublicObservationSourceRecord {
  id: string;
  name: string;
  type: string;
  classification: string;
  reliability: string;
  reliabilityScore: number;
  url: string;
  candidateId: string;
  canonicalUrl: string;
  provider: string;
}

export interface PublicRecruitingObservationRecord {
  id: string;
  companyId: string;
  type: string;
  title: string;
  summary: string;
  evidenceText: string;
  occurredAt: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  datePrecision: string;
  dateCertainty: string;
  confidence: number;
  contentHash: string;
  discoveredAt: string;
  lastVerifiedAt: string;
  linkedJobId: string | null;
  linkedSchool: { id: string; name: string; slug: string } | null;
  source: PublicObservationSourceRecord;
  metadata: Record<string, unknown>;
}

export interface PublicRecruitingClaimRecord {
  id: string;
  companyId: string;
  type: string;
  title: string;
  normalizedSubject: string;
  status: string;
  preferredObservationId: string | null;
  lastVerifiedAt: string;
  confidence: number;
  supportingSourceCount: number;
  observations: PublicRecruitingObservationRecord[];
  metadata: Record<string, unknown>;
}

export interface WebSearchQueryRecord {
  id: string;
  companyId: string;
  provider: string;
  templateKey: string;
  query: string;
  roleFamily: string | null;
  school: { id: string; name: string; slug: string } | null;
  graduationYear: number | null;
  focus: string | null;
  budget: { minimumIntervalSeconds: number; maxResults: number; maxFetches: number };
  status: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastResultCount: number;
  nextAllowedRunAt: string | null;
  metadata: Record<string, unknown>;
}

export interface PublicWebWorkRequestRecord {
  id: string;
  workType: string;
  status: string;
  companyId: string;
  searchQueryId: string | null;
  candidateId: string | null;
  requestedAt: string;
}

export interface CreateWebSearchInput {
  provider: string;
  roleFamily?: string;
  school?: string;
  graduationYear?: number;
  focus: "INTERNSHIP" | "NEW_GRAD" | "BOTH";
  minimumIntervalSeconds: number;
  maxResults: number;
  maxFetches: number;
}

type Row = Record<string, unknown>;

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected a database string");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return 0;
  throw new TypeError("Expected a database number");
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return stringValue(value);
}

function dateValue(value: unknown): string | null {
  const result = iso(value);
  return result ? result.slice(0, 10) : null;
}

function mapObservation(row: Row): PublicRecruitingObservationRecord {
  const schoolId = nullableString(row.school_id);
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    type: stringValue(row.observation_type),
    title: stringValue(row.title),
    summary: stringValue(row.summary),
    evidenceText: stringValue(row.evidence_text),
    occurredAt: iso(row.occurred_at),
    dateStart: dateValue(row.date_start),
    dateEnd: dateValue(row.date_end),
    datePrecision: stringValue(row.date_precision),
    dateCertainty: stringValue(row.date_certainty),
    confidence: numberValue(row.confidence),
    contentHash: stringValue(row.content_hash),
    discoveredAt: iso(row.discovered_at) ?? "",
    lastVerifiedAt: iso(row.last_verified_at) ?? "",
    linkedJobId: nullableString(row.job_id),
    linkedSchool: schoolId
      ? {
          id: schoolId,
          name: stringValue(row.school_name),
          slug: stringValue(row.school_slug),
        }
      : null,
    source: {
      id: stringValue(row.source_id),
      name: stringValue(row.source_name),
      type: stringValue(row.source_type),
      classification: stringValue(row.source_classification),
      reliability: stringValue(row.reliability_level),
      reliabilityScore: numberValue(row.source_reliability),
      url: stringValue(row.source_url),
      candidateId: stringValue(row.candidate_id),
      canonicalUrl: stringValue(row.canonical_url),
      provider: stringValue(row.source_provider),
    },
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

const observationSelect = `
  select o.*, s.name as source_name, s.source_type, s.reliability as source_reliability,
         w.canonical_url, w.source_provider,
         sc.canonical_name as school_name, sc.slug as school_slug
  from public.public_recruiting_observations o
  join public.sources s on s.id = o.source_id
  join public.public_web_candidates w on w.id = o.candidate_id
  left join public.schools sc on sc.id = o.school_id
`;

export async function listPublicRecruitingObservations(
  companyId: string,
  options: { type?: string; limit?: number; offset?: number } = {},
): Promise<Page<PublicRecruitingObservationRecord>> {
  const sql = getDatabase();
  const type = options.type ?? null;
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const rows = await sql.unsafe(
    `${observationSelect}
     where o.company_id = $1::uuid
       and ($2::text is null or o.observation_type::text = $2::text)
     order by coalesce(o.occurred_at, o.discovered_at) desc, o.id desc
     limit $3 offset $4`,
    [companyId, type, limit, offset],
  );
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int count from public.public_recruiting_observations o
    where o.company_id = ${companyId}::uuid
      and (${type}::text is null or o.observation_type::text = ${type}::text)
  `;
  return { items: rows.map(mapObservation), total: numberValue(count) };
}

export async function getPublicRecruitingObservation(
  id: string,
): Promise<PublicRecruitingObservationRecord | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe(`${observationSelect} where o.id = $1::uuid limit 1`, [id]);
  return rows[0] ? mapObservation(rows[0]) : null;
}

function mapClaim(row: Row, observations: PublicRecruitingObservationRecord[]) {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    type: stringValue(row.claim_type),
    title: stringValue(row.title),
    normalizedSubject: stringValue(row.normalized_subject),
    status: stringValue(row.status),
    preferredObservationId: nullableString(row.preferred_observation_id),
    lastVerifiedAt: iso(row.last_verified_at) ?? "",
    confidence: numberValue(row.confidence),
    supportingSourceCount: numberValue(row.supporting_source_count),
    observations,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  } satisfies PublicRecruitingClaimRecord;
}

export async function listPublicRecruitingClaims(
  companyId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<Page<PublicRecruitingClaimRecord>> {
  const sql = getDatabase();
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const claimRows = await sql`
    select c.*,
           count(distinct o.source_id)::int as supporting_source_count
    from public.public_recruiting_claims c
    left join public.public_recruiting_claim_observations co on co.claim_id = c.id
    left join public.public_recruiting_observations o on o.id = co.observation_id
    where c.company_id = ${companyId}::uuid
    group by c.id
    order by c.last_verified_at desc, c.id desc
    limit ${limit} offset ${offset}
  `;
  const claimIds = claimRows.map((row) => stringValue(row.id));
  const observationsByClaim = new Map<string, PublicRecruitingObservationRecord[]>();
  if (claimIds.length) {
    const observationRows = await sql.unsafe(
      `select co.claim_id, evidence.* from public.public_recruiting_claim_observations co
       join (${observationSelect}) evidence on evidence.id = co.observation_id
       where co.claim_id = any($1::uuid[])
       order by evidence.last_verified_at desc, evidence.id desc`,
      [claimIds],
    );
    for (const row of observationRows) {
      const claimId = stringValue(row.claim_id);
      const items = observationsByClaim.get(claimId) ?? [];
      items.push(mapObservation(row));
      observationsByClaim.set(claimId, items);
    }
  }
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int count from public.public_recruiting_claims
    where company_id = ${companyId}::uuid
  `;
  return {
    items: claimRows.map((row) =>
      mapClaim(row, observationsByClaim.get(stringValue(row.id)) ?? []),
    ),
    total: numberValue(count),
  };
}

function mapSearchQuery(row: Row): WebSearchQueryRecord {
  const schoolId = nullableString(row.school_id);
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    provider: stringValue(row.provider),
    templateKey: stringValue(row.template_key),
    query: stringValue(row.query),
    roleFamily: nullableString(row.role_family),
    school: schoolId
      ? { id: schoolId, name: stringValue(row.school_name), slug: stringValue(row.school_slug) }
      : null,
    graduationYear: row.graduation_year === null ? null : numberValue(row.graduation_year),
    focus: nullableString(row.focus),
    budget: {
      minimumIntervalSeconds: numberValue(row.minimum_interval_seconds),
      maxResults: numberValue(row.max_results),
      maxFetches: numberValue(row.max_fetches),
    },
    status: stringValue(row.status),
    lastRunAt: iso(row.last_run_at),
    lastSuccessAt: iso(row.last_success_at),
    lastResultCount: numberValue(row.last_result_count),
    nextAllowedRunAt: iso(row.next_allowed_run_at),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function listWebSearchQueries(companyId: string): Promise<WebSearchQueryRecord[]> {
  const sql = getDatabase();
  const rows = await sql`
    select q.*, s.canonical_name as school_name, s.slug as school_slug
    from public.public_web_search_queries q
    left join public.schools s on s.id = q.school_id
    where q.company_id = ${companyId}::uuid
    order by q.template_key, q.query
  `;
  return rows.map(mapSearchQuery);
}

const roleLabels: Record<string, string> = {
  SOFTWARE_ENGINEERING: "software engineering",
  AI_ML: "machine learning",
  DATA_SCIENCE: "data science",
  DATA_ENGINEERING: "data engineering",
  PRODUCT: "product",
  DESIGN: "design",
  SECURITY: "security",
  CLOUD_DEVOPS: "cloud devops",
  QUANT: "quantitative",
  HARDWARE: "hardware",
  OTHER: "early career",
};

function generatedQueries(companyName: string, input: CreateWebSearchInput) {
  const company = `"${companyName}"`;
  const role = input.roleFamily ? roleLabels[input.roleFamily] : "software engineering";
  const year = input.graduationYear ? ` ${input.graduationYear}` : "";
  const values: Array<[string, string]> = [
    ["early-career", `${company} early career`],
    ["university-recruiting", `${company} university recruiting`],
    ["application-deadline", `${company} application deadline`],
    ["interview-experience", `${company} internship interview experience`],
    ["role", `${company} ${role} early career`],
  ];
  if (input.focus !== "NEW_GRAD") {
    values.push(
      ["internship", `${company} internship${year}`],
      ["internship-role", `${company} ${role} internship`],
      ["reddit-internship", `site:reddit.com ${company} internship`],
    );
  }
  if (input.focus !== "INTERNSHIP") values.push(["new-grad", `${company} new grad ${role}`]);
  if (input.school) {
    values.push(
      ["school", `${company} "${input.school}" recruiting`],
      ["career-fair", `${company} "${input.school}" career fair`],
    );
  }
  values.push(["github-interview", `site:github.com ${company} interview questions`]);
  return [...new Map(values.map(([key, query]) => [query.toLowerCase(), { key, query }])).values()];
}

function mapWorkRequest(row: Row): PublicWebWorkRequestRecord {
  return {
    id: stringValue(row.id),
    workType: stringValue(row.work_type),
    status: stringValue(row.status),
    companyId: stringValue(row.company_id),
    searchQueryId: nullableString(row.search_query_id),
    candidateId: nullableString(row.candidate_id),
    requestedAt: iso(row.requested_at) ?? "",
  };
}

export async function createWebSearchRequests(
  company: { id: string; canonicalName: string },
  input: CreateWebSearchInput,
): Promise<{
  requests: PublicWebWorkRequestRecord[];
  queriesGenerated: number;
  skippedByBudget: number;
}> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [source] = await transaction`
      insert into public.sources (
        company_id, source_type, provider, external_key, name, reliability, metadata,
        source_policy_id
      ) values (
        ${company.id}::uuid, 'PUBLIC_WEB', 'web_search', ${`${input.provider}:${company.id}`},
        ${`Web search: ${input.provider} / ${company.canonicalName}`}, 0.500,
        ${transaction.json({ provider: input.provider })},
        (select id from public.source_policies where provider = 'web_search')
      )
      on conflict (provider, external_key) do update set enabled = true,
        source_policy_id = coalesce(excluded.source_policy_id, public.sources.source_policy_id)
      returning id
    `;
    if (!source) throw new Error("Web search source upsert returned no row");
    let schoolId: string | null = null;
    if (input.school) {
      const [school] = await transaction`
        select id from public.schools
        where lower(canonical_name) = lower(${input.school})
           or exists (select 1 from unnest(aliases) alias where lower(alias) = lower(${input.school}))
        limit 1
      `;
      schoolId = school ? stringValue(school.id) : null;
    }
    const queries = generatedQueries(company.canonicalName, input);
    const requests: PublicWebWorkRequestRecord[] = [];
    let skippedByBudget = 0;
    for (const value of queries) {
      const [query] = await transaction`
        insert into public.public_web_search_queries (
          company_id, source_id, provider, template_key, query, role_family,
          school_id, graduation_year, focus, minimum_interval_seconds,
          max_results, max_fetches, metadata
        ) values (
          ${company.id}::uuid, ${stringValue(source.id)}::uuid, ${input.provider},
          ${value.key}, ${value.query}, ${input.roleFamily ?? null}, ${schoolId}::uuid,
          ${input.graduationYear ?? null}, ${input.focus}, ${input.minimumIntervalSeconds},
          ${input.maxResults}, ${input.maxFetches},
          ${transaction.json({ school_name: input.school ?? null })}
        )
        on conflict (company_id, provider, query) do update set
          role_family = excluded.role_family, school_id = excluded.school_id,
          graduation_year = excluded.graduation_year, focus = excluded.focus,
          minimum_interval_seconds = excluded.minimum_interval_seconds,
          max_results = excluded.max_results, max_fetches = excluded.max_fetches,
          metadata = excluded.metadata
        returning id, next_allowed_run_at, status
      `;
      if (!query) throw new Error("Web search query upsert returned no row");
      await transaction`
        insert into public.schedules (
          name, work_type, work_class, public_web_search_query_id, enabled,
          schedule_kind, interval_seconds, anchor_at, next_run_at,
          jitter_seconds, priority, max_attempts
        ) values (
          ${`public-web-search:${stringValue(query.id)}`},
          'PUBLIC_WEB_SEARCH', 'WEB_SEARCH', ${stringValue(query.id)}::uuid,
          false, 'INTERVAL', ${Math.max(input.minimumIntervalSeconds, 21_600)},
          now(), now() + make_interval(secs => ${Math.max(
            input.minimumIntervalSeconds,
            21_600,
          )}), 1800, 30, 3
        )
        on conflict (name) do update set
          interval_seconds = excluded.interval_seconds,
          jitter_seconds = excluded.jitter_seconds,
          priority = excluded.priority
      `;
      const nextAllowed = iso(query.next_allowed_run_at);
      if (nextAllowed && new Date(nextAllowed).getTime() > Date.now()) {
        skippedByBudget += 1;
        continue;
      }
      const [request] = await transaction`
        insert into public.public_web_work_requests (
          work_type, company_id, search_query_id, requested_by,
          metadata
        ) values (
          'WEB_SEARCH', ${company.id}::uuid, ${stringValue(query.id)}::uuid, 'api',
          ${transaction.json({ provider: input.provider })}
        )
        on conflict (work_type, search_query_id)
          where status in ('PENDING', 'RUNNING') and work_type = 'WEB_SEARCH'
        do update set metadata = public.public_web_work_requests.metadata
        returning *
      `;
      if (!request) throw new Error("Web search work request upsert returned no row");
      requests.push(mapWorkRequest(request));
    }
    return { requests, queriesGenerated: queries.length, skippedByBudget };
  });
}

export async function enqueueWebCandidateFetch(
  candidateId: string,
): Promise<PublicWebWorkRequestRecord | null> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [candidate] = await transaction`
      select id, company_id from public.public_web_candidates where id = ${candidateId}::uuid
    `;
    if (!candidate) return null;
    const [request] = await transaction`
      insert into public.public_web_work_requests (
        work_type, company_id, candidate_id, requested_by, metadata
      ) values (
        'WEB_FETCH', ${stringValue(candidate.company_id)}::uuid, ${candidateId}::uuid,
        'api', ${transaction.json({ manual: true })}
      )
      on conflict (work_type, candidate_id)
        where status in ('PENDING', 'RUNNING') and work_type in ('WEB_FETCH', 'WEB_PROCESS')
      do update set metadata = public.public_web_work_requests.metadata
      returning *
    `;
    if (!request) throw new Error("Web fetch work request upsert returned no row");
    return mapWorkRequest(request);
  });
}

export async function getPublicWebIntelligence(companyId: string) {
  const sql = getDatabase();
  const [counts] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where fetch_status = 'PENDING')::int as pending,
      count(*) filter (where relevance_status = 'RELEVANT')::int as relevant,
      count(*) filter (where fetch_status = 'BLOCKED')::int as blocked
    from public.public_web_candidates where company_id = ${companyId}::uuid
  `;
  const [observationCount, claimCounts, latestObservations, latestClaims] = await Promise.all([
    sql`
      select count(*)::int count from public.public_recruiting_observations
      where company_id = ${companyId}::uuid
    `,
    sql`
      select count(*)::int total,
             count(*) filter (where status = 'CONFLICTING')::int conflicting
      from public.public_recruiting_claims where company_id = ${companyId}::uuid
    `,
    listPublicRecruitingObservations(companyId, { limit: 10 }),
    listPublicRecruitingClaims(companyId, { limit: 5 }),
  ]);
  return {
    companyId,
    candidateCounts: {
      total: numberValue(counts?.total),
      pending: numberValue(counts?.pending),
      relevant: numberValue(counts?.relevant),
      blocked: numberValue(counts?.blocked),
    },
    observationCount: numberValue(observationCount[0]?.count),
    claimCounts: {
      total: numberValue(claimCounts[0]?.total),
      conflicting: numberValue(claimCounts[0]?.conflicting),
    },
    latestObservations: latestObservations.items,
    latestClaims: latestClaims.items,
  };
}

export function publicWebContractFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
