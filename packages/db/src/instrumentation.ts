import { redactValue } from "@recruitintel/shared";
import type { Sql, TransactionSql } from "postgres";

import { getDatabase } from "./index";

export type ProductEventType =
  | "CALENDAR_PLAN_CREATED"
  | "CALENDAR_PLAN_ACTIVATED"
  | "CALENDAR_ITEM_COMPLETED"
  | "JOB_VIEWED"
  | "RECRUITER_VIEWED"
  | "INTERVIEW_INTEL_VIEWED"
  | "OPPORTUNITY_VIEWED"
  | "SOURCE_POSTING_SELECTED"
  | "OPPORTUNITY_MERGED"
  | "OPPORTUNITY_SPLIT"
  | "OPPORTUNITY_SAVED"
  | "OPPORTUNITY_DISMISSED"
  | "RECOMMENDATION_SHOWN"
  | "RECOMMENDATION_OPENED"
  | "ALERT_SHOWN"
  | "ALERT_OPENED"
  | "WATCHLIST_ADDED"
  | "WATCHLIST_REMOVED";

export interface ProductEventInput {
  userId: string;
  eventType: ProductEventType;
  source: "SERVER" | "CLIENT";
  entityType:
    | "APPLICATION_PLAN"
    | "CALENDAR_ITEM"
    | "JOB"
    | "OPPORTUNITY"
    | "RECRUITER"
    | "INTERVIEW_INTEL"
    | "COMPANY"
    | "SCHOOL"
    | "ALERT";
  entityId?: string | null;
  requestId?: string | null;
  deduplicationKey?: string | null;
  context?: Record<string, unknown>;
}

export async function recordProductEventWith(
  sql: Sql | TransactionSql,
  input: ProductEventInput,
): Promise<string | null> {
  const redacted = redactValue(input.context ?? {}) as Record<string, unknown>;
  const forbidden = new Set([
    "authorization",
    "cookie",
    "access_token",
    "refresh_token",
    "id_token",
    "oauth_code",
    "email",
    "resume_text",
    "dom_html",
    "raw_payload",
  ]);
  const context = Object.fromEntries(
    Object.entries(redacted).filter(([key]) => !forbidden.has(key.toLowerCase())),
  );
  const rows = await sql`
    insert into public.product_events (
      user_id, event_type, source, entity_type, entity_id, request_id,
      deduplication_key, context
    ) values (
      ${input.userId}::uuid, ${input.eventType}, ${input.source}, ${input.entityType},
      ${input.entityId ?? null}::uuid, ${input.requestId ?? null}::uuid,
      ${input.deduplicationKey ?? null}, ${sql.json(context as never)}
    ) on conflict (user_id, deduplication_key) do nothing returning id
  `;
  return rows[0] ? String(rows[0].id) : null;
}

export async function recordProductEvent(input: ProductEventInput): Promise<string | null> {
  return recordProductEventWith(getDatabase(), input);
}

export async function productEventEntityExists(
  eventType:
    | "JOB_VIEWED"
    | "RECRUITER_VIEWED"
    | "INTERVIEW_INTEL_VIEWED"
    | "SOURCE_POSTING_SELECTED",
  entityId: string,
): Promise<boolean> {
  const table = {
    JOB_VIEWED: "jobs",
    RECRUITER_VIEWED: "recruiters",
    INTERVIEW_INTEL_VIEWED: "interview_questions",
    SOURCE_POSTING_SELECTED: "jobs",
  }[eventType];
  const sql = getDatabase();
  const [row] = await sql.unsafe(
    `select exists(select 1 from public.${table} where id = $1::uuid) as present`,
    [entityId],
  );
  return Boolean(row?.present);
}
