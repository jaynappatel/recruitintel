import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDatabase } from "./index";
import { recordProductEventWith } from "./instrumentation";
import { createCalendarItem, updateCalendarItem } from "./calendar";

type Query = Sql | TransactionSql;
type Row = Record<string, unknown>;
const s = (v: unknown) => String(v);
const t = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : s(v));

export class ApplicationNotFoundError extends Error {}
export class ApplicationConflictError extends Error {}
export class ApplicationValidationError extends Error {}

const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

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
  resumeVersionId: string | null;
  matchId: string | null;
  targetSnapshot: Record<string, unknown>;
  nextActionType: string;
  nextActionAt: string | null;
  nextActionReason: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedOpportunity: { id: string; title: string; status: string } | null;
  resolutionMismatch: boolean;
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
    resumeVersionId: row.resume_version_id == null ? null : s(row.resume_version_id),
    matchId: row.match_id == null ? null : s(row.match_id),
    targetSnapshot: (row.target_snapshot && typeof row.target_snapshot === "object"
      ? row.target_snapshot
      : {}) as Record<string, unknown>,
    nextActionType: s(row.next_action_type),
    nextActionAt: t(row.next_action_at),
    nextActionReason: row.next_action_reason == null ? null : s(row.next_action_reason),
    archivedAt: t(row.archived_at),
    createdAt: s(t(row.created_at)),
    updatedAt: s(t(row.updated_at)),
    resolvedOpportunity: row.resolved_opportunity_id
      ? {
          id: s(row.resolved_opportunity_id),
          title: s(row.resolved_opportunity_title),
          status: s(row.resolved_opportunity_status),
        }
      : null,
    resolutionMismatch: Boolean(row.resolution_mismatch),
  };
}

const applicationSelect = `select a.*, resolved.id as resolved_opportunity_id,
  resolved.status::text as resolved_opportunity_status, resolved_canonical.title as resolved_opportunity_title,
  (a.opportunity_id is distinct from coalesce(membership.opportunity_id, a.opportunity_id)) as resolution_mismatch
  from public.applications a
  left join public.job_opportunity_postings membership on membership.job_id=a.source_posting_id and membership.valid_to is null
  left join public.job_opportunities resolved on resolved.id=coalesce(membership.opportunity_id,a.opportunity_id)
  left join public.jobs resolved_canonical on resolved_canonical.id=resolved.canonical_source_posting_id`;
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

async function getOwned(
  sql: Query,
  userId: string,
  id: string,
  forUpdate = false,
): Promise<ApplicationRecord> {
  const [row] = await sql.unsafe(
    `${applicationSelect} where a.id = $1::uuid and a.user_id = $2::uuid ${forUpdate ? "for update of a" : ""}`,
    [id, userId],
  );
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
  const clauses = ["a.user_id = $1::uuid"];
  const params: string[] = [userId];
  if (options.status) {
    params.push(options.status);
    clauses.push(`a.current_status = $${params.length}::public.application_status`);
  }
  if (options.companyId) {
    params.push(options.companyId);
    clauses.push(`a.company_id = $${params.length}::uuid`);
  }
  if (!options.includeArchived) clauses.push("a.archived_at is null");
  const rows = await getDatabase().unsafe(
    `${applicationSelect} where ${clauses.join(" and ")} order by a.updated_at desc, a.id desc limit ${limit}`,
    params,
  );
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

/** Bind the immutable resume/match inputs used for an application. */
export async function bindApplicationMatch(
  userId: string,
  applicationId: string,
  resumeVersionId: string,
  matchId: string,
) {
  return getDatabase().begin(async (tx) => {
    await getOwned(tx, userId, applicationId);
    const [match] = await tx`select id, resume_version_id, opportunity_id
      from public.resume_job_matches where id=${matchId}::uuid and user_id=${userId}::uuid`;
    if (!match || String(match.resume_version_id) !== resumeVersionId)
      throw new ApplicationValidationError("Match is not owned by application user/version");
    const [application] = await tx`select opportunity_id from public.applications
      where id=${applicationId}::uuid and user_id=${userId}::uuid`;
    if (!application || String(application.opportunity_id) !== String(match.opportunity_id))
      throw new ApplicationValidationError("Match opportunity does not match application");
    const [row] = await tx`update public.applications set
      resume_version_id=${resumeVersionId}::uuid, match_id=${matchId}::uuid, updated_at=now()
      where id=${applicationId}::uuid and user_id=${userId}::uuid
      returning *`;
    if (!row) throw new ApplicationNotFoundError("Application not found");
    return app(row as Row);
  });
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
    await tx`insert into public.application_events (application_id, user_id, event_type, from_status, to_status, from_stage, to_stage, occurred_at, source, reason_code, idempotency_key) values (${id}::uuid, ${userId}::uuid, ${eventType}, ${current.currentStatus}, ${input.status}, ${current.currentStage}, ${stage}, ${input.occurredAt ?? new Date().toISOString()}::timestamptz, 'USER', ${input.reasonCode ?? null}, ${input.idempotencyKey})`;
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
  const current = await getOwned(getDatabase(), userId, applicationId);
  const [row] = await getDatabase()`insert into public.application_assessments
    (application_id, user_id, type, status, due_at, provider_name, idempotency_key)
    values (${applicationId}::uuid, ${userId}::uuid, ${input.type}, 'RECEIVED',
      ${input.dueAt ?? null}::timestamptz, ${input.providerName ?? null}, ${input.idempotencyKey})
    on conflict (user_id, application_id, idempotency_key) do update set updated_at = now() returning *`;
  if (row && String(row.type) === "OA") {
    const [existingItem] = input.dueAt
      ? await getDatabase()`select id from public.calendar_items where user_id=${userId}::uuid and application_assessment_id=${String(row.id)}::uuid and deleted_at is null limit 1`
      : [];
    const item =
      input.dueAt && !existingItem
        ? await createCalendarItem(userId, {
            companyId: current.companyId,
            opportunityId: current.opportunityId,
            type: "OA",
            title: "Complete online assessment",
            startsAt: input.dueAt,
            allDay: false,
            timezone: "UTC",
            status: "TODO",
            syncEnabled: false,
            metadata: { applicationId },
            applicationId,
            applicationAssessmentId: String(row.id),
          })
        : null;
    await getDatabase()`update public.application_assessments set received_at = coalesce(received_at, now()) where id = ${String(row.id)}::uuid and user_id = ${userId}::uuid`;
    const calendarItemId = item?.id
      ? String(item.id)
      : existingItem?.id
        ? String(existingItem.id)
        : null;
    await getDatabase()`insert into public.application_events (application_id,user_id,event_type,from_status,to_status,from_stage,to_stage,assessment_id,calendar_item_id,source,idempotency_key) values (${applicationId}::uuid,${userId}::uuid,'OA_RECEIVED',${current.currentStatus},'IN_PROCESS',${current.currentStage},'OA',${String(row.id)}::uuid,${calendarItemId}::uuid,'USER',${`oa-received:${String(row.id)}`}) on conflict (user_id,idempotency_key) do nothing`;
    await getDatabase()`update public.applications set current_status='IN_PROCESS', current_stage='OA', next_action_type='COMPLETE_OA', next_action_at=${input.dueAt ?? null}::timestamptz, updated_at=now() where id=${applicationId}::uuid and user_id=${userId}::uuid`;
    if (input.dueAt) {
      await createApplicationAlert({
        userId,
        applicationId,
        alertType: "OA_DEADLINE_APPROACHING",
        reminderWindow: "DUE",
        title: "Online assessment deadline",
        body: "Your online assessment deadline is approaching.",
        reasonCodes: ["OA_DEADLINE"],
      });
    }
  }
  return row;
}

export async function updateAssessment(
  userId: string,
  applicationId: string,
  assessmentId: string,
  input: {
    status?: string;
    dueAt?: string | null;
    completedAt?: string | null;
    score?: number | null;
  },
) {
  await getOwned(getDatabase(), userId, applicationId);
  const [row] =
    await getDatabase()`update public.application_assessments set status=coalesce(${input.status ?? null}::public.application_assessment_status,status), due_at=case when ${input.dueAt === undefined} then due_at else ${input.dueAt ?? null}::timestamptz end, completed_at=case when ${input.completedAt === undefined} then completed_at else ${input.completedAt ?? null}::timestamptz end, received_at=coalesce(received_at, case when ${input.status === "COMPLETED"} then now() else null end), updated_at=now() where id=${assessmentId}::uuid and application_id=${applicationId}::uuid and user_id=${userId}::uuid returning *`;
  if (!row) throw new ApplicationNotFoundError("Assessment not found");
  if (String(row.status) === "COMPLETED")
    await getDatabase()`insert into public.application_events (application_id,user_id,event_type,assessment_id,source,idempotency_key) values (${applicationId}::uuid,${userId}::uuid,'OA_COMPLETED',${assessmentId}::uuid,'USER',${`oa-completed:${assessmentId}`}) on conflict (user_id,idempotency_key) do nothing`;
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
    idempotencyKey?: string;
  },
) {
  const current = await getOwned(getDatabase(), userId, applicationId);
  const [row] =
    await getDatabase()`insert into public.application_interviews (application_id, user_id, interview_type, starts_at, ends_at, timezone, recruiter_profile_id) values (${applicationId}::uuid, ${userId}::uuid, ${input.interviewType}, ${input.startsAt}::timestamptz, ${input.endsAt ?? null}::timestamptz, ${input.timezone ?? "UTC"}, ${input.recruiterProfileId ?? null}::uuid) on conflict (user_id, application_id, interview_type, starts_at) where status <> 'CANCELLED' do update set updated_at=now() returning *`;
  if (!row) throw new ApplicationConflictError("Interview could not be created");
  const [existingItem] =
    await getDatabase()`select id from public.calendar_items where user_id=${userId}::uuid and application_interview_id=${String(row.id)}::uuid and deleted_at is null limit 1`;
  let item = existingItem ? { id: String(existingItem.id) } : null;
  if (!item) {
    try {
      item = await createCalendarItem(userId, {
        companyId: current.companyId,
        opportunityId: current.opportunityId,
        type: "CUSTOM",
        title: `${input.interviewType} interview`,
        startsAt: input.startsAt,
        ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        allDay: false,
        timezone: input.timezone ?? "UTC",
        status: "TODO",
        syncEnabled: false,
        metadata: { applicationId },
        applicationId,
        applicationInterviewId: String(row.id),
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "23505") throw error;
      const [concurrentItem] =
        await getDatabase()`select id from public.calendar_items where user_id=${userId}::uuid and application_interview_id=${String(row.id)}::uuid and deleted_at is null limit 1`;
      if (!concurrentItem) throw error;
      item = { id: String(concurrentItem.id) };
    }
  }
  await getDatabase()`update public.application_interviews set calendar_item_id=${item.id}::uuid where id=${String(row.id)}::uuid and user_id=${userId}::uuid and calendar_item_id is null`;
  await getDatabase()`insert into public.application_events (application_id,user_id,event_type,from_status,to_status,from_stage,to_stage,interview_id,calendar_item_id,source,idempotency_key) values (${applicationId}::uuid,${userId}::uuid,'INTERVIEW_SCHEDULED',${current.currentStatus},'IN_PROCESS',${current.currentStage},'TECHNICAL_INTERVIEW',${String(row.id)}::uuid,${item.id}::uuid,'USER',${`interview-scheduled:${String(row.id)}`}) on conflict (user_id,idempotency_key) do nothing`;
  await createApplicationAlert({
    userId,
    applicationId,
    alertType: "INTERVIEW_UPCOMING",
    reminderWindow: "NONE",
    title: "Upcoming interview",
    body: "You have an upcoming interview for this application.",
    reasonCodes: ["INTERVIEW_SCHEDULED"],
  });
  return row;
}

export async function updateInterview(
  userId: string,
  applicationId: string,
  interviewId: string,
  input: { startsAt?: string; endsAt?: string | null; status?: string; resultCode?: string | null },
) {
  await getOwned(getDatabase(), userId, applicationId);
  const [row] =
    await getDatabase()`update public.application_interviews set starts_at=coalesce(${input.startsAt ?? null}::timestamptz,starts_at), ends_at=case when ${input.endsAt !== undefined} then ${input.endsAt ?? null}::timestamptz when ${input.startsAt !== undefined} then null else ends_at end, status=coalesce(${input.status ?? null}::public.application_interview_status,status), result_code=case when ${input.resultCode === undefined} then result_code else ${input.resultCode ?? null} end, updated_at=now() where id=${interviewId}::uuid and application_id=${applicationId}::uuid and user_id=${userId}::uuid returning *`;
  if (!row) throw new ApplicationNotFoundError("Interview not found");
  if (row.calendar_item_id && input.startsAt)
    await updateCalendarItem(userId, String(row.calendar_item_id), {
      startsAt: input.startsAt,
      ...(input.endsAt === undefined ? { endsAt: null } : { endsAt: input.endsAt }),
    });
  const eventType =
    input.status === "COMPLETED"
      ? "INTERVIEW_COMPLETED"
      : input.startsAt
        ? "INTERVIEW_RESCHEDULED"
        : null;
  if (eventType)
    await getDatabase()`insert into public.application_events (application_id,user_id,event_type,interview_id,source,idempotency_key) values (${applicationId}::uuid,${userId}::uuid,${eventType},${interviewId}::uuid,'USER',${`${eventType.toLowerCase()}:${interviewId}:${input.startsAt ?? input.status}`}) on conflict (user_id,idempotency_key) do nothing`;
  return row;
}

/** Transaction-safe in-app reminder used by the existing M9 alert mailbox. */
export async function createApplicationAlert(input: {
  userId: string;
  applicationId: string;
  alertType: "APPLICATION_ACTION_DUE" | "OA_DEADLINE_APPROACHING" | "INTERVIEW_UPCOMING";
  reminderWindow: "NONE" | "SEVEN_DAY" | "THREE_DAY" | "ONE_DAY" | "DUE";
  title: string;
  body: string;
  reasonCodes: string[];
  occurredAt?: string;
}) {
  await getOwned(getDatabase(), input.userId, input.applicationId);
  const dedupeFingerprint = fingerprint(
    `${input.userId}:${input.alertType}:${input.applicationId}:${input.reminderWindow}`,
  );
  const [row] =
    await getDatabase()`insert into public.alerts (user_id,alert_type,application_id,reminder_window,rule_version,reason_codes,title,body,dedupe_fingerprint,occurred_at) values (${input.userId}::uuid,${input.alertType},${input.applicationId}::uuid,${input.reminderWindow},'m10-v1',${input.reasonCodes},${input.title},${input.body},${dedupeFingerprint},${input.occurredAt ?? new Date().toISOString()}::timestamptz) on conflict (user_id,dedupe_fingerprint) do nothing returning *`;
  return row ?? null;
}
