import postgres, { type Sql } from "postgres";

export * from "./github";
export * from "./interview-questions";
export * from "./public-web";

export interface CompanyRecord {
  id: string;
  canonicalName: string;
  slug: string;
  website: string | null;
  careersUrl: string | null;
  description: string | null;
  industry: string | null;
  atsType: string | null;
  atsIdentifier: string | null;
  openJobCount: number;
  earlyCareerJobCount: number;
  latestEventAt: string | null;
}

export interface JobRecord {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  title: string;
  location: string;
  roleFamily: string;
  experienceLevel: string;
  employmentType: string;
  isInternship: boolean;
  isNewGrad: boolean;
  applicationUrl: string;
  sourceUrl: string;
  sourceName: string;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  changedAt: string;
  closedAt: string | null;
  isDemo: boolean;
}

export interface EventRecord {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  jobId: string | null;
  jobTitle: string | null;
  eventType: string;
  occurredAt: string;
  discoveredAt: string;
  sourceName: string;
  sourceUrl: string;
  confidence: number;
  payload: Record<string, unknown>;
  isDemo: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ListJobsOptions {
  companyId?: string;
  roleFamily?: string;
  earlyCareerOnly?: boolean;
  includeClosed?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListEventsOptions {
  companyId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

type DatabaseRow = Record<string, unknown>;

const globalDatabase = globalThis as typeof globalThis & { recruitIntelSql?: Sql };

export function getDatabase(): Sql {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!globalDatabase.recruitIntelSql) {
    globalDatabase.recruitIntelSql = postgres(databaseUrl, {
      max: process.env.NODE_ENV === "production" ? 10 : 3,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
  }
  return globalDatabase.recruitIntelSql;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new TypeError("Expected a database timestamp");
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return 0;
  throw new TypeError("Expected a database number");
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected a database string");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError("Expected a database boolean");
}

export function mapCompany(row: DatabaseRow): CompanyRecord {
  return {
    id: stringValue(row.id),
    canonicalName: stringValue(row.canonical_name),
    slug: stringValue(row.slug),
    website: nullableString(row.website),
    careersUrl: nullableString(row.careers_url),
    description: nullableString(row.description),
    industry: nullableString(row.industry),
    atsType: nullableString(row.ats_type),
    atsIdentifier: nullableString(row.ats_identifier),
    openJobCount: numberValue(row.open_job_count),
    earlyCareerJobCount: numberValue(row.early_career_job_count),
    latestEventAt: iso(row.latest_event_at),
  };
}

export function mapJob(row: DatabaseRow): JobRecord {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    companyName: stringValue(row.company_name),
    companySlug: stringValue(row.company_slug),
    title: stringValue(row.title),
    location: stringValue(row.location),
    roleFamily: stringValue(row.role_family),
    experienceLevel: stringValue(row.experience_level),
    employmentType: stringValue(row.employment_type),
    isInternship: booleanValue(row.is_internship),
    isNewGrad: booleanValue(row.is_new_grad),
    applicationUrl: stringValue(row.application_url),
    sourceUrl: stringValue(row.source_url),
    sourceName: stringValue(row.source_name),
    publishedAt: iso(row.published_at),
    firstSeenAt: iso(row.first_seen_at) ?? "",
    lastSeenAt: iso(row.last_seen_at) ?? "",
    changedAt: iso(row.changed_at) ?? "",
    closedAt: iso(row.closed_at),
    isDemo: booleanValue(row.is_demo),
  };
}

export function mapEvent(row: DatabaseRow): EventRecord {
  return {
    id: stringValue(row.id),
    companyId: stringValue(row.company_id),
    companyName: stringValue(row.company_name),
    companySlug: stringValue(row.company_slug),
    jobId: nullableString(row.job_id),
    jobTitle: nullableString(row.job_title),
    eventType: stringValue(row.event_type),
    occurredAt: iso(row.occurred_at) ?? "",
    discoveredAt: iso(row.discovered_at) ?? "",
    sourceName: stringValue(row.source_name),
    sourceUrl: stringValue(row.source_url),
    confidence: numberValue(row.confidence),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    isDemo: booleanValue(row.is_demo),
  };
}

const companySelect = `
  select
    c.id, c.canonical_name, c.slug, c.website, c.careers_url, c.description,
    c.industry, c.ats_type, c.ats_identifier,
    count(distinct j.id) filter (where j.closed_at is null)::int as open_job_count,
    count(distinct j.id) filter (
      where j.closed_at is null and (j.is_internship or j.is_new_grad)
    )::int as early_career_job_count,
    max(e.occurred_at) as latest_event_at
  from public.companies c
  left join public.jobs j on j.company_id = c.id
  left join public.recruiting_events e on e.company_id = c.id
`;

export async function listCompanies(limit = 50, offset = 0): Promise<Page<CompanyRecord>> {
  const sql = getDatabase();
  const rows = await sql.unsafe(
    `${companySelect}
     group by c.id
     order by count(j.id) filter (where j.closed_at is null) desc, c.canonical_name
     limit $1 offset $2`,
    [limit, offset],
  );
  const [{ count = 0 } = {}] = await sql`select count(*)::int as count from public.companies`;
  return { items: rows.map(mapCompany), total: numberValue(count) };
}

export async function getCompany(identifier: string): Promise<CompanyRecord | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe(
    `${companySelect}
     where c.slug = $1 or c.id::text = $1
     group by c.id
     limit 1`,
    [identifier],
  );
  return rows[0] ? mapCompany(rows[0]) : null;
}

export async function listJobs(options: ListJobsOptions = {}): Promise<Page<JobRecord>> {
  const sql = getDatabase();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const companyId = options.companyId ?? null;
  const roleFamily = options.roleFamily ?? null;
  const earlyCareerOnly = options.earlyCareerOnly ?? false;
  const includeClosed = options.includeClosed ?? false;

  const filters = sql`
    (${companyId}::uuid is null or j.company_id = ${companyId}::uuid)
    and (${roleFamily}::text is null or j.role_family::text = ${roleFamily}::text)
    and (${earlyCareerOnly}::boolean = false or j.is_internship or j.is_new_grad)
    and (${includeClosed}::boolean = true or j.closed_at is null)
  `;

  const rows = await sql`
    select
      j.id, j.company_id, c.canonical_name as company_name, c.slug as company_slug,
      j.title, j.location, j.role_family, j.experience_level, j.employment_type,
      j.is_internship, j.is_new_grad, j.application_url, j.source_url,
      s.name as source_name, j.published_at, j.first_seen_at, j.last_seen_at,
      j.changed_at, j.closed_at, coalesce((j.raw_payload ->> 'seed')::boolean, false) as is_demo
    from public.jobs j
    join public.companies c on c.id = j.company_id
    join public.sources s on s.id = j.source_id
    where ${filters}
    order by coalesce(j.published_at, j.first_seen_at) desc, j.id
    limit ${limit} offset ${offset}
  `;
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int as count from public.jobs j where ${filters}
  `;
  return { items: rows.map(mapJob), total: numberValue(count) };
}

export async function listEvents(options: ListEventsOptions = {}): Promise<Page<EventRecord>> {
  const sql = getDatabase();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  const companyId = options.companyId ?? null;
  const eventType = options.eventType ?? null;
  const filters = sql`
    (${companyId}::uuid is null or e.company_id = ${companyId}::uuid)
    and (${eventType}::text is null or e.event_type::text = ${eventType}::text)
  `;

  const rows = await sql`
    select
      e.id, e.company_id, c.canonical_name as company_name, c.slug as company_slug,
      e.job_id, j.title as job_title, e.event_type, e.occurred_at, e.discovered_at,
      s.name as source_name, e.source_url, e.confidence, e.payload,
      coalesce((e.payload ->> 'seed')::boolean, false) as is_demo
    from public.recruiting_events e
    join public.companies c on c.id = e.company_id
    join public.sources s on s.id = e.source_id
    left join public.jobs j on j.id = e.job_id
    where ${filters}
    order by e.occurred_at desc, e.id desc
    limit ${limit} offset ${offset}
  `;
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int as count from public.recruiting_events e where ${filters}
  `;
  return { items: rows.map(mapEvent), total: numberValue(count) };
}

export async function getDashboardSummary(): Promise<{
  companies: number;
  openJobs: number;
  earlyCareerJobs: number;
  eventsSevenDays: number;
}> {
  const sql = getDatabase();
  const [row] = await sql`
    select
      (select count(*) from public.companies)::int as companies,
      (select count(*) from public.jobs where closed_at is null)::int as open_jobs,
      (
        select count(*) from public.jobs
        where closed_at is null and (is_internship or is_new_grad)
      )::int as early_career_jobs,
      (
        select count(*) from public.recruiting_events
        where discovered_at >= now() - interval '7 days'
      )::int as events_seven_days
  `;
  if (!row) throw new Error("Dashboard summary query returned no row");
  return {
    companies: numberValue(row.companies),
    openJobs: numberValue(row.open_jobs),
    earlyCareerJobs: numberValue(row.early_career_jobs),
    eventsSevenDays: numberValue(row.events_seven_days),
  };
}
