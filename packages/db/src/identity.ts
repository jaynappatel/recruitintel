import { createHash, timingSafeEqual } from "node:crypto";

import { redactValue } from "@recruitintel/shared";

import { getDatabase } from "./index";

export type ActorKind = "USER" | "ADMIN" | "SERVICE" | "SYSTEM";
export type ServiceScope = "ADMIN_MUTATE" | "WORKER_INGEST" | "WORKER_CALENDAR_SYNC";

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
    await transaction`delete from public.users where id = ${userId}::uuid`;
    await transaction`
      update public.privacy_requests set status = 'COMPLETED', completed_at = now(),
        result_metadata = '{"privateRowsDeleted":true,"credentialsDeleted":true}'
      where id = ${privacyRequestId}::uuid
    `;
  });
}
