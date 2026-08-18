import { createHash } from "node:crypto";

import type { TransactionSql } from "postgres";

import { getDatabase, type Page } from "./index";

type Row = Record<string, unknown>;

export interface FreshnessRecord {
  status: "CURRENT" | "AGING" | "STALE" | "UNKNOWN";
  ageDays: number | null;
  lastVerifiedAt: string | null;
}

export interface SchoolRecord {
  id: string;
  canonicalName: string;
  slug: string;
  aliases: string[];
  domain: string | null;
  city: string | null;
  stateRegion: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecruiterEvidenceRecord {
  id: string;
  recruiterProfileId: string;
  source: { id: string; name: string; type: string; reliabilityScore: number };
  recruitingObservationId: string | null;
  sourceUrl: string;
  evidenceType: string;
  evidenceText: string;
  observedAt: string;
  publishedAt: string | null;
  contentHash: string;
  fingerprint: string;
  reliability: string;
  confidence: number;
  school: SchoolRecord | null;
  roleFamily: string | null;
  metadata: Record<string, unknown>;
}

export interface RecruiterRecord {
  id: string;
  personId: string;
  name: string;
  company: { id: string; name: string; slug: string };
  title: string;
  categories: string[];
  location: string | null;
  publicProfileUrl: string | null;
  status: string;
  confidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt: string;
  freshness: FreshnessRecord;
  schoolFocus: Array<{
    school: SchoolRecord;
    strength: string;
    reasons: string[];
    evidenceCount: number;
    confidence: number;
    status: string;
    firstObservedAt: string;
    lastObservedAt: string;
    freshness: FreshnessRecord;
  }>;
  roleFocus: Array<{
    roleFamily: string;
    strength: string;
    reasons: string[];
    evidenceCount: number;
    confidence: number;
    firstObservedAt: string;
    lastObservedAt: string;
    freshness: FreshnessRecord;
  }>;
}

export interface RecruiterDetailRecord extends RecruiterRecord {
  evidence: RecruiterEvidenceRecord[];
}

export interface CampusRecruitingEventRecord {
  id: string;
  company: { id: string; name: string; slug: string };
  school: SchoolRecord | null;
  title: string;
  eventType: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  datePrecision: string;
  dateCertainty: string;
  location: string | null;
  isVirtual: boolean;
  registrationUrl: string | null;
  source: { id: string; name: string; type: string; reliabilityScore: number };
  sourceUrl: string;
  firstSeenAt: string;
  lastVerifiedAt: string;
  freshness: FreshnessRecord;
  confidence: number;
  fingerprint: string;
  evidenceCount: number;
  metadata: Record<string, unknown>;
}

export interface CreateRecruiterInput {
  name: string;
  title: string;
  location?: string;
  publicProfileUrl?: string;
  sourceUrl: string;
  evidenceText: string;
  observedAt?: string;
  confidence: number;
  reliability: string;
  schoolIdentifiers: string[];
  roleFamilies: string[];
  metadata: Record<string, unknown>;
}

export interface CreateRecruiterEvidenceInput {
  sourceUrl: string;
  evidenceType: string;
  evidenceText: string;
  observedAt?: string;
  publishedAt?: string;
  reliability: string;
  confidence: number;
  schoolIdentifier?: string;
  roleFamily?: string;
  metadata: Record<string, unknown>;
}

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

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError("Expected a database boolean");
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function classifyFreshness(
  lastVerifiedAt: string | null,
  now = new Date(),
): FreshnessRecord {
  if (!lastVerifiedAt) return { status: "UNKNOWN", ageDays: null, lastVerifiedAt: null };
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(lastVerifiedAt).getTime()) / 86_400_000),
  );
  const status = ageDays <= 90 ? "CURRENT" : ageDays <= 180 ? "AGING" : "STALE";
  return { status, ageDays, lastVerifiedAt };
}

function mapSchool(row: Row, prefix = ""): SchoolRecord {
  const key = (name: string) => `${prefix}${name}`;
  return {
    id: stringValue(row[key("school_id")]),
    canonicalName: stringValue(row[key("school_name")]),
    slug: stringValue(row[key("school_slug")]),
    aliases: stringArray(row[key("school_aliases")]),
    domain: nullableString(row[key("school_domain")]),
    city: nullableString(row[key("school_city")]),
    stateRegion: nullableString(row[key("school_state_region")]),
    country: nullableString(row[key("school_country")]),
    createdAt: iso(row[key("school_created_at")]) ?? "",
    updatedAt: iso(row[key("school_updated_at")]) ?? "",
  };
}

const schoolColumns = `
  s.id school_id, s.canonical_name school_name, s.slug school_slug,
  coalesce(array(
    select distinct value from (
      select unnest(s.aliases) value
      union all select sa.alias from public.school_aliases sa where sa.school_id = s.id
    ) school_alias_values where btrim(value) <> '' order by value
  ), '{}') school_aliases,
  s.domains[1] school_domain, s.city school_city, s.state_region school_state_region,
  s.country school_country, s.created_at school_created_at, s.updated_at school_updated_at
`;

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSchool(value: string): string {
  return normalizeName(value.replace(/\bthe\b/gi, " ").replaceAll("&", " and "));
}

export async function listSchools(
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<Page<SchoolRecord>> {
  const sql = getDatabase();
  const query = options.query?.trim() || null;
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const rows = await sql.unsafe(
    `select ${schoolColumns} from public.schools s
     where ($1::text is null or s.canonical_name ilike '%' || $1 || '%'
       or exists (
         select 1 from public.school_aliases sa
         where sa.school_id = s.id and sa.alias ilike '%' || $1 || '%'
       ))
     order by s.canonical_name, s.id limit $2 offset $3`,
    [query, limit, offset],
  );
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int count from public.schools s
    where (${query}::text is null or s.canonical_name ilike '%' || ${query} || '%'
      or exists (
        select 1 from public.school_aliases sa
        where sa.school_id = s.id and sa.alias ilike '%' || ${query} || '%'
      ))
  `;
  return { items: rows.map((row) => mapSchool(row)), total: numberValue(count) };
}

export async function getSchool(identifier: string): Promise<SchoolRecord | null> {
  const sql = getDatabase();
  const normalized = normalizeSchool(identifier);
  const rows = await sql.unsafe(
    `select ${schoolColumns} from public.schools s
     where s.slug = $1 or s.id::text = $1 or lower(s.canonical_name) = lower($1)
       or exists (
         select 1 from public.school_aliases sa
         where sa.school_id = s.id and sa.normalized_alias = $2
       )
     order by case when s.slug = $1 or s.id::text = $1 then 0 else 1 end
     limit 2`,
    [identifier, normalized],
  );
  return rows.length === 1 ? mapSchool(rows[0] as Row) : null;
}

function mapEvidence(row: Row): RecruiterEvidenceRecord {
  const schoolId = nullableString(row.school_id);
  return {
    id: stringValue(row.id),
    recruiterProfileId: stringValue(row.recruiter_profile_id),
    source: {
      id: stringValue(row.source_id),
      name: stringValue(row.source_name),
      type: stringValue(row.source_type),
      reliabilityScore: numberValue(row.source_reliability),
    },
    recruitingObservationId: nullableString(row.public_recruiting_observation_id),
    sourceUrl: stringValue(row.source_url),
    evidenceType: stringValue(row.evidence_type),
    evidenceText: stringValue(row.evidence_text),
    observedAt: iso(row.observed_at) ?? "",
    publishedAt: iso(row.published_at),
    contentHash: stringValue(row.content_hash),
    fingerprint: stringValue(row.fingerprint),
    reliability: stringValue(row.reliability),
    confidence: numberValue(row.confidence),
    school: schoolId ? mapSchool(row) : null,
    roleFamily: nullableString(row.role_family),
    metadata: jsonObject(row.metadata),
  };
}

const evidenceSelect = `
  select e.*, e.evidence_type::text evidence_type, e.reliability::text reliability,
         e.role_family::text role_family, source.name source_name,
         source.source_type::text source_type, source.reliability source_reliability,
         ${schoolColumns}
  from public.recruiter_evidence e
  join public.sources source on source.id = e.source_id
  left join public.schools s on s.id = e.school_id
`;

export async function listRecruiterEvidence(
  recruiterId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<Page<RecruiterEvidenceRecord>> {
  const sql = getDatabase();
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const rows = await sql.unsafe(
    `${evidenceSelect}
     where e.recruiter_profile_id = $1::uuid
     order by e.observed_at desc, e.id desc limit $2 offset $3`,
    [recruiterId, limit, offset],
  );
  const [{ count = 0 } = {}] = await sql`
    select count(*)::int count from public.recruiter_evidence
    where recruiter_profile_id = ${recruiterId}::uuid
  `;
  return { items: rows.map(mapEvidence), total: numberValue(count) };
}

async function hydrateRecruiters(rows: Row[]): Promise<RecruiterRecord[]> {
  if (!rows.length) return [];
  const sql = getDatabase();
  const ids = rows.map((row) => stringValue(row.id));
  const [schoolRows, roleRows] = await Promise.all([
    sql.unsafe(
      `select rs.*, rs.strength::text strength, rs.status::text relationship_status,
              ${schoolColumns}
       from public.recruiter_school_relationships rs
       join public.schools s on s.id = rs.school_id
       where rs.recruiter_profile_id = any($1::uuid[])
       order by rs.strength, rs.last_seen_at desc, rs.id`,
      [ids],
    ),
    sql.unsafe(
      `select rf.*, rf.role_family::text role_family, rf.strength::text strength
       from public.recruiter_role_focus rf
       where rf.recruiter_profile_id = any($1::uuid[])
       order by rf.strength, rf.last_seen_at desc, rf.id`,
      [ids],
    ),
  ]);
  const schools = new Map<string, RecruiterRecord["schoolFocus"]>();
  for (const row of schoolRows) {
    const recruiterId = stringValue(row.recruiter_profile_id);
    const values = schools.get(recruiterId) ?? [];
    const lastObservedAt = iso(row.last_seen_at) ?? "";
    const freshness = classifyFreshness(lastObservedAt);
    const storedStatus = stringValue(row.relationship_status);
    values.push({
      school: mapSchool(row),
      strength: stringValue(row.strength),
      reasons: stringArray(row.strength_reasons),
      evidenceCount: numberValue(row.evidence_count),
      confidence: numberValue(row.confidence),
      status: freshness.status === "STALE" && storedStatus === "ACTIVE" ? "STALE" : storedStatus,
      firstObservedAt: iso(row.first_seen_at) ?? "",
      lastObservedAt,
      freshness,
    });
    schools.set(recruiterId, values);
  }
  const roles = new Map<string, RecruiterRecord["roleFocus"]>();
  for (const row of roleRows) {
    const recruiterId = stringValue(row.recruiter_profile_id);
    const values = roles.get(recruiterId) ?? [];
    const lastObservedAt = iso(row.last_seen_at) ?? "";
    values.push({
      roleFamily: stringValue(row.role_family),
      strength: stringValue(row.strength),
      reasons: stringArray(row.strength_reasons),
      evidenceCount: numberValue(row.evidence_count),
      confidence: numberValue(row.confidence),
      firstObservedAt: iso(row.first_seen_at) ?? "",
      lastObservedAt,
      freshness: classifyFreshness(lastObservedAt),
    });
    roles.set(recruiterId, values);
  }
  return rows.map((row) => {
    const id = stringValue(row.id);
    const lastVerifiedAt = iso(row.last_verified_at) ?? "";
    const freshness = classifyFreshness(lastVerifiedAt);
    const storedStatus = stringValue(row.profile_status);
    return {
      id,
      personId: stringValue(row.person_id),
      name: stringValue(row.canonical_name),
      company: {
        id: stringValue(row.company_id),
        name: stringValue(row.company_name),
        slug: stringValue(row.company_slug),
      },
      title: stringValue(row.title),
      categories: stringArray(row.categories_text),
      location: nullableString(row.location),
      publicProfileUrl: nullableString(row.public_profile_url),
      status: freshness.status === "STALE" && storedStatus === "ACTIVE" ? "STALE" : storedStatus,
      confidence: numberValue(row.confidence),
      firstSeenAt: iso(row.first_seen_at) ?? "",
      lastSeenAt: iso(row.last_seen_at) ?? "",
      lastVerifiedAt,
      freshness,
      schoolFocus: schools.get(id) ?? [],
      roleFocus: roles.get(id) ?? [],
    };
  });
}

const recruiterSelect = `
  select rp.*, rp.categories::text[] categories_text, rp.status::text profile_status,
         p.canonical_name, c.canonical_name company_name, c.slug company_slug
  from public.recruiter_profiles rp
  join public.people p on p.id = rp.person_id
  join public.companies c on c.id = rp.company_id
`;

export async function listCompanyRecruiters(
  companyId: string,
  options: {
    category?: string;
    roleFamily?: string;
    schoolId?: string;
    includeStale?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<Page<RecruiterRecord>> {
  const sql = getDatabase();
  const category = options.category ?? null;
  const roleFamily = options.roleFamily ?? null;
  const schoolId = options.schoolId ?? null;
  const includeStale = options.includeStale ?? true;
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const where = `
    rp.company_id = $1::uuid
    and ($2::text is null or $2::public.recruiter_role_category = any(rp.categories))
    and ($3::text is null or exists (
      select 1 from public.recruiter_role_focus rf
      where rf.recruiter_profile_id = rp.id and rf.role_family::text = $3
    ))
    and ($4::uuid is null or exists (
      select 1 from public.recruiter_school_relationships rs
      where rs.recruiter_profile_id = rp.id and rs.school_id = $4::uuid
    ))
    and ($5::boolean or (
      rp.status not in ('STALE', 'INACTIVE') and rp.last_verified_at >= now() - interval '180 days'
    ))
  `;
  const values = [companyId, category, roleFamily, schoolId, includeStale];
  const rows = await sql.unsafe(
    `${recruiterSelect} where ${where}
     order by rp.last_verified_at desc, rp.id limit $6 offset $7`,
    [...values, limit, offset],
  );
  const countRows = await sql.unsafe(
    `select count(*)::int count from public.recruiter_profiles rp where ${where}`,
    values,
  );
  return { items: await hydrateRecruiters(rows), total: numberValue(countRows[0]?.count) };
}

export async function getRecruiter(id: string): Promise<RecruiterDetailRecord | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe(`${recruiterSelect} where rp.id = $1::uuid limit 1`, [id]);
  if (!rows[0]) return null;
  const [recruiter] = await hydrateRecruiters([rows[0]]);
  if (!recruiter) return null;
  const evidence = await listRecruiterEvidence(id);
  return { ...recruiter, evidence: evidence.items };
}

function mapCampusEvent(row: Row): CampusRecruitingEventRecord {
  const schoolId = nullableString(row.school_id);
  const lastVerifiedAt = iso(row.last_verified_at) ?? "";
  return {
    id: stringValue(row.id),
    company: {
      id: stringValue(row.company_id),
      name: stringValue(row.company_name),
      slug: stringValue(row.company_slug),
    },
    school: schoolId ? mapSchool(row) : null,
    title: stringValue(row.title),
    eventType: stringValue(row.event_type),
    description: stringValue(row.description),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    dateStart: dateValue(row.date_start),
    dateEnd: dateValue(row.date_end),
    datePrecision: stringValue(row.date_precision),
    dateCertainty: stringValue(row.date_certainty),
    location: nullableString(row.location),
    isVirtual: booleanValue(row.is_virtual),
    registrationUrl: nullableString(row.registration_url),
    source: {
      id: stringValue(row.source_id),
      name: stringValue(row.source_name),
      type: stringValue(row.source_type),
      reliabilityScore: numberValue(row.source_reliability),
    },
    sourceUrl: stringValue(row.source_url),
    firstSeenAt: iso(row.first_seen_at) ?? "",
    lastVerifiedAt,
    freshness: classifyFreshness(lastVerifiedAt),
    confidence: numberValue(row.confidence),
    fingerprint: stringValue(row.fingerprint),
    evidenceCount: Math.max(1, numberValue(row.evidence_count)),
    metadata: jsonObject(row.metadata),
  };
}

const campusEventSelect = `
  select ce.*, ce.event_type::text event_type, ce.date_precision::text date_precision,
         ce.date_certainty::text date_certainty, c.canonical_name company_name,
         c.slug company_slug, source.name source_name, source.source_type::text source_type,
         source.reliability source_reliability, ${schoolColumns},
         count(distinct event_evidence.public_recruiting_observation_id)::int evidence_count
  from public.campus_recruiting_events ce
  join public.companies c on c.id = ce.company_id
  join public.sources source on source.id = ce.source_id
  left join public.schools s on s.id = ce.school_id
  left join public.campus_recruiting_event_evidence event_evidence
    on event_evidence.campus_event_id = ce.id
`;

async function listCampusEvents(
  filter: "company" | "school",
  id: string,
  options: { eventType?: string; includePast?: boolean; limit?: number; offset?: number } = {},
): Promise<Page<CampusRecruitingEventRecord>> {
  const sql = getDatabase();
  const eventType = options.eventType ?? null;
  const includePast = options.includePast ?? true;
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const idColumn = filter === "company" ? "ce.company_id" : "ce.school_id";
  const where = `${idColumn} = $1::uuid
    and ($2::text is null or ce.event_type::text = $2)
    and ($3::boolean or coalesce(ce.date_end, ce.date_start, ce.starts_at::date) >= current_date)`;
  const rows = await sql.unsafe(
    `${campusEventSelect} where ${where}
     group by ce.id, c.id, source.id, s.id
     order by coalesce(ce.starts_at, ce.date_start::timestamptz, ce.first_seen_at) desc, ce.id
     limit $4 offset $5`,
    [id, eventType, includePast, limit, offset],
  );
  const countRows = await sql.unsafe(
    `select count(*)::int count from public.campus_recruiting_events ce where ${where}`,
    [id, eventType, includePast],
  );
  return { items: rows.map(mapCampusEvent), total: numberValue(countRows[0]?.count) };
}

export async function listCompanyCampusEvents(
  companyId: string,
  options: { eventType?: string; includePast?: boolean; limit?: number; offset?: number } = {},
) {
  return listCampusEvents("company", companyId, options);
}

export async function listSchoolCampusEvents(
  schoolId: string,
  options: { eventType?: string; includePast?: boolean; limit?: number; offset?: number } = {},
) {
  return listCampusEvents("school", schoolId, options);
}

export async function listSchoolRecruiters(
  schoolId: string,
  options: { includeStale?: boolean; limit?: number; offset?: number } = {},
): Promise<Page<RecruiterRecord>> {
  const sql = getDatabase();
  const includeStale = options.includeStale ?? true;
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const where = `exists (
      select 1 from public.recruiter_school_relationships rs
      where rs.recruiter_profile_id = rp.id and rs.school_id = $1::uuid
    ) and ($2::boolean or (
      rp.status not in ('STALE', 'INACTIVE') and rp.last_verified_at >= now() - interval '180 days'
    ))`;
  const rows = await sql.unsafe(
    `${recruiterSelect} where ${where}
     order by rp.last_verified_at desc, rp.id limit $3 offset $4`,
    [schoolId, includeStale, limit, offset],
  );
  const countRows = await sql.unsafe(
    `select count(*)::int count from public.recruiter_profiles rp where ${where}`,
    [schoolId, includeStale],
  );
  return { items: await hydrateRecruiters(rows), total: numberValue(countRows[0]?.count) };
}

export async function listSchoolCompanies(
  schoolId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<
  Page<{
    company: { id: string; name: string; slug: string };
    recruiterCount: number;
    campusEventCount: number;
    lastObservedAt: string;
  }>
> {
  const sql = getDatabase();
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const rows = await sql`
    with recruiter_facts as (
      select rp.company_id, rp.id recruiter_id, null::uuid event_id, rs.last_seen_at observed_at
      from public.recruiter_school_relationships rs
      join public.recruiter_profiles rp on rp.id = rs.recruiter_profile_id
      where rs.school_id = ${schoolId}::uuid
    ), event_facts as (
      select ce.company_id, null::uuid recruiter_id, ce.id event_id,
             ce.last_verified_at observed_at
      from public.campus_recruiting_events ce where ce.school_id = ${schoolId}::uuid
    ), facts as (select * from recruiter_facts union all select * from event_facts)
    select c.id, c.canonical_name, c.slug,
           count(distinct facts.recruiter_id)::int recruiter_count,
           count(distinct facts.event_id)::int campus_event_count,
           max(facts.observed_at) last_observed_at
    from facts join public.companies c on c.id = facts.company_id
    group by c.id order by max(facts.observed_at) desc, c.canonical_name
    limit ${limit} offset ${offset}
  `;
  const [{ count = 0 } = {}] = await sql`
    select count(distinct company_id)::int count from (
      select rp.company_id from public.recruiter_school_relationships rs
      join public.recruiter_profiles rp on rp.id = rs.recruiter_profile_id
      where rs.school_id = ${schoolId}::uuid
      union
      select company_id from public.campus_recruiting_events where school_id = ${schoolId}::uuid
    ) school_companies
  `;
  return {
    items: rows.map((row) => ({
      company: {
        id: stringValue(row.id),
        name: stringValue(row.canonical_name),
        slug: stringValue(row.slug),
      },
      recruiterCount: numberValue(row.recruiter_count),
      campusEventCount: numberValue(row.campus_event_count),
      lastObservedAt: iso(row.last_observed_at) ?? "",
    })),
    total: numberValue(count),
  };
}

const reliabilityScores: Record<string, number> = {
  OFFICIAL: 0.95,
  HIGH: 0.85,
  MEDIUM: 0.65,
  LOW: 0.35,
  UNKNOWN: 0.5,
};

export function classifyRecruiterTitle(title: string): string[] {
  const rules: Array<[string, RegExp]> = [
    ["UNIVERSITY_RECRUITING", /\b(?:university recruit(?:er|ing)|university relations)\b/i],
    ["EARLY_CAREER", /\b(?:early career(?:s)?|early talent)\b/i],
    ["TECHNICAL_RECRUITING", /\btechnical recruit(?:er|ing)\b/i],
    ["TALENT_ACQUISITION", /\btalent acquisition(?: partner)?\b/i],
    ["CAMPUS_PROGRAMS", /\b(?:campus recruit(?:er|ing)|campus programs?)\b/i],
    ["UNIVERSITY_PROGRAMS", /\buniversity programs?\b/i],
    ["EMERGING_TALENT", /\bemerging talent\b/i],
    ["GENERAL_RECRUITING", /\b(?:recruiter|recruiting|talent partner)\b/i],
  ];
  const matched = rules.filter(([, pattern]) => pattern.test(title)).map(([category]) => category);
  const specific = matched.filter((value) => value !== "GENERAL_RECRUITING");
  return specific.length ? specific : matched.length ? matched : ["OTHER"];
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function splitName(value: string): [string | null, string | null] {
  const parts = value.normalize("NFKC").trim().split(/\s+/);
  return [parts[0] ?? null, parts.length > 1 ? (parts.at(-1) ?? null) : null];
}

async function resolveSchoolId(
  transaction: TransactionSql,
  identifier: string,
): Promise<string | null> {
  const normalized = normalizeSchool(identifier);
  const rows = await transaction`
    select s.id from public.schools s
    where s.slug = ${identifier} or s.id::text = ${identifier}
       or lower(s.canonical_name) = lower(${identifier})
       or exists (
         select 1 from public.school_aliases sa
         where sa.school_id = s.id and sa.normalized_alias = ${normalized}
       )
    limit 2
  `;
  return rows.length === 1 ? stringValue(rows[0]?.id) : null;
}

async function manualSource(
  transaction: TransactionSql,
  companyId: string,
  sourceUrl: string,
  reliability: string,
) {
  const sourceKey = hash({ version: 1, companyId, sourceUrl });
  const [source] = await transaction`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, base_url, reliability, metadata
    ) values (
      ${companyId}::uuid, 'MANUAL', 'manual', ${sourceKey}, 'Manual recruiter evidence',
      ${sourceUrl}, ${reliabilityScores[reliability] ?? 0.5},
      ${transaction.json({ user_supplied: true, fetched: false })}
    )
    on conflict (provider, external_key) do update set
      reliability = greatest(public.sources.reliability, excluded.reliability), enabled = true
    returning id
  `;
  if (!source) throw new Error("Manual source upsert returned no row");
  return stringValue(source.id);
}

async function insertUnresolvedSchool(
  transaction: TransactionSql,
  input: {
    companyId: string;
    sourceId: string;
    sourceUrl: string;
    evidenceText: string;
    observedAt: string;
    schoolIdentifier: string;
    metadata: Record<string, unknown>;
  },
) {
  const contentHash = hash(input.evidenceText);
  const fingerprint = hash({
    version: 1,
    sourceId: input.sourceId,
    reason: "UNKNOWN_SCHOOL",
    school: normalizeSchool(input.schoolIdentifier),
    contentHash,
  });
  await transaction`
    insert into public.unresolved_recruiter_observations (
      company_id, source_id, raw_school_name, reason, source_url, evidence_text,
      observed_at, content_hash, fingerprint, metadata
    ) values (
      ${input.companyId}::uuid, ${input.sourceId}::uuid, ${input.schoolIdentifier},
      'UNKNOWN_SCHOOL', ${input.sourceUrl}, ${input.evidenceText}, ${input.observedAt},
      ${contentHash}, ${fingerprint},
      ${transaction.json({ ...input.metadata, manual: true })}
    ) on conflict (fingerprint) do nothing
  `;
}

function relationshipDecision(row: Row) {
  const reliability = stringValue(row.reliability);
  const sourceCount = numberValue(row.source_count);
  const lastObservedAt = iso(row.last_observed_at) ?? "";
  const titleMatch = booleanValue(row.title_match);
  let points = { OFFICIAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0, UNKNOWN: 0 }[reliability] ?? 0;
  const reasons = [`source_reliability:${reliability.toLowerCase()}`];
  if (sourceCount >= 3) {
    points += 3;
    reasons.push("three_or_more_independent_sources");
  } else if (sourceCount === 2) {
    points += 2;
    reasons.push("two_independent_sources");
  } else {
    reasons.push("single_source");
  }
  points += 2;
  reasons.push("explicit_relationship_mention");
  if (titleMatch) {
    points += 1;
    reasons.push("recruiting_title_match");
  }
  const freshness = classifyFreshness(lastObservedAt);
  if (freshness.status === "CURRENT") {
    points += 1;
    reasons.push("verified_within_90_days");
  } else if (freshness.status === "STALE") {
    reasons.push("evidence_older_than_180_days");
  }
  const strength =
    points >= 7 ? "HIGH" : points >= 5 ? "MEDIUM" : points >= 3 ? "LOW" : "LIMITED_EVIDENCE";
  return { strength, reasons, lastObservedAt, freshness };
}

async function refreshSchoolRelationship(
  transaction: TransactionSql,
  profileId: string,
  schoolId: string,
  evidenceId: string,
  observedAt: string,
) {
  const [relationship] = await transaction`
    insert into public.recruiter_school_relationships (
      recruiter_profile_id, school_id, first_seen_at, last_seen_at, confidence, evidence_count
    ) values (${profileId}::uuid, ${schoolId}::uuid, ${observedAt}, ${observedAt}, 0, 0)
    on conflict (recruiter_profile_id, school_id) do update set
      last_seen_at = greatest(public.recruiter_school_relationships.last_seen_at, excluded.last_seen_at)
    returning id
  `;
  if (!relationship) throw new Error("Recruiter-school upsert returned no row");
  const relationshipId = stringValue(relationship.id);
  await transaction`
    insert into public.recruiter_school_evidence (relationship_id, evidence_id)
    values (${relationshipId}::uuid, ${evidenceId}::uuid) on conflict do nothing
  `;
  const [aggregate] = await transaction`
    select count(*)::int evidence_count, count(distinct e.source_id)::int source_count,
           max(e.confidence) confidence, max(e.observed_at) last_observed_at,
           (array_agg(e.reliability::text order by case e.reliability::text
             when 'OFFICIAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3
             when 'LOW' then 2 else 1 end desc))[1] reliability,
           bool_or(coalesce((e.metadata ->> 'title_match')::boolean, false)) title_match
    from public.recruiter_school_evidence link
    join public.recruiter_evidence e on e.id = link.evidence_id
    where link.relationship_id = ${relationshipId}::uuid
  `;
  if (!aggregate) throw new Error("Recruiter-school aggregation returned no row");
  const decision = relationshipDecision(aggregate);
  const status =
    decision.freshness.status === "STALE"
      ? "STALE"
      : ["HIGH", "MEDIUM"].includes(decision.strength)
        ? "ACTIVE"
        : "UNVERIFIED";
  await transaction`
    update public.recruiter_school_relationships set
      last_seen_at = ${decision.lastObservedAt}, confidence = ${numberValue(aggregate.confidence)},
      evidence_count = ${numberValue(aggregate.evidence_count)},
      strength = ${decision.strength}, strength_reasons = ${decision.reasons}, status = ${status}
    where id = ${relationshipId}::uuid
  `;
}

async function refreshRoleFocus(
  transaction: TransactionSql,
  profileId: string,
  roleFamily: string,
  evidenceId: string,
  observedAt: string,
) {
  const [focus] = await transaction`
    insert into public.recruiter_role_focus (
      recruiter_profile_id, role_family, first_seen_at, last_seen_at, evidence_count, confidence
    ) values (${profileId}::uuid, ${roleFamily}, ${observedAt}, ${observedAt}, 0, 0)
    on conflict (recruiter_profile_id, role_family) do update set
      last_seen_at = greatest(public.recruiter_role_focus.last_seen_at, excluded.last_seen_at)
    returning id
  `;
  if (!focus) throw new Error("Recruiter-role upsert returned no row");
  const focusId = stringValue(focus.id);
  await transaction`
    insert into public.recruiter_role_evidence (role_focus_id, evidence_id)
    values (${focusId}::uuid, ${evidenceId}::uuid) on conflict do nothing
  `;
  const [aggregate] = await transaction`
    select count(*)::int evidence_count, count(distinct e.source_id)::int source_count,
           max(e.confidence) confidence, max(e.observed_at) last_observed_at,
           (array_agg(e.reliability::text order by case e.reliability::text
             when 'OFFICIAL' then 5 when 'HIGH' then 4 when 'MEDIUM' then 3
             when 'LOW' then 2 else 1 end desc))[1] reliability,
           bool_or(coalesce((e.metadata ->> 'title_match')::boolean, false)) title_match
    from public.recruiter_role_evidence link
    join public.recruiter_evidence e on e.id = link.evidence_id
    where link.role_focus_id = ${focusId}::uuid
  `;
  if (!aggregate) throw new Error("Recruiter-role aggregation returned no row");
  const decision = relationshipDecision(aggregate);
  await transaction`
    update public.recruiter_role_focus set
      last_seen_at = ${decision.lastObservedAt}, confidence = ${numberValue(aggregate.confidence)},
      evidence_count = ${numberValue(aggregate.evidence_count)},
      strength = ${decision.strength}, strength_reasons = ${decision.reasons}
    where id = ${focusId}::uuid
  `;
}

async function insertManualEvidence(
  transaction: TransactionSql,
  input: {
    profileId: string;
    sourceId: string;
    sourceUrl: string;
    evidenceType: string;
    evidenceText: string;
    observedAt: string;
    publishedAt?: string;
    reliability: string;
    confidence: number;
    schoolId: string | null;
    roleFamily: string | null;
    metadata: Record<string, unknown>;
    titleMatch: boolean;
  },
) {
  const contentHash = hash(input.evidenceText);
  const fingerprint = hash({
    version: 1,
    profileId: input.profileId,
    sourceId: input.sourceId,
    evidenceType: input.evidenceType,
    contentHash,
    schoolId: input.schoolId,
    roleFamily: input.roleFamily,
  });
  const [inserted] = await transaction`
    insert into public.recruiter_evidence (
      recruiter_profile_id, source_id, school_id, role_family, source_url, evidence_type,
      evidence_text, observed_at, published_at, content_hash, fingerprint, reliability,
      confidence, metadata
    ) values (
      ${input.profileId}::uuid, ${input.sourceId}::uuid, ${input.schoolId}::uuid,
      ${input.roleFamily}, ${input.sourceUrl}, ${input.evidenceType}, ${input.evidenceText},
      ${input.observedAt}, ${input.publishedAt ?? null}, ${contentHash}, ${fingerprint},
      ${input.reliability}, ${input.confidence},
      ${transaction.json({ ...input.metadata, manual: true, title_match: input.titleMatch, explicit_relationship: true })}
    ) on conflict (fingerprint) do nothing returning id
  `;
  const evidence =
    inserted ??
    (
      await transaction`
    select id from public.recruiter_evidence where fingerprint = ${fingerprint}
  `
    )[0];
  if (!evidence) throw new Error("Manual recruiter evidence resolution failed");
  const evidenceId = stringValue(evidence.id);
  if (input.schoolId) {
    await refreshSchoolRelationship(
      transaction,
      input.profileId,
      input.schoolId,
      evidenceId,
      input.observedAt,
    );
  }
  if (input.roleFamily) {
    await refreshRoleFocus(
      transaction,
      input.profileId,
      input.roleFamily,
      evidenceId,
      input.observedAt,
    );
  }
  return { evidenceId, created: Boolean(inserted), fingerprint };
}

async function insertRecruitingEvent(
  transaction: TransactionSql,
  input: {
    companyId: string;
    sourceId: string;
    profileId: string;
    schoolId?: string | null;
    eventType: "RECRUITER_DISCOVERED" | "RECRUITER_ACTIVITY" | "SCHOOL_RECRUITING_SIGNAL";
    observedAt: string;
    sourceUrl: string;
    confidence: number;
    causalKey: string;
    payload: Record<string, unknown>;
  },
) {
  const fingerprint = hash({
    version: 1,
    companyId: input.companyId,
    sourceId: input.sourceId,
    eventType: input.eventType,
    causalKey: input.causalKey,
  });
  await transaction`
    insert into public.recruiting_events (
      company_id, source_id, event_type, occurred_at, discovered_at, source_url,
      confidence, fingerprint, payload, recruiter_profile_id, school_id
    ) values (
      ${input.companyId}::uuid, ${input.sourceId}::uuid, ${input.eventType},
      ${input.observedAt}, ${input.observedAt}, ${input.sourceUrl}, ${input.confidence},
      ${fingerprint}, ${transaction.json(input.payload as never)}, ${input.profileId}::uuid,
      ${input.schoolId ?? null}::uuid
    ) on conflict (fingerprint) do nothing
  `;
}

export async function createManualRecruiter(
  companyId: string,
  input: CreateRecruiterInput,
): Promise<RecruiterDetailRecord> {
  const sql = getDatabase();
  const profileId = await sql.begin(async (transaction) => {
    const observedAt = input.observedAt ?? new Date().toISOString();
    const normalizedName = normalizeName(input.name);
    const normalizedTitle = normalizeName(input.title);
    const categories = classifyRecruiterTitle(input.title);
    const sourceId = await manualSource(transaction, companyId, input.sourceUrl, input.reliability);
    let people = [] as Row[];
    if (input.publicProfileUrl) {
      people = await transaction`
        select distinct rp.person_id id from public.recruiter_profiles rp
        where lower(rp.public_profile_url) = lower(${input.publicProfileUrl}) limit 2
      `;
    }
    let personId = people.length === 1 ? stringValue(people[0]?.id) : null;
    const profiles = await transaction`
      select rp.id, rp.person_id from public.recruiter_profiles rp
      join public.people p on p.id = rp.person_id
      where rp.company_id = ${companyId}::uuid and p.normalized_name = ${normalizedName}
      order by rp.id limit 2
    `;
    if (profiles.length > 1) throw new Error("Ambiguous exact recruiter identity");
    let createdProfile = false;
    let resolvedProfileId = profiles[0] ? stringValue(profiles[0].id) : null;
    if (!resolvedProfileId) {
      if (!personId) {
        const [firstName, lastName] = splitName(input.name);
        const [person] = await transaction`
          insert into public.people (canonical_name, normalized_name, first_name, last_name)
          values (${input.name.trim()}, ${normalizedName}, ${firstName}, ${lastName}) returning id
        `;
        if (!person) throw new Error("Person insert returned no row");
        personId = stringValue(person.id);
      }
      const [profile] = await transaction`
        insert into public.recruiter_profiles (
          person_id, company_id, title, normalized_title, categories, location,
          public_profile_url, source_id, first_seen_at, last_seen_at, last_verified_at,
          confidence, status, metadata
        ) values (
          ${personId}::uuid, ${companyId}::uuid, ${input.title.trim()}, ${normalizedTitle},
          ${categories}, ${input.location ?? null}, ${input.publicProfileUrl ?? null},
          ${sourceId}::uuid, ${observedAt}, ${observedAt}, ${observedAt}, ${input.confidence},
          'UNVERIFIED', ${transaction.json({ ...input.metadata, manual: true })}
        ) returning id
      `;
      if (!profile) throw new Error("Recruiter profile insert returned no row");
      resolvedProfileId = stringValue(profile.id);
      createdProfile = true;
    } else {
      await transaction`
        update public.recruiter_profiles set
          last_seen_at = greatest(last_seen_at, ${observedAt}),
          last_verified_at = greatest(last_verified_at, ${observedAt}),
          location = coalesce(${input.location ?? null}, location),
          public_profile_url = coalesce(${input.publicProfileUrl ?? null}, public_profile_url),
          categories = (
            select array_agg(distinct value)::public.recruiter_role_category[]
            from unnest(categories || ${categories}::public.recruiter_role_category[]) value
          ),
          confidence = greatest(confidence, ${input.confidence})
        where id = ${resolvedProfileId}::uuid
      `;
    }
    const schoolIds: string[] = [];
    for (const identifier of input.schoolIdentifiers) {
      const schoolId = await resolveSchoolId(transaction, identifier);
      if (schoolId) schoolIds.push(schoolId);
      else {
        await insertUnresolvedSchool(transaction, {
          companyId,
          sourceId,
          sourceUrl: input.sourceUrl,
          evidenceText: input.evidenceText,
          observedAt,
          schoolIdentifier: identifier,
          metadata: input.metadata,
        });
      }
    }
    const specifications: Array<{
      evidenceType: string;
      schoolId: string | null;
      roleFamily: string | null;
    }> = [
      ...schoolIds.map((schoolId) => ({
        evidenceType: "SCHOOL_CONNECTION",
        schoolId,
        roleFamily: null,
      })),
      ...input.roleFamilies.map((roleFamily) => ({
        evidenceType: "ROLE_FOCUS",
        schoolId: null,
        roleFamily,
      })),
    ];
    if (!specifications.length) {
      specifications.push({ evidenceType: "EMPLOYMENT", schoolId: null, roleFamily: null });
    }
    for (const specification of specifications) {
      const evidence = await insertManualEvidence(transaction, {
        profileId: resolvedProfileId,
        sourceId,
        sourceUrl: input.sourceUrl,
        evidenceType: specification.evidenceType,
        evidenceText: input.evidenceText,
        observedAt,
        reliability: input.reliability,
        confidence: input.confidence,
        schoolId: specification.schoolId,
        roleFamily: specification.roleFamily,
        metadata: input.metadata,
        titleMatch: categories.some((value) => value !== "OTHER"),
      });
      if (evidence.created && !createdProfile) {
        await insertRecruitingEvent(transaction, {
          companyId,
          sourceId,
          profileId: resolvedProfileId,
          schoolId: specification.schoolId,
          eventType: specification.schoolId ? "SCHOOL_RECRUITING_SIGNAL" : "RECRUITER_ACTIVITY",
          observedAt,
          sourceUrl: input.sourceUrl,
          confidence: input.confidence,
          causalKey: evidence.fingerprint,
          payload: { evidenceType: specification.evidenceType },
        });
      }
    }
    if (createdProfile) {
      await insertRecruitingEvent(transaction, {
        companyId,
        sourceId,
        profileId: resolvedProfileId,
        eventType: "RECRUITER_DISCOVERED",
        observedAt,
        sourceUrl: input.sourceUrl,
        confidence: input.confidence,
        causalKey: `profile:${resolvedProfileId}`,
        payload: { title: input.title, categories },
      });
    }
    return resolvedProfileId;
  });
  const recruiter = await getRecruiter(profileId);
  if (!recruiter) throw new Error("Created recruiter could not be read");
  return recruiter;
}

export async function addManualRecruiterEvidence(
  recruiterId: string,
  input: CreateRecruiterEvidenceInput,
): Promise<RecruiterDetailRecord | null> {
  const sql = getDatabase();
  const found = await sql.begin(async (transaction) => {
    const [profile] = await transaction`
      select rp.id, rp.company_id, rp.title from public.recruiter_profiles rp
      where rp.id = ${recruiterId}::uuid
    `;
    if (!profile) return false;
    const companyId = stringValue(profile.company_id);
    const observedAt = input.observedAt ?? new Date().toISOString();
    const sourceId = await manualSource(transaction, companyId, input.sourceUrl, input.reliability);
    let schoolId: string | null = null;
    if (input.schoolIdentifier) {
      schoolId = await resolveSchoolId(transaction, input.schoolIdentifier);
      if (!schoolId) {
        await insertUnresolvedSchool(transaction, {
          companyId,
          sourceId,
          sourceUrl: input.sourceUrl,
          evidenceText: input.evidenceText,
          observedAt,
          schoolIdentifier: input.schoolIdentifier,
          metadata: input.metadata,
        });
      }
    }
    const titleMatch = classifyRecruiterTitle(stringValue(profile.title)).some(
      (value) => value !== "OTHER",
    );
    const evidence = await insertManualEvidence(transaction, {
      profileId: recruiterId,
      sourceId,
      sourceUrl: input.sourceUrl,
      evidenceType: input.evidenceType,
      evidenceText: input.evidenceText,
      observedAt,
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      reliability: input.reliability,
      confidence: input.confidence,
      schoolId,
      roleFamily: input.roleFamily ?? null,
      metadata: input.metadata,
      titleMatch,
    });
    await transaction`
      update public.recruiter_profiles set
        last_seen_at = greatest(last_seen_at, ${observedAt}),
        last_verified_at = greatest(last_verified_at, ${observedAt}),
        confidence = greatest(confidence, ${input.confidence})
      where id = ${recruiterId}::uuid
    `;
    if (evidence.created) {
      await insertRecruitingEvent(transaction, {
        companyId,
        sourceId,
        profileId: recruiterId,
        schoolId,
        eventType: schoolId ? "SCHOOL_RECRUITING_SIGNAL" : "RECRUITER_ACTIVITY",
        observedAt,
        sourceUrl: input.sourceUrl,
        confidence: input.confidence,
        causalKey: evidence.fingerprint,
        payload: { evidenceType: input.evidenceType, roleFamily: input.roleFamily ?? null },
      });
    }
    return true;
  });
  return found ? getRecruiter(recruiterId) : null;
}
