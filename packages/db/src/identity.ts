import { createHash, timingSafeEqual } from "node:crypto";

import { redactValue } from "@recruitintel/shared";

import { getDatabase } from "./index";

export type ActorKind = "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
export type ServiceScope =
  | "ADMIN_MUTATE"
  | "WORKER_INGEST"
  | "WORKER_CALENDAR_SYNC"
  | "ORCHESTRATION_READ"
  | "ORCHESTRATION_MUTATE"
  | "WORKER_SCHEDULER"
  | "WORKER_GLOBAL"
  | "WORKER_PRIVACY";

export interface UserActorRecord {
  id: string;
  email: string;
  name: string;
  status: "PENDING_IDENTITY" | "ACTIVE" | "DISABLED" | "DELETION_PENDING";
  isAdmin: boolean;
}

export interface ServicePrincipalRecord {
  id: string;
  name: string;
  kind: "ADMIN_API" | "WORKER";
  scopes: ServiceScope[];
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("Expected database text");
  return value;
}

const FORBIDDEN_METADATA_KEYS = new Set([
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

function safeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const redacted = redactValue(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(redacted).filter(([key]) => !FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())),
  );
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function serviceTokenPrefix(token: string): string | null {
  const separator = token.indexOf(".");
  if (separator < 0) return null;
  const prefix = token.slice(0, separator);
  return /^ri_(?:admin|worker)_[A-Za-z0-9_-]{8,32}$/.test(prefix) ? prefix : null;
}

export async function getUserActor(userId: string): Promise<UserActorRecord | null> {
  const sql = getDatabase();
  const [row] = await sql`
    select id, email, name, status, is_admin from public.users where id = ${userId}::uuid
  `;
  if (!row) return null;
  return {
    id: text(row.id),
    email: text(row.email),
    name: text(row.name),
    status: text(row.status) as UserActorRecord["status"],
    isAdmin: Boolean(row.is_admin),
  };
}

export async function activatePendingUser(userId: string, verifiedEmail: string): Promise<void> {
  if (verifiedEmail.endsWith("@recruitintel.invalid")) return;
  const sql = getDatabase();
  await sql`
    update public.users set status = 'ACTIVE'
    where id = ${userId}::uuid and status = 'PENDING_IDENTITY'
      and email_verified and lower(email) = lower(${verifiedEmail})
  `;
}

export async function authenticateServicePrincipal(
  token: string,
  requiredScope: ServiceScope,
  lastUsedIpHash: string | null = null,
): Promise<ServicePrincipalRecord | null> {
  const prefix = serviceTokenPrefix(token);
  if (!prefix) return null;
  const suppliedHash = hashOpaqueToken(token);
  const sql = getDatabase();
  const [row] = await sql`
    select id, name, kind, token_hash, scopes from public.service_principals
    where token_prefix = ${prefix} and status = 'ACTIVE'
      and (expires_at is null or expires_at > now())
  `;
  if (!row) return null;
  const expected = Buffer.from(text(row.token_hash), "hex");
  const supplied = Buffer.from(suppliedHash, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const scopes = (row.scopes as ServiceScope[]) ?? [];
  if (!scopes.includes(requiredScope)) return null;
  await sql`
    update public.service_principals set last_used_at = now(),
      last_used_ip_hash = ${lastUsedIpHash}
    where id = ${text(row.id)}::uuid
  `;
  return {
    id: text(row.id),
    name: text(row.name),
    kind: text(row.kind) as ServicePrincipalRecord["kind"],
    scopes,
  };
}

export interface AuditEventInput {
  actorKind: ActorKind;
  actorUserId?: string | null;
  actorServicePrincipalId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "SUCCEEDED" | "DENIED" | "FAILED";
  requestId?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  const sql = getDatabase();
  const metadata = safeMetadata(input.metadata ?? {});
  const [row] = await sql`
    insert into public.audit_events (
      actor_kind, actor_user_id, actor_service_principal_id, action,
      resource_type, resource_id, outcome, request_id, ip_hash, metadata
    ) values (
      ${input.actorKind}, ${input.actorUserId ?? null}::uuid,
      ${input.actorServicePrincipalId ?? null}::uuid, ${input.action},
      ${input.resourceType}, ${input.resourceId ?? null}::uuid, ${input.outcome},
      ${input.requestId ?? null}::uuid, ${input.ipHash ?? null},
      ${sql.json(metadata as never)}
    ) returning id
  `;
  return text(row?.id);
}

export async function createPrivacyRequest(
  userId: string,
  requestType: "EXPORT" | "DELETE",
): Promise<string> {
  const sql = getDatabase();
  const fingerprint = hashOpaqueToken(`privacy-user:${userId}`);
  const [row] = await sql`
    insert into public.privacy_requests (user_id, user_fingerprint, request_type)
    values (${userId}::uuid, ${fingerprint}, ${requestType}) returning id
  `;
  return text(row?.id);
}

/** Policy-shaped private export. Secrets and encrypted object bytes are intentionally omitted. */
export async function exportUserAccount(userId: string) {
  const sql = getDatabase();
  const [user] = await sql`select id, name, created_at from public.users where id=${userId}::uuid`;
  if (!user) throw new Error("User not found");
  const resumes =
    await sql`select id, original_filename, media_type, byte_size, content_hash, status, created_at
    from public.resume_documents where user_id=${userId}::uuid order by created_at,id`;
  const versions =
    await sql`select id, document_id, version_number, text_hash, parser_version, created_at, superseded_at
    from public.resume_versions where user_id=${userId}::uuid order by created_at,id`;
  const parseRuns = await sql`select id, resume_version_id, status, parser_version, input_hash,
    diagnostics, error_code, idempotency_key, started_at, completed_at, created_at
    from public.resume_parse_runs where user_id=${userId}::uuid order by created_at,id`;
  const evidence =
    await sql`select id, resume_version_id, evidence_type, normalized_value, source, review_status,
    page_number, section, source_span, parser_version, revision, parent_evidence_id, created_at, superseded_at
    from public.candidate_evidence where user_id=${userId}::uuid order by created_at,id`;
  const evidenceConfirmations =
    await sql`select id, evidence_id, disposition, replacement_evidence_id, reason_code, created_at
    from public.evidence_confirmations where user_id=${userId}::uuid order by created_at,id`;
  const matches = await sql`select match.id, match.resume_version_id, match.opportunity_id,
    match.requirement_set_id, requirement.version as requirement_set_version,
    requirement.algorithm_version as requirement_algorithm_version,
    requirement.input_fingerprint as requirement_input_fingerprint,
    match.eligibility, match.score, match.reason_codes, match.algorithm_version,
    match.evidence_fingerprint, match.generated_at, match.ranking_decision_id,
    match.recommendation_impression_id
    from public.resume_job_matches match
    join public.job_requirement_sets requirement on requirement.id=match.requirement_set_id
    where match.user_id=${userId}::uuid order by match.generated_at,match.id`;
  const matchEvidence =
    await sql`select id, match_id, requirement_key, relation, evidence_id, reason_code, citation
    from public.match_evidence where user_id=${userId}::uuid order by match_id,requirement_key,id`;
  const applications =
    await sql`select id, opportunity_id, resume_version_id, match_id, current_status, current_stage,
    origin_recommendation_impression_id, cycle_key, created_at, updated_at
    from public.applications where user_id=${userId}::uuid order by created_at,id`;
  const applicationEvents =
    await sql`select id, application_id, event_type, from_status, to_status, from_stage,
    to_stage, occurred_at, recorded_at, source, reason_code, schema_version, idempotency_key
    from public.application_events where user_id=${userId}::uuid order by recorded_at,id`;
  const applicationAssessments =
    await sql`select id, application_id, type as assessment_type, status, received_at, due_at,
    completed_at, provider_name, created_at, updated_at
    from public.application_assessments where user_id=${userId}::uuid order by created_at,id`;
  const applicationInterviews =
    await sql`select id, application_id, interview_type, status, starts_at, ends_at,
    timezone, duration_minutes, result_code, created_at, updated_at
    from public.application_interviews where user_id=${userId}::uuid order by created_at,id`;
  return {
    user: {
      id: String(user.id),
      name: String(user.name),
      createdAt: new Date(user.created_at as string).toISOString(),
    },
    resumes,
    versions,
    parseRuns,
    evidence,
    evidenceConfirmations,
    matches,
    matchEvidence,
    applications,
    applicationEvents,
    applicationAssessments,
    applicationInterviews,
  };
}

export async function deleteUserAccount(userId: string, privacyRequestId: string): Promise<void> {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction`
      update public.users set status = 'DELETION_PENDING'
      where id = ${userId}::uuid and status in ('ACTIVE', 'PENDING_IDENTITY') returning id
    `;
    if (!rows[0]) throw new Error("User is not eligible for deletion");
    await transaction`
      update public.privacy_requests set status = 'IN_PROGRESS', started_at = now()
      where id = ${privacyRequestId}::uuid and user_id = ${userId}::uuid
        and request_type = 'DELETE' and status = 'PENDING'
    `;
    await transaction`
      insert into public.audit_events (
        actor_kind, actor_user_id, action, resource_type, resource_id, outcome, metadata
      ) values (
        'USER', ${userId}::uuid, 'ACCOUNT_DELETED', 'USER', ${userId}::uuid,
        'SUCCEEDED', '{"credentialCleanup":"best_effort_provider_revoke_then_local_delete"}'
      )
    `;
    await transaction`
      update public.work_items set status='CANCELLED', completed_at=now(),
        cancel_requested_at=coalesce(cancel_requested_at, now())
      where user_id=${userId}::uuid and status in ('READY','RETRY_WAIT','LEASED','RUNNING')
    `;
    await transaction`delete from public.users where id = ${userId}::uuid`;
    await transaction`
      update public.privacy_requests set status = 'COMPLETED', completed_at = now(),
        result_metadata = '{"privateRowsDeleted":true,"credentialsDeleted":true}'
      where id = ${privacyRequestId}::uuid
    `;
  });
}
