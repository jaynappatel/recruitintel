import type { Sql, TransactionSql } from "postgres";
import { getDatabase } from "./index";
import { recordProductEventWith } from "./instrumentation";

type Query = Sql | TransactionSql;
type Row = Record<string, unknown>;
const s = (v: unknown) => String(v);
const t = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : s(v));

export class ApplicationNotFoundError extends Error {}
export class ApplicationConflictError extends Error {}
export class ApplicationValidationError extends Error {}

export type ApplicationStatus =
  | "SAVED"
  | "PLANNING"
  | "APPLIED"
  | "IN_PROCESS"
  | "OFFER"
  | "REJECTED"
  | "WITHDRAWN"
  | "CLOSED";
export type ApplicationStage =
  | "NONE"
  | "OA"
  | "RECRUITER_SCREEN"
  | "TECHNICAL_INTERVIEW"
  | "ONSITE"
  | "FINAL_ROUND";

export interface ApplicationRecord {
  id: string;
  userId: string;
  opportunityId: string;
  sourcePostingId: string | null;
  companyId: string;
  cycleKey: string;
  currentStatus: ApplicationStatus;
  currentStage: ApplicationStage;
  appliedAt: string | null;
  applicationUrlUsed: string | null;
  applicationPlanId: string | null;
  originRecommendationImpressionId: string | null;
  targetSnapshot: Record<string, unknown>;
  nextActionType: string;
  nextActionAt: string | null;
  nextActionReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ApplicationEventRecord {
  id: string;
  applicationId: string;
  userId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  fromStage: string | null;
  toStage: string | null;
  occurredAt: string;
  recordedAt: string;
  source: string;
  reasonCode: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

function app(row: Row): ApplicationRecord {
  return {
    id: s(row.id),
    userId: s(row.user_id),
    opportunityId: s(row.opportunity_id),
    sourcePostingId: row.source_posting_id == null ? null : s(row.source_posting_id),
    companyId: s(row.company_id),
    cycleKey: s(row.cycle_key),
    currentStatus: s(row.current_status) as ApplicationStatus,
    currentStage: s(row.current_stage) as ApplicationStage,
    appliedAt: t(row.applied_at),
    applicationUrlUsed: row.application_url_used == null ? null : s(row.application_url_used),
    applicationPlanId: row.application_plan_id == null ? null : s(row.application_plan_id),
    originRecommendationImpressionId:
      row.origin_recommendation_impression_id == null
        ? null
        : s(row.origin_recommendation_impression_id),
    targetSnapshot: (row.target_snapshot && typeof row.target_snapshot === "object"
      ? row.target_snapshot
      : {}) as Record<string, unknown>,
    nextActionType: s(row.next_action_type),
    nextActionAt: t(row.next_action_at),
    nextActionReason: row.next_action_reason == null ? null : s(row.next_action_reason),
    archivedAt: t(row.archived_at),
    createdAt: s(t(row.created_at)),
    updatedAt: s(t(row.updated_at)),
  };
}
function event(row: Row): ApplicationEventRecord {
  return {
    id: s(row.id),
    applicationId: s(row.application_id),
    userId: s(row.user_id),
    eventType: s(row.event_type),
    fromStatus: row.from_status == null ? null : s(row.from_status),
    toStatus: row.to_status == null ? null : s(row.to_status),
    fromStage: row.from_stage == null ? null : s(row.from_stage),
    toStage: row.to_stage == null ? null : s(row.to_stage),
    occurredAt: s(t(row.occurred_at)),
    recordedAt: s(t(row.recorded_at)),
    source: s(row.source),
    reasonCode: row.reason_code == null ? null : s(row.reason_code),
    idempotencyKey: s(row.idempotency_key),
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<
      string,
      unknown
    >,
  };
}

async function getOwned(sql: Query, userId: string, id: string): Promise<ApplicationRecord> {
  const [row] =
    await sql`select * from public.applications where id = ${id}::uuid and user_id = ${userId}::uuid`;
  if (!row) throw new ApplicationNotFoundError("Application not found");
  return app(row);
}

function transition(current: ApplicationStatus, next: ApplicationStatus): boolean {
  if (current === next) return true;
  if (["REJECTED", "WITHDRAWN"].includes(current)) return false;
  if (current === "CLOSED") return next === "APPLIED" || next === "IN_PROCESS";
  const allowed: Record<ApplicationStatus, ApplicationStatus[]> = {
    SAVED: ["PLANNING", "APPLIED", "CLOSED"],
    PLANNING: ["APPLIED", "CLOSED"],
    APPLIED: ["IN_PROCESS", "OFFER", "REJECTED", "WITHDRAWN", "CLOSED"],
    IN_PROCESS: ["OFFER", "REJECTED", "WITHDRAWN", "CLOSED"],
    OFFER: ["REJECTED", "WITHDRAWN", "CLOSED"],
    REJECTED: [],
    WITHDRAWN: [],
    CLOSED: ["APPLIED", "IN_PROCESS"],
  };
  return allowed[current].includes(next);
}

export async function createApplication(
  userId: string,
  input: {
    opportunityId: string;
    sourcePostingId?: string | null;
    cycleKey: string;
    applicationPlanId?: string | null;
    originRecommendationImpressionId?: string | null;
    applicationUrlUsed?: string | null;
    appliedAt?: string | null;
  },
): Promise<ApplicationRecord> {
  if (!/^https:\/\//.test(input.applicationUrlUsed ?? "https://placeholder.invalid"))
    throw new ApplicationValidationError("Application URL must use HTTPS");
  return getDatabase().begin(async (tx) => {
    const [opp] =
      await tx`select id, company_id, canonical_application_url, normalized_title, location_summary, role_family::text, experience_level::text from public.job_opportunities where id = ${input.opportunityId}::uuid`;
    if (!opp) throw new ApplicationNotFoundError("Opportunity not found");
    if (input.sourcePostingId) {
      const [posting] =
        await tx`select id from public.job_opportunity_postings where opportunity_id = ${input.opportunityId}::uuid and job_id = ${input.sourcePostingId}::uuid`;
      if (!posting)
        throw new ApplicationValidationError("Source posting is not attached to this opportunity");
    }
    if (input.originRecommendationImpressionId) {
      const [impression] =
        await tx`select id from public.recommendation_impressions where id = ${input.originRecommendationImpressionId}::uuid and user_id = ${userId}::uuid and opportunity_id = ${input.opportunityId}::uuid`;
      if (!impression) throw new ApplicationValidationError("Recommendation impression is invalid");
    }
    const [existing] =
      await tx`select * from public.applications where user_id = ${userId}::uuid and opportunity_id = ${input.opportunityId}::uuid and cycle_key = ${input.cycleKey} and archived_at is null`;
    if (existing)
      throw new ApplicationConflictError(
        "An active application already exists for this opportunity cycle",
      );
    const [row] =
      await tx`insert into public.applications (user_id, opportunity_id, source_posting_id, company_id, cycle_key, current_status, current_stage, applied_at, application_url_used, application_plan_id, origin_recommendation_impression_id, target_snapshot)
      values (${userId}::uuid, ${input.opportunityId}::uuid, ${input.sourcePostingId ?? null}::uuid, ${String(opp.company_id)}::uuid, ${input.cycleKey}, 'SAVED', 'NONE', ${input.appliedAt ?? null}::timestamptz, ${input.applicationUrlUsed ?? null}, ${input.applicationPlanId ?? null}::uuid, ${input.originRecommendationImpressionId ?? null}::uuid, ${tx.json({ title: String(opp.normalized_title), location: String(opp.location_summary), roleFamily: String(opp.role_family), experienceLevel: String(opp.experience_level), capturedAt: new Date().toISOString() })}) returning *`;
    if (!row) throw new ApplicationConflictError("Application could not be created");
    const id = s(row.id);
    await tx`insert into public.application_events (application_id, user_id, event_type, to_status, to_stage, source, idempotency_key) values (${id}::uuid, ${userId}::uuid, 'APPLICATION_CREATED', 'SAVED', 'NONE', 'USER', ${`application-created:${id}`})`;
    if (input.applicationPlanId)
      await tx`update public.application_plans set application_id = ${id}::uuid where id = ${input.applicationPlanId}::uuid and user_id = ${userId}::uuid`;
    await recordProductEventWith(tx, {
      userId,
      eventType: "APPLICATION_STARTED",
      source: "SERVER",
      entityType: "OPPORTUNITY",
      entityId: input.opportunityId,
      deduplicationKey: `application-started:${id}`,
      context: { applicationId: id },
    });
    return app(row);
  });
}

export async function listApplications(
  userId: string,
  options: {
    limit?: number;
    cursor?: string;
    status?: string;
    companyId?: string;
    includeArchived?: boolean;
  } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const rows =
    await getDatabase()`select * from public.applications where user_id = ${userId}::uuid ${options.status ? getDatabase().unsafe("and current_status = $1::public.application_status", [options.status]) : getDatabase().unsafe("", [])} ${options.companyId ? getDatabase().unsafe("and company_id = $1::uuid", [options.companyId]) : getDatabase().unsafe("", [])} ${options.includeArchived ? getDatabase().unsafe("", []) : getDatabase().unsafe("and archived_at is null", [])} order by updated_at desc, id desc limit ${limit}`;
  const last = rows[rows.length - 1];
  return { items: rows.map(app), nextCursor: rows.length === limit && last ? s(last.id) : null };
}

export async function getApplication(userId: string, id: string) {
  return getOwned(getDatabase(), userId, id);
}
export async function archiveApplication(userId: string, id: string) {
  await getOwned(getDatabase(), userId, id);
  await getDatabase()`update public.applications set archived_at = coalesce(archived_at, now()), updated_at = now() where id = ${id}::uuid and user_id = ${userId}::uuid`;
  return getApplication(userId, id);
}
export async function getApplicationTimeline(userId: string, id: string) {
  await getOwned(getDatabase(), userId, id);
  const rows =
    await getDatabase()`select * from public.application_events where application_id = ${id}::uuid and user_id = ${userId}::uuid order by occurred_at, recorded_at, id`;
  return rows.map(event);
}

export async function changeApplicationStatus(
  userId: string,
  id: string,
  input: {
    status: ApplicationStatus;
    stage?: ApplicationStage;
    occurredAt?: string;
    reasonCode?: string;
    idempotencyKey: string;
  },
) {
  return getDatabase().begin(async (tx) => {
    const current = await getOwned(tx, userId, id);
    if (!transition(current.currentStatus, input.status))
      throw new ApplicationValidationError("Invalid application status transition");
    const [existing] =
      await tx`select * from public.application_events where user_id = ${userId}::uuid and idempotency_key = ${input.idempotencyKey}`;
    if (existing) return getOwned(tx, userId, id);
    const stage = input.stage ?? current.currentStage;
    const eventType =
      input.status === "OFFER"
        ? "OFFER_RECEIVED"
        : input.status === "REJECTED"
          ? "REJECTION_RECEIVED"
          : input.status === "WITHDRAWN"
            ? "WITHDRAWN"
            : input.status === "APPLIED"
              ? "APPLICATION_SUBMITTED"
              : input.stage && input.stage !== current.currentStage
                ? "STAGE_CHANGED"
                : "STATUS_CHANGED";
    await tx`insert into public.application_events (application_id, user_id, event_type, from_status, to_status, from_stage, to_stage, occurred_at, source, reason_code, idempotency_key) values (${id}::uuid, ${userId}::uuid, ${eventType}, ${current.currentStatus}, ${input.status}, ${current.currentStage}, ${stage}, ${input.occurredAt ?? null}::timestamptz, 'USER', ${input.reasonCode ?? null}, ${input.idempotencyKey})`;
    await tx`update public.applications set current_status = ${input.status}, current_stage = ${stage}, applied_at = case when ${input.status} = 'APPLIED' then coalesce(applied_at, ${input.occurredAt ?? null}::timestamptz) else applied_at end, updated_at = now() where id = ${id}::uuid and user_id = ${userId}::uuid`;
    await recordProductEventWith(tx, {
      userId,
      eventType: eventType as never,
      source: "SERVER",
      entityType: "OPPORTUNITY",
      entityId: current.opportunityId,
      deduplicationKey: `application-event:${userId}:${input.idempotencyKey}`,
      context: { applicationId: id },
    });
    return getOwned(tx, userId, id);
  });
}

export async function createAssessment(
  userId: string,
  applicationId: string,
  input: {
    type: string;
    dueAt?: string | null;
    providerName?: string | null;
    idempotencyKey: string;
  },
) {
  await getOwned(getDatabase(), userId, applicationId);
  const [row] =
    await getDatabase()`insert into public.application_assessments (application_id, user_id, type, due_at, provider_name, idempotency_key) values (${applicationId}::uuid, ${userId}::uuid, ${input.type}, ${input.dueAt ?? null}::timestamptz, ${input.providerName ?? null}, ${input.idempotencyKey}) on conflict (user_id, application_id, idempotency_key) do update set updated_at = now() returning *`;
  return row;
}

export async function createInterview(
  userId: string,
  applicationId: string,
  input: {
    interviewType: string;
    startsAt: string;
    endsAt?: string | null;
    timezone?: string;
    recruiterProfileId?: string | null;
  },
) {
  await getOwned(getDatabase(), userId, applicationId);
  const [row] =
    await getDatabase()`insert into public.application_interviews (application_id, user_id, interview_type, starts_at, ends_at, timezone, recruiter_profile_id) values (${applicationId}::uuid, ${userId}::uuid, ${input.interviewType}, ${input.startsAt}::timestamptz, ${input.endsAt ?? null}::timestamptz, ${input.timezone ?? "UTC"}, ${input.recruiterProfileId ?? null}::uuid) returning *`;
  if (!row) throw new ApplicationConflictError("Interview could not be created");
  return row;
}
