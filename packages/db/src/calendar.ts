import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import { getDatabase } from "./index";

type Row = Record<string, unknown>;
type QuerySql = Sql | TransactionSql;

export const DEFAULT_MVP_OWNER_ID = "00000000-0000-0000-0000-000000000001";

export const DEFAULT_APPLICATION_PLAN_TEMPLATE: PlanTemplateStep[] = [
  {
    relativeDayOffset: -7,
    taskType: "RESUME_WORK",
    title: "Resume review",
    generatedReason: "Tailor and proofread the resume before the target date.",
  },
  {
    relativeDayOffset: -5,
    taskType: "APPLICATION_TASK",
    title: "Company and recruiting research",
    generatedReason: "Review the role, company, and recruiting provenance before applying.",
  },
  {
    relativeDayOffset: -3,
    taskType: "INTERVIEW_PREP",
    title: "Review interview intelligence",
    generatedReason:
      "Review reported interview intelligence as preparation evidence, not guaranteed content.",
  },
  {
    relativeDayOffset: -2,
    taskType: "LEETCODE",
    title: "Targeted LeetCode practice",
    generatedReason: "Practice a bounded topic-informed session before the target date.",
  },
  {
    relativeDayOffset: 0,
    taskType: "APPLICATION_TASK",
    title: "Apply or monitor opening",
    generatedReason: "Take the target action without treating an estimate as a confirmed opening.",
  },
  {
    relativeDayOffset: 2,
    taskType: "RECRUITER_OUTREACH",
    title: "Recruiter follow-up",
    generatedReason: "Send a concise follow-up after the target action when appropriate.",
  },
];

export interface PlanTemplateStep {
  relativeDayOffset: number;
  taskType: CalendarItemType;
  title: string;
  generatedReason: string;
}

export type CalendarItemType =
  | "RECRUITING_DATE"
  | "APPLICATION_TASK"
  | "LEETCODE"
  | "INTERVIEW_PREP"
  | "SYSTEM_DESIGN"
  | "BEHAVIORAL_PREP"
  | "RECRUITER_OUTREACH"
  | "RESUME_WORK"
  | "CAREER_EVENT"
  | "OA"
  | "CUSTOM";

export type CalendarItemStatus = "TODO" | "DONE" | "SKIPPED" | "CANCELLED";

export interface CalendarItemRecord {
  id: string;
  company: { id: string; name: string; slug: string } | null;
  jobId: string | null;
  recruitingDateId: string | null;
  applicationPlanId: string | null;
  type: CalendarItemType;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  allDay: boolean;
  timezone: string;
  status: CalendarItemStatus;
  source: "RECRUITING_INTELLIGENCE" | "USER" | "APPLICATION_PLAN";
  syncEnabled: boolean;
  completedAt: string | null;
  metadata: Record<string, unknown>;
  recruitingDate: RecruitingDateRecord | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecruitingDateRecord {
  id: string;
  company: { id: string; name: string; slug: string } | null;
  jobId: string | null;
  schoolId: string | null;
  recruitingEventId: string | null;
  campusRecruitingEventId: string | null;
  publicRecruitingObservationId: string | null;
  publicRecruitingClaimId: string | null;
  type: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  allDay: boolean;
  timezone: string;
  dateCertainty: string;
  datePrecision: string;
  confidence: number | null;
  source: {
    kind: string;
    name: string | null;
    url: string | null;
    provenance: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CalendarListOptions {
  start?: string;
  end?: string;
  type?: CalendarItemType;
  company?: string;
  status?: CalendarItemStatus;
}

export interface CalendarItemInput {
  companyId?: string;
  jobId?: string;
  type: Exclude<CalendarItemType, "RECRUITING_DATE">;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  startsOn?: string;
  endsOn?: string;
  allDay: boolean;
  timezone: string;
  status: CalendarItemStatus;
  syncEnabled: boolean;
  metadata: Record<string, unknown>;
}

export interface CalendarItemPatch {
  title?: string;
  description?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  allDay?: boolean;
  timezone?: string;
  status?: CalendarItemStatus;
  syncEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateApplicationPlanInput {
  companyId: string;
  jobId?: string;
  recruitingDateId?: string;
  title: string;
  targetDate: string;
  timezone: string;
  template?: PlanTemplateStep[];
}

export interface ApplicationPlanRecord {
  id: string;
  company: { id: string; name: string; slug: string };
  jobId: string | null;
  recruitingDateId: string | null;
  title: string;
  targetDate: string;
  timezone: string;
  status: "DRAFT" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
  templateVersion: number;
  metadata: Record<string, unknown>;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: ApplicationPlanTaskRecord[];
}

export interface ApplicationPlanTaskRecord {
  id: string;
  sequence: number;
  relativeDayOffset: number | null;
  taskType: CalendarItemType;
  generatedReason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  calendarItem: CalendarItemRecord;
}

export interface GoogleCalendarStatusRecord {
  provider: "GOOGLE";
  status: "CONNECTED" | "REAUTH_REQUIRED" | "DISCONNECTED" | "ERROR";
  accountEmail: string | null;
  selectedCalendarId: string;
  scopes: string[];
  preferences: {
    syncRecruitingDates: boolean;
    syncApplicationTasks: boolean;
    syncLeetcode: boolean;
    syncInterviewPrep: boolean;
    syncCareerEvents: boolean;
  };
  lastSyncAt: string | null;
  lastSyncStatus: "PENDING" | "SYNCED" | "UNCHANGED" | "DELETED" | "ERROR" | null;
  reconnectRequired: boolean;
  errorCode: string | null;
}

export class CalendarNotFoundError extends Error {}
export class CalendarConflictError extends Error {}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected database text");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function integer(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  throw new TypeError("Expected database integer");
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function date(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value).slice(0, 10);
}

function nullableDate(value: unknown): string | null {
  return value === null || value === undefined ? null : date(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError("Expected database boolean");
  return value;
}

function company(row: Row): { id: string; name: string; slug: string } | null {
  if (!row.company_id) return null;
  return {
    id: text(row.company_id),
    name: text(row.company_name),
    slug: text(row.company_slug),
  };
}

function mapRecruitingDate(row: Row): RecruitingDateRecord | null {
  if (!row.recruiting_date_id) return null;
  return {
    id: text(row.recruiting_date_id),
    company: company(row),
    jobId: nullableText(row.recruiting_date_job_id),
    schoolId: nullableText(row.school_id),
    recruitingEventId: nullableText(row.recruiting_event_id),
    campusRecruitingEventId: nullableText(row.campus_recruiting_event_id),
    publicRecruitingObservationId: nullableText(row.public_recruiting_observation_id),
    publicRecruitingClaimId: nullableText(row.public_recruiting_claim_id),
    type: text(row.recruiting_date_type),
    title: text(row.recruiting_date_title),
    startsAt: timestamp(row.recruiting_date_starts_at),
    endsAt: nullableTimestamp(row.recruiting_date_ends_at),
    startsOn: nullableDate(row.recruiting_date_starts_on),
    endsOn: nullableDate(row.recruiting_date_ends_on),
    allDay: bool(row.recruiting_date_all_day),
    timezone: text(row.recruiting_date_timezone),
    dateCertainty: text(row.date_certainty),
    datePrecision: text(row.date_precision),
    confidence: nullableNumber(row.recruiting_date_confidence),
    source: {
      kind: text(row.recruiting_date_source_kind),
      name: nullableText(row.recruiting_date_source_name),
      url: nullableText(row.recruiting_date_source_url),
      provenance: object(row.recruiting_date_provenance),
    },
    createdAt: timestamp(row.recruiting_date_created_at),
    updatedAt: timestamp(row.recruiting_date_updated_at),
  };
}

export function mapCalendarItem(row: Row): CalendarItemRecord {
  return {
    id: text(row.id),
    company: company(row),
    jobId: nullableText(row.job_id),
    recruitingDateId: nullableText(row.recruiting_date_id),
    applicationPlanId: nullableText(row.application_plan_id),
    type: text(row.type) as CalendarItemType,
    title: text(row.title),
    description: nullableText(row.description),
    startsAt: timestamp(row.starts_at),
    endsAt: nullableTimestamp(row.ends_at),
    startsOn: nullableDate(row.starts_on),
    endsOn: nullableDate(row.ends_on),
    allDay: bool(row.all_day),
    timezone: text(row.timezone),
    status: text(row.status) as CalendarItemStatus,
    source: text(row.source) as CalendarItemRecord["source"],
    syncEnabled: bool(row.sync_enabled),
    completedAt: nullableTimestamp(row.completed_at),
    metadata: object(row.metadata),
    recruitingDate: mapRecruitingDate(row),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

const calendarItemSelect = `
  select
    ci.id, ci.company_id, c.canonical_name as company_name, c.slug as company_slug,
    ci.job_id, ci.recruiting_date_id, ci.application_plan_id, ci.type, ci.title,
    ci.description, ci.starts_at, ci.ends_at, ci.starts_on, ci.ends_on, ci.all_day,
    ci.timezone, ci.status, ci.source, ci.sync_enabled, ci.completed_at, ci.metadata,
    ci.created_at, ci.updated_at,
    rd.job_id as recruiting_date_job_id, rd.school_id, rd.recruiting_event_id,
    rd.campus_recruiting_event_id, rd.public_recruiting_observation_id,
    rd.public_recruiting_claim_id, rd.type as recruiting_date_type,
    rd.title as recruiting_date_title, rd.starts_at as recruiting_date_starts_at,
    rd.ends_at as recruiting_date_ends_at, rd.starts_on as recruiting_date_starts_on,
    rd.ends_on as recruiting_date_ends_on, rd.all_day as recruiting_date_all_day,
    rd.timezone as recruiting_date_timezone, rd.date_certainty, rd.date_precision,
    rd.confidence as recruiting_date_confidence, rd.source_kind as recruiting_date_source_kind,
    rs.name as recruiting_date_source_name, rd.source_url as recruiting_date_source_url,
    rd.provenance as recruiting_date_provenance,
    rd.created_at as recruiting_date_created_at, rd.updated_at as recruiting_date_updated_at
  from public.calendar_items ci
  left join public.companies c on c.id = ci.company_id
  left join public.recruiting_dates rd on rd.id = ci.recruiting_date_id
  left join public.sources rs on rs.id = rd.source_id
`;

export function addDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function midnightUtc(isoDate: string): string {
  return `${isoDate}T00:00:00.000Z`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function presentationType(step: PlanTemplateStep): string {
  if (step.taskType === "RESUME_WORK") return "UPDATE_RESUME";
  if (step.taskType === "RECRUITER_OUTREACH") return "FOLLOW_UP";
  if (step.taskType === "APPLICATION_TASK" && step.relativeDayOffset === 0) return "APPLY";
  if (step.taskType === "APPLICATION_TASK") return "RESEARCH_COMPANY";
  return step.taskType;
}

export function planFingerprint(ownerId: string, input: CreateApplicationPlanInput): string {
  return hash({
    version: 1,
    ownerId,
    companyId: input.companyId,
    jobId: input.jobId ?? null,
    recruitingDateId: input.recruitingDateId ?? null,
    title: input.title,
    targetDate: input.targetDate,
    timezone: input.timezone,
    template: input.template ?? DEFAULT_APPLICATION_PLAN_TEMPLATE,
  });
}

export async function materializeRecruitingDates(ownerId: string): Promise<{
  dates: number;
  items: number;
}> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const observationDates = await transaction`
      insert into public.recruiting_dates (
        company_id, job_id, school_id, public_recruiting_observation_id, source_id,
        type, title, starts_at, ends_at, starts_on, ends_on, all_day, timezone,
        date_certainty, date_precision, confidence, source_kind, source_url,
        source_fingerprint, provenance
      )
      select
        o.company_id, o.job_id, o.school_id, o.id, o.source_id,
        case
          when o.observation_type::text = 'APPLICATION_DEADLINE' then 'APPLICATION_DEADLINE'
          when o.observation_type::text in ('CAREER_FAIR') then 'CAREER_FAIR'
          when o.observation_type::text in ('CAMPUS_VISIT') then 'CAMPUS_EVENT'
          when o.observation_type::text in (
            'INTERNSHIP_OPENING_SIGNAL', 'NEW_GRAD_OPENING_SIGNAL', 'APPLICATION_DATE'
          ) and o.date_certainty::text in ('ESTIMATED', 'HISTORICAL', 'CLAIMED')
            then 'EXPECTED_OPENING_WINDOW'
          when o.observation_type::text in (
            'INTERNSHIP_OPENING_SIGNAL', 'NEW_GRAD_OPENING_SIGNAL', 'APPLICATION_DATE'
          ) then 'APPLICATION_OPEN'
          else 'OTHER'
        end::public.recruiting_date_type,
        o.title,
        (o.date_start::timestamp at time zone 'UTC'),
        case when o.date_end is null then null
             else o.date_end::timestamp at time zone 'UTC' end,
        o.date_start, o.date_end, true, 'UTC',
        o.date_certainty::text::public.calendar_date_certainty,
        o.date_precision, o.confidence, 'PUBLIC_OBSERVATION', o.source_url,
        encode(digest('calendar:public-observation:' || o.id::text, 'sha256'), 'hex'),
        jsonb_build_object(
          'observationId', o.id, 'contentHash', o.content_hash,
          'lastVerifiedAt', o.last_verified_at,
          'certaintyPreserved', true
        )
      from public.public_recruiting_observations o
      where o.date_start is not null
      on conflict (source_fingerprint) do update set
        company_id = excluded.company_id,
        job_id = excluded.job_id,
        school_id = excluded.school_id,
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        starts_on = excluded.starts_on,
        ends_on = excluded.ends_on,
        date_certainty = excluded.date_certainty,
        date_precision = excluded.date_precision,
        confidence = excluded.confidence,
        source_url = excluded.source_url,
        provenance = excluded.provenance
      returning id
    `;
    const campusDates = await transaction`
      insert into public.recruiting_dates (
        company_id, school_id, campus_recruiting_event_id,
        public_recruiting_observation_id, source_id, type, title, starts_at, ends_at,
        starts_on, ends_on, all_day, timezone, date_certainty, date_precision,
        confidence, source_kind, source_url, source_fingerprint, provenance
      )
      select
        e.company_id, e.school_id, e.id, e.public_recruiting_observation_id, e.source_id,
        case
          when e.event_type::text = 'CAREER_FAIR' then 'CAREER_FAIR'
          when e.event_type::text = 'INFO_SESSION' then 'INFO_SESSION'
          when e.event_type::text = 'INTERVIEW_EVENT' then 'INTERVIEW_EVENT'
          else 'CAMPUS_EVENT'
        end::public.recruiting_date_type,
        e.title,
        coalesce(e.starts_at, e.date_start::timestamp at time zone 'UTC'),
        coalesce(e.ends_at, e.date_end::timestamp at time zone 'UTC'),
        case when e.starts_at is null then e.date_start else null end,
        case when e.starts_at is null then e.date_end else null end,
        e.starts_at is null, 'UTC',
        e.date_certainty::text::public.calendar_date_certainty,
        e.date_precision, e.confidence, 'CAMPUS_EVENT', e.source_url,
        encode(digest('calendar:campus-event:' || e.id::text, 'sha256'), 'hex'),
        jsonb_build_object(
          'campusRecruitingEventId', e.id, 'contentHash', e.content_hash,
          'lastVerifiedAt', e.last_verified_at, 'certaintyPreserved', true
        )
      from public.campus_recruiting_events e
      where e.starts_at is not null or e.date_start is not null
      on conflict (source_fingerprint) do update set
        company_id = excluded.company_id,
        school_id = excluded.school_id,
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        starts_on = excluded.starts_on,
        ends_on = excluded.ends_on,
        all_day = excluded.all_day,
        date_certainty = excluded.date_certainty,
        date_precision = excluded.date_precision,
        confidence = excluded.confidence,
        source_url = excluded.source_url,
        provenance = excluded.provenance
      returning id
    `;
    const items = await transaction`
      insert into public.calendar_items (
        owner_id, company_id, job_id, recruiting_date_id, type, title, description,
        starts_at, ends_at, starts_on, ends_on, all_day, timezone, status, source, metadata
      )
      select
        ${ownerId}::uuid, rd.company_id, rd.job_id, rd.id,
        case when rd.type in ('CAREER_FAIR', 'CAMPUS_EVENT', 'INFO_SESSION', 'INTERVIEW_EVENT')
             then 'CAREER_EVENT' else 'RECRUITING_DATE' end::public.calendar_item_type,
        rd.title, null, rd.starts_at, rd.ends_at, rd.starts_on, rd.ends_on,
        rd.all_day, rd.timezone, 'TODO', 'RECRUITING_INTELLIGENCE',
        jsonb_build_object(
          'dateCertainty', rd.date_certainty,
          'datePrecision', rd.date_precision,
          'sourceKind', rd.source_kind
        )
      from public.recruiting_dates rd
      where rd.owner_id is null or rd.owner_id = ${ownerId}::uuid
      on conflict (owner_id, recruiting_date_id) where recruiting_date_id is not null
      do update set
        company_id = excluded.company_id,
        job_id = excluded.job_id,
        type = excluded.type,
        title = excluded.title,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        starts_on = excluded.starts_on,
        ends_on = excluded.ends_on,
        all_day = excluded.all_day,
        timezone = excluded.timezone,
        metadata = excluded.metadata
      returning id
    `;
    return { dates: observationDates.length + campusDates.length, items: items.length };
  });
}

export async function listCalendarItems(
  ownerId: string,
  options: CalendarListOptions = {},
): Promise<CalendarItemRecord[]> {
  await materializeRecruitingDates(ownerId);
  const sql = getDatabase();
  const start = options.start
    ? options.start.length === 10
      ? midnightUtc(options.start)
      : options.start
    : null;
  const end = options.end
    ? options.end.length === 10
      ? `${options.end}T23:59:59.999Z`
      : options.end
    : null;
  const rows = await sql.unsafe(
    `${calendarItemSelect}
     where ci.owner_id = $1::uuid and ci.deleted_at is null
       and ($2::timestamptz is null or coalesce(ci.ends_at, ci.starts_at) >= $2::timestamptz)
       and ($3::timestamptz is null or ci.starts_at <= $3::timestamptz)
       and ($4::text is null or ci.type::text = $4::text)
       and ($5::text is null or ci.status::text = $5::text)
       and (
         $6::text is null or c.slug = $6::text or c.id::text = $6::text
       )
     order by ci.starts_at, ci.id`,
    [ownerId, start, end, options.type ?? null, options.status ?? null, options.company ?? null],
  );
  return rows.map(mapCalendarItem);
}

async function getCalendarItemWith(sql: QuerySql, ownerId: string, id: string) {
  const rows = await sql.unsafe(
    `${calendarItemSelect}
     where ci.owner_id = $1::uuid and ci.id = $2::uuid and ci.deleted_at is null
     limit 1`,
    [ownerId, id],
  );
  return rows[0] ? mapCalendarItem(rows[0]) : null;
}

export async function getCalendarItem(ownerId: string, id: string) {
  return getCalendarItemWith(getDatabase(), ownerId, id);
}

async function validateCompanyJob(sql: QuerySql, companyId?: string, jobId?: string) {
  if (!jobId) return;
  const [job] = await sql`
    select company_id from public.jobs where id = ${jobId}::uuid
  `;
  if (!job) throw new CalendarNotFoundError("Job not found");
  if (companyId && text(job.company_id) !== companyId) {
    throw new CalendarConflictError("Job does not belong to the selected company");
  }
}

function normalizedTiming(input: {
  startsAt?: string;
  endsAt?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  allDay: boolean;
}) {
  if (input.allDay) {
    if (!input.startsOn) throw new CalendarConflictError("All-day items need startsOn");
    if (input.endsOn && input.endsOn < input.startsOn) {
      throw new CalendarConflictError("endsOn cannot be before startsOn");
    }
    return {
      startsAt: midnightUtc(input.startsOn),
      endsAt: input.endsOn ? midnightUtc(input.endsOn) : null,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
    };
  }
  if (!input.startsAt) throw new CalendarConflictError("Timed items need startsAt");
  if (input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) {
    throw new CalendarConflictError("endsAt cannot be before startsAt");
  }
  return {
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    startsOn: null,
    endsOn: null,
  };
}

export async function createCalendarItem(
  ownerId: string,
  input: CalendarItemInput,
): Promise<CalendarItemRecord> {
  const sql = getDatabase();
  await validateCompanyJob(sql, input.companyId, input.jobId);
  const timing = normalizedTiming(input);
  const completedAt = input.status === "DONE" ? new Date().toISOString() : null;
  const [created] = await sql`
    insert into public.calendar_items (
      owner_id, company_id, job_id, type, title, description, starts_at, ends_at,
      starts_on, ends_on, all_day, timezone, status, source, sync_enabled,
      completed_at, metadata
    ) values (
      ${ownerId}::uuid, ${input.companyId ?? null}::uuid, ${input.jobId ?? null}::uuid,
      ${input.type}, ${input.title}, ${input.description ?? null}, ${timing.startsAt},
      ${timing.endsAt}, ${timing.startsOn}, ${timing.endsOn}, ${input.allDay},
      ${input.timezone}, ${input.status}, 'USER', ${input.syncEnabled},
      ${completedAt}, ${sql.json(input.metadata as never)}
    ) returning id
  `;
  const item = await getCalendarItem(ownerId, text(created?.id));
  if (!item) throw new Error("Calendar item insert returned no row");
  return item;
}

export async function updateCalendarItem(
  ownerId: string,
  id: string,
  patch: CalendarItemPatch,
): Promise<CalendarItemRecord> {
  const sql = getDatabase();
  const current = await getCalendarItem(ownerId, id);
  if (!current) throw new CalendarNotFoundError("Calendar item not found");
  if (
    current.source === "RECRUITING_INTELLIGENCE" &&
    Object.keys(patch).some((key) => !["status", "syncEnabled"].includes(key))
  ) {
    throw new CalendarConflictError("Source-driven dates only allow status or sync changes");
  }
  const allDay = patch.allDay ?? current.allDay;
  const timing = normalizedTiming({
    allDay,
    startsAt: patch.startsAt ?? current.startsAt,
    endsAt: patch.endsAt === undefined ? current.endsAt : patch.endsAt,
    startsOn: patch.startsOn === undefined ? current.startsOn : patch.startsOn,
    endsOn: patch.endsOn === undefined ? current.endsOn : patch.endsOn,
  });
  const status = patch.status ?? current.status;
  const completedAt = status === "DONE" ? (current.completedAt ?? new Date().toISOString()) : null;
  await sql`
    update public.calendar_items set
      title = ${patch.title ?? current.title},
      description = ${patch.description === undefined ? current.description : patch.description},
      starts_at = ${timing.startsAt}, ends_at = ${timing.endsAt},
      starts_on = ${timing.startsOn}, ends_on = ${timing.endsOn}, all_day = ${allDay},
      timezone = ${patch.timezone ?? current.timezone}, status = ${status},
      sync_enabled = ${patch.syncEnabled ?? current.syncEnabled},
      completed_at = ${completedAt},
      metadata = ${sql.json((patch.metadata ?? current.metadata) as never)}
    where id = ${id}::uuid and owner_id = ${ownerId}::uuid and deleted_at is null
  `;
  const updated = await getCalendarItem(ownerId, id);
  if (!updated) throw new CalendarNotFoundError("Calendar item not found");
  return updated;
}

export async function deleteCalendarItem(ownerId: string, id: string): Promise<void> {
  const sql = getDatabase();
  const rows = await sql`
    update public.calendar_items set status = 'CANCELLED', completed_at = null,
      deleted_at = now()
    where id = ${id}::uuid and owner_id = ${ownerId}::uuid and deleted_at is null
    returning id
  `;
  if (!rows[0]) throw new CalendarNotFoundError("Calendar item not found");
}

async function topInterviewTopics(sql: QuerySql, companyId: string): Promise<string[]> {
  const rows = await sql`
    select topic, count(*)::int as count
    from public.company_interview_questions ciq
    join public.interview_questions iq on iq.id = ciq.interview_question_id
    cross join lateral unnest(iq.topics) topic
    where ciq.company_id = ${companyId}::uuid
    group by topic order by count(*) desc, topic limit 3
  `;
  return rows.map((row) => text(row.topic));
}

function mapPlan(row: Row, tasks: ApplicationPlanTaskRecord[]): ApplicationPlanRecord {
  return {
    id: text(row.id),
    company: {
      id: text(row.company_id),
      name: text(row.company_name),
      slug: text(row.company_slug),
    },
    jobId: nullableText(row.job_id),
    recruitingDateId: nullableText(row.recruiting_date_id),
    title: text(row.title),
    targetDate: date(row.target_date),
    timezone: text(row.timezone),
    status: text(row.status) as ApplicationPlanRecord["status"],
    templateVersion: integer(row.template_version),
    metadata: object(row.metadata),
    activatedAt: nullableTimestamp(row.activated_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    tasks,
  };
}

// The select above needs task aliases without contaminating the canonical calendar projection.
const applicationTaskSelect = calendarItemSelect.replace(
  "select\n    ci.id,",
  `select
    ci.id, apt.id as application_plan_task_id, apt.sequence,
    apt.relative_day_offset, apt.task_type, apt.generated_reason,
    apt.metadata as task_metadata, apt.created_at as task_created_at,`,
);

async function getPlanWithTasks(sql: QuerySql, ownerId: string, id: string) {
  const [plan] = await sql`
    select p.*, c.canonical_name as company_name, c.slug as company_slug
    from public.application_plans p
    join public.companies c on c.id = p.company_id
    where p.id = ${id}::uuid and p.owner_id = ${ownerId}::uuid
  `;
  if (!plan) return null;
  const rows = await sql.unsafe(
    `${applicationTaskSelect}
     join public.application_plan_tasks apt on apt.calendar_item_id = ci.id
     where apt.application_plan_id = $1::uuid
     order by apt.sequence`,
    [id],
  );
  return mapPlan(
    plan,
    rows.map((row) => ({
      id: text(row.application_plan_task_id),
      sequence: integer(row.sequence),
      relativeDayOffset: nullableNumber(row.relative_day_offset),
      taskType: text(row.task_type) as CalendarItemType,
      generatedReason: text(row.generated_reason),
      metadata: object(row.task_metadata),
      createdAt: timestamp(row.task_created_at),
      calendarItem: mapCalendarItem(row),
    })),
  );
}

export async function getApplicationPlan(ownerId: string, id: string) {
  return getPlanWithTasks(getDatabase(), ownerId, id);
}

export async function createApplicationPlan(
  ownerId: string,
  input: CreateApplicationPlanInput,
): Promise<ApplicationPlanRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    await validateCompanyJob(transaction, input.companyId, input.jobId);
    const [companyRow] = await transaction`
      select canonical_name from public.companies where id = ${input.companyId}::uuid
    `;
    if (!companyRow) throw new CalendarNotFoundError("Company not found");
    if (input.recruitingDateId) {
      const [recruitingDate] = await transaction`
        select company_id from public.recruiting_dates where id = ${input.recruitingDateId}::uuid
      `;
      if (!recruitingDate) throw new CalendarNotFoundError("Recruiting date not found");
      if (recruitingDate.company_id && text(recruitingDate.company_id) !== input.companyId) {
        throw new CalendarConflictError("Recruiting date belongs to another company");
      }
    }
    const fingerprint = planFingerprint(ownerId, input);
    const [existing] = await transaction`
      select id from public.application_plans
      where owner_id = ${ownerId}::uuid and plan_fingerprint = ${fingerprint}
    `;
    if (existing) {
      const plan = await getPlanWithTasks(transaction, ownerId, text(existing.id));
      if (!plan) throw new Error("Existing plan could not be read");
      return plan;
    }
    const topics = await topInterviewTopics(transaction, input.companyId);
    const steps = input.template ?? DEFAULT_APPLICATION_PLAN_TEMPLATE;
    const [planRow] = await transaction`
      insert into public.application_plans (
        owner_id, company_id, job_id, recruiting_date_id, title, target_date,
        timezone, plan_fingerprint, metadata
      ) values (
        ${ownerId}::uuid, ${input.companyId}::uuid, ${input.jobId ?? null}::uuid,
        ${input.recruitingDateId ?? null}::uuid, ${input.title}, ${input.targetDate},
        ${input.timezone}, ${fingerprint},
        ${transaction.json({
          generator: "deterministic-v1",
          interviewTopics: topics,
          interviewIntelligenceDisclaimer:
            "Reported topics are preparation evidence, not guaranteed interview content.",
        })}
      ) returning id
    `;
    const planId = text(planRow?.id);
    for (const [sequence, step] of steps.entries()) {
      const taskDate = addDays(input.targetDate, step.relativeDayOffset);
      const topicAware = topics[0] && ["LEETCODE", "INTERVIEW_PREP"].includes(step.taskType);
      const taskTitle = `${step.title}${topicAware ? ` — ${topics[0]}` : ""} — ${text(companyRow.canonical_name)}`;
      const [item] = await transaction`
        insert into public.calendar_items (
          owner_id, company_id, job_id, application_plan_id, type, title, description,
          starts_at, starts_on, all_day, timezone, status, source, sync_enabled, metadata
        ) values (
          ${ownerId}::uuid, ${input.companyId}::uuid, ${input.jobId ?? null}::uuid,
          ${planId}::uuid, ${step.taskType}, ${taskTitle}, ${step.generatedReason},
          ${midnightUtc(taskDate)}, ${taskDate}, true, ${input.timezone}, 'TODO',
          'APPLICATION_PLAN', false,
          ${transaction.json({
            relativeDayOffset: step.relativeDayOffset,
            presentationType: presentationType(step),
            interviewTopics: topicAware ? topics : [],
            intelligenceDisclaimer: topicAware
              ? "Reported topics are not guaranteed interview content."
              : undefined,
          })}
        ) returning id
      `;
      await transaction`
        insert into public.application_plan_tasks (
          application_plan_id, calendar_item_id, sequence, relative_day_offset,
          task_type, generated_reason, metadata
        ) values (
          ${planId}::uuid, ${text(item?.id)}::uuid, ${sequence}, ${step.relativeDayOffset},
          ${step.taskType}, ${step.generatedReason},
          ${transaction.json({
            templateVersion: 1,
            presentationType: presentationType(step),
            interviewTopics: topicAware ? topics : [],
          })}
        )
      `;
    }
    const created = await getPlanWithTasks(transaction, ownerId, planId);
    if (!created) throw new Error("Application plan insert returned no row");
    return created;
  });
}

export async function listApplicationPlans(
  ownerId: string,
  options: { company?: string; status?: string } = {},
): Promise<ApplicationPlanRecord[]> {
  const sql = getDatabase();
  const rows = await sql`
    select p.id from public.application_plans p
    join public.companies c on c.id = p.company_id
    where p.owner_id = ${ownerId}::uuid
      and (${options.company ?? null}::text is null
        or c.slug = ${options.company ?? null} or c.id::text = ${options.company ?? null})
      and (${options.status ?? null}::text is null
        or p.status::text = ${options.status ?? null})
    order by p.target_date, p.id
  `;
  const plans = await Promise.all(rows.map((row) => getPlanWithTasks(sql, ownerId, text(row.id))));
  return plans.filter((plan): plan is ApplicationPlanRecord => plan !== null);
}

export async function activateApplicationPlan(
  ownerId: string,
  id: string,
  syncEnabled: boolean,
): Promise<ApplicationPlanRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const rows = await transaction`
      update public.application_plans set status = 'ACTIVE', activated_at = coalesce(activated_at, now())
      where id = ${id}::uuid and owner_id = ${ownerId}::uuid
        and status in ('DRAFT', 'ACTIVE') returning id
    `;
    if (!rows[0]) throw new CalendarConflictError("Only draft or active plans can be activated");
    if (syncEnabled) {
      await transaction`
        update public.calendar_items set sync_enabled = true
        where application_plan_id = ${id}::uuid and owner_id = ${ownerId}::uuid
          and deleted_at is null
      `;
      await enqueueCalendarSyncWith(transaction, ownerId);
    }
    const plan = await getPlanWithTasks(transaction, ownerId, id);
    if (!plan) throw new CalendarNotFoundError("Application plan not found");
    return plan;
  });
}

export async function updateApplicationPlan(
  ownerId: string,
  id: string,
  patch: { title?: string; targetDate?: string; timezone?: string; status?: string },
): Promise<ApplicationPlanRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const current = await getPlanWithTasks(transaction, ownerId, id);
    if (!current) throw new CalendarNotFoundError("Application plan not found");
    const targetDate = patch.targetDate ?? current.targetDate;
    const timezone = patch.timezone ?? current.timezone;
    await transaction`
      update public.application_plans set title = ${patch.title ?? current.title},
        target_date = ${targetDate}, timezone = ${timezone},
        status = ${patch.status ?? current.status}::public.application_plan_status
      where id = ${id}::uuid and owner_id = ${ownerId}::uuid
    `;
    if (patch.targetDate || patch.timezone) {
      for (const task of current.tasks) {
        if (task.relativeDayOffset === null) continue;
        const taskDate = addDays(targetDate, task.relativeDayOffset);
        await transaction`
          update public.calendar_items set starts_on = ${taskDate},
            starts_at = ${midnightUtc(taskDate)}, timezone = ${timezone}
          where id = ${task.calendarItem.id}::uuid
        `;
      }
    }
    const updated = await getPlanWithTasks(transaction, ownerId, id);
    if (!updated) throw new Error("Updated plan could not be read");
    return updated;
  });
}

export async function deleteApplicationPlan(ownerId: string, id: string): Promise<void> {
  const sql = getDatabase();
  const rows = await sql`
    update public.application_plans set status = 'ARCHIVED'
    where id = ${id}::uuid and owner_id = ${ownerId}::uuid returning id
  `;
  if (!rows[0]) throw new CalendarNotFoundError("Application plan not found");
  await sql`
    update public.calendar_items set status = 'CANCELLED', completed_at = null, deleted_at = now()
    where application_plan_id = ${id}::uuid and owner_id = ${ownerId}::uuid
      and deleted_at is null
  `;
}

function mapGoogleStatus(row?: Row): GoogleCalendarStatusRecord {
  if (!row) {
    return {
      provider: "GOOGLE",
      status: "DISCONNECTED",
      accountEmail: null,
      selectedCalendarId: "primary",
      scopes: [],
      preferences: {
        syncRecruitingDates: true,
        syncApplicationTasks: true,
        syncLeetcode: true,
        syncInterviewPrep: true,
        syncCareerEvents: true,
      },
      lastSyncAt: null,
      lastSyncStatus: null,
      reconnectRequired: false,
      errorCode: null,
    };
  }
  const status = text(row.connection_status) as GoogleCalendarStatusRecord["status"];
  return {
    provider: "GOOGLE",
    status,
    accountEmail: nullableText(row.provider_email),
    selectedCalendarId: text(row.selected_calendar_id),
    scopes: strings(row.scopes),
    preferences: {
      syncRecruitingDates: bool(row.sync_recruiting_dates),
      syncApplicationTasks: bool(row.sync_application_tasks),
      syncLeetcode: bool(row.sync_leetcode),
      syncInterviewPrep: bool(row.sync_interview_prep),
      syncCareerEvents: bool(row.sync_career_events),
    },
    lastSyncAt: nullableTimestamp(row.last_sync_at),
    lastSyncStatus: nullableText(
      row.last_sync_status,
    ) as GoogleCalendarStatusRecord["lastSyncStatus"],
    reconnectRequired: status === "REAUTH_REQUIRED",
    errorCode: nullableText(row.last_error_code),
  };
}

export async function getGoogleCalendarStatus(ownerId: string) {
  const sql = getDatabase();
  const [row] = await sql`
    select * from public.calendar_connections
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
  `;
  return mapGoogleStatus(row);
}

export async function createGoogleOauthState(input: {
  ownerId: string;
  stateHash: string;
  encryptedCodeVerifier: string;
  expiresAt: string;
  returnTo: string;
}) {
  const sql = getDatabase();
  await sql`
    delete from public.calendar_oauth_states
    where owner_id = ${input.ownerId}::uuid and provider = 'GOOGLE'
      and (consumed_at is not null or expires_at <= now())
  `;
  const [row] = await sql`
    insert into public.calendar_oauth_states (
      owner_id, provider, state_hash, encrypted_code_verifier, expires_at, return_to
    ) values (
      ${input.ownerId}::uuid, 'GOOGLE', ${input.stateHash}, ${input.encryptedCodeVerifier},
      ${input.expiresAt}, ${input.returnTo}
    ) returning expires_at
  `;
  return timestamp(row?.expires_at);
}

export async function consumeGoogleOauthState(stateHash: string) {
  const sql = getDatabase();
  const [row] = await sql`
    update public.calendar_oauth_states set consumed_at = now()
    where state_hash = ${stateHash} and provider = 'GOOGLE'
      and consumed_at is null and expires_at > now()
    returning owner_id, encrypted_code_verifier, return_to
  `;
  if (!row) return null;
  return {
    ownerId: text(row.owner_id),
    encryptedCodeVerifier: text(row.encrypted_code_verifier),
    returnTo: text(row.return_to),
  };
}

export async function saveGoogleCalendarConnection(input: {
  ownerId: string;
  providerAccountId: string;
  providerEmail: string | null;
  encryptedRefreshToken: string | null;
  scopes: string[];
  tokenMetadata: Record<string, unknown>;
}) {
  const sql = getDatabase();
  const [existing] = await sql`
    select encrypted_refresh_token from public.calendar_connections
    where owner_id = ${input.ownerId}::uuid and provider = 'GOOGLE'
  `;
  const encryptedToken =
    input.encryptedRefreshToken ?? nullableText(existing?.encrypted_refresh_token);
  if (!encryptedToken) throw new CalendarConflictError("Google did not return a refresh token");
  await sql`
    insert into public.calendar_connections (
      owner_id, provider, provider_account_id, provider_email, encrypted_refresh_token,
      scopes, connection_status, token_metadata, selected_calendar_id, last_error_code
    ) values (
      ${input.ownerId}::uuid, 'GOOGLE', ${input.providerAccountId}, ${input.providerEmail},
      ${encryptedToken}, ${input.scopes}, 'CONNECTED',
      ${sql.json(input.tokenMetadata as never)},
      'primary', null
    ) on conflict (owner_id, provider) do update set
      provider_account_id = excluded.provider_account_id,
      provider_email = excluded.provider_email,
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      scopes = excluded.scopes,
      connection_status = 'CONNECTED',
      token_metadata = excluded.token_metadata,
      last_error_code = null
  `;
  return getGoogleCalendarStatus(input.ownerId);
}

export async function updateGoogleCalendarConnection(
  ownerId: string,
  patch: {
    selectedCalendarId?: string;
    preferences?: Partial<GoogleCalendarStatusRecord["preferences"]>;
  },
) {
  const sql = getDatabase();
  const [current] = await sql`
    select * from public.calendar_connections
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
  `;
  if (!current) throw new CalendarNotFoundError("Google Calendar is not connected");
  const preferences = mapGoogleStatus(current).preferences;
  await sql`
    update public.calendar_connections set
      selected_calendar_id = ${patch.selectedCalendarId ?? text(current.selected_calendar_id)},
      sync_recruiting_dates = ${patch.preferences?.syncRecruitingDates ?? preferences.syncRecruitingDates},
      sync_application_tasks = ${patch.preferences?.syncApplicationTasks ?? preferences.syncApplicationTasks},
      sync_leetcode = ${patch.preferences?.syncLeetcode ?? preferences.syncLeetcode},
      sync_interview_prep = ${patch.preferences?.syncInterviewPrep ?? preferences.syncInterviewPrep},
      sync_career_events = ${patch.preferences?.syncCareerEvents ?? preferences.syncCareerEvents}
    where id = ${text(current.id)}::uuid
  `;
  return getGoogleCalendarStatus(ownerId);
}

export async function getGoogleRefreshCredential(ownerId: string) {
  const sql = getDatabase();
  const [row] = await sql`
    select id, encrypted_refresh_token from public.calendar_connections
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
  `;
  return row
    ? {
        connectionId: text(row.id),
        encryptedRefreshToken: nullableText(row.encrypted_refresh_token),
      }
    : null;
}

export async function disconnectGoogleCalendar(ownerId: string): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.calendar_connections set connection_status = 'DISCONNECTED',
      encrypted_refresh_token = null, token_metadata = '{}', last_error_code = null
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
  `;
  await sql`
    delete from public.calendar_oauth_states
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE' and consumed_at is null
  `;
}

export async function markGoogleCalendarReauthRequired(
  ownerId: string,
  errorCode: string,
): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.calendar_connections set connection_status = 'REAUTH_REQUIRED',
      last_sync_status = 'ERROR', last_error_code = ${errorCode}
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
  `;
}

async function enqueueCalendarSyncWith(sql: QuerySql, ownerId: string) {
  const [connection] = await sql`
    select id from public.calendar_connections
    where owner_id = ${ownerId}::uuid and provider = 'GOOGLE'
      and connection_status in ('CONNECTED', 'ERROR')
  `;
  if (!connection) return null;
  await sql`
    update public.calendar_connections set connection_status = 'CONNECTED',
      last_error_code = null
    where id = ${text(connection.id)}::uuid and connection_status = 'ERROR'
  `;
  const [existing] = await sql`
    select * from public.calendar_sync_requests
    where calendar_connection_id = ${text(connection.id)}::uuid
      and status in ('PENDING', 'RUNNING')
    order by requested_at limit 1
  `;
  if (existing) return existing;
  const [created] = await sql`
    insert into public.calendar_sync_requests (
      calendar_connection_id, requested_by_owner_id
    ) values (${text(connection.id)}::uuid, ${ownerId}::uuid)
    returning *
  `;
  return created;
}

export async function enqueueGoogleCalendarSync(ownerId: string) {
  const row = await enqueueCalendarSyncWith(getDatabase(), ownerId);
  if (!row) throw new CalendarConflictError("Google Calendar is not connected");
  return {
    id: text(row.id),
    connectionId: text(row.calendar_connection_id),
    status: text(row.status),
    attemptCount: integer(row.attempt_count),
    requestedAt: timestamp(row.requested_at),
  };
}
