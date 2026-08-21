import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authenticateServicePrincipal,
  createPrivacyRequest,
  deleteUserAccount,
  hashOpaqueToken,
  recordAuditEvent,
  serviceTokenPrefix,
} from "./identity";
import { recordProductEvent } from "./instrumentation";
import { getDatabase } from "./index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userId = "fd000000-0000-4000-8000-000000000001";
const serviceId = "fd100000-0000-4000-8000-000000000001";

integration("identity, audit, instrumentation, and privacy", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`delete from public.service_principals where id = ${serviceId}::uuid`;
      await sql`delete from public.users where id = ${userId}::uuid`;
      await sql`
        insert into public.users (id, name, email, email_verified, status)
        values (${userId}::uuid, 'Identity User', 'identity-user@example.com', true, 'ACTIVE')
      `;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await getDatabase().end();
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`delete from public.service_principals where id = ${serviceId}::uuid`;
      await sql`delete from public.users where id = ${userId}::uuid`;
    } finally {
      await sql.end();
    }
  });

  it("authenticates only an active, scoped, hashed service token", async () => {
    const token = `ri_admin_${randomBytes(9).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
    const prefix = serviceTokenPrefix(token);
    if (!prefix) throw new Error("Generated service token prefix is invalid");
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      await sql`
        insert into public.service_principals (
          id, name, kind, token_prefix, token_hash, scopes
        ) values (
          ${serviceId}::uuid, 'Integration admin', 'ADMIN_API', ${prefix},
          ${hashOpaqueToken(token)}, array['ADMIN_MUTATE']::public.service_scope[]
        )
      `;
    } finally {
      await sql.end();
    }
    expect(await authenticateServicePrincipal(token, "ADMIN_MUTATE")).toMatchObject({
      id: serviceId,
      kind: "ADMIN_API",
    });
    expect(await authenticateServicePrincipal(`${token}wrong`, "ADMIN_MUTATE")).toBeNull();
    expect(await authenticateServicePrincipal(token, "WORKER_INGEST")).toBeNull();
    const lifecycle = postgres(databaseUrl!, { max: 1 });
    try {
      await lifecycle`
        update public.service_principals set expires_at = now() - interval '1 minute'
        where id = ${serviceId}::uuid
      `;
      expect(await authenticateServicePrincipal(token, "ADMIN_MUTATE")).toBeNull();
      await lifecycle`
        update public.service_principals set expires_at = null, status = 'REVOKED', revoked_at = now()
        where id = ${serviceId}::uuid
      `;
      expect(await authenticateServicePrincipal(token, "ADMIN_MUTATE")).toBeNull();
    } finally {
      await lifecycle.end();
    }
  });

  it("persists append-only audit and instrumentation events without secrets or PII", async () => {
    const auditId = await recordAuditEvent({
      actorKind: "USER",
      actorUserId: userId,
      action: "REDACTION_CONTRACT",
      resourceType: "TEST",
      outcome: "FAILED",
      metadata: {
        providerError: "refresh_token=secret for owner@example.com",
        authorization: "Bearer secret",
        safeId: "run-123",
      },
    });
    const eventId = await recordProductEvent({
      userId,
      eventType: "JOB_VIEWED",
      source: "CLIENT",
      entityType: "JOB",
      context: {
        providerError: "access_token=secret owner@example.com",
        resume_text: "private resume",
        surface: "jobs",
      },
    });
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [audit] = await sql<{ metadata: Record<string, unknown> }[]>`
        select metadata from public.audit_events where id = ${auditId}::uuid
      `;
      const [event] = await sql<{ context: Record<string, unknown> }[]>`
        select context from public.product_events where id = ${eventId}::uuid
      `;
      if (!audit || !event) throw new Error("Expected persisted audit and product events");
      const serialized = JSON.stringify({ audit: audit.metadata, event: event.context });
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("owner@example.com");
      expect(serialized).not.toContain("private resume");
      expect(audit.metadata).toMatchObject({ safeId: "run-123" });
      await expect(
        sql`update public.audit_events set action = 'MUTATED' where id = ${auditId}::uuid`,
      ).rejects.toMatchObject({ code: "55000" });
      await expect(
        sql`delete from public.audit_events where id = ${auditId}::uuid`,
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await sql.end();
    }
  });

  it("deletes private state and encrypted credentials while retaining a minimized request record", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const ciphertext = "v1.account-deletion-encrypted-google-credential";
    try {
      await sql`
        insert into public.user_identities (issuer, account_id, provider_id, user_id)
        values (
          'https://accounts.google.com', 'privacy-delete-google-sub', 'google', ${userId}::uuid
        )
      `;
      await sql`
        insert into public.user_sessions (expires_at, token, user_id)
        values (now() + interval '1 hour', 'privacy-delete-session-token', ${userId}::uuid)
      `;
      await sql`
        insert into public.calendar_connections (
          user_id, provider, encrypted_refresh_token, connection_status
        ) values (${userId}::uuid, 'GOOGLE', ${ciphertext}, 'CONNECTED')
      `;
    } finally {
      await sql.end();
    }
    const requestId = await createPrivacyRequest(userId, "DELETE");
    await deleteUserAccount(userId, requestId);
    const verify = postgres(databaseUrl!, { max: 1 });
    try {
      const [result] = await verify`
        select p.status, p.user_id,
          (select count(*)::int from public.users where id = ${userId}::uuid) as users,
          (select count(*)::int from public.user_identities
            where user_id = ${userId}::uuid) as identities,
          (select count(*)::int from public.user_sessions
            where user_id = ${userId}::uuid) as sessions,
          (select count(*)::int from public.calendar_connections
            where encrypted_refresh_token = ${ciphertext}) as credentials
        from public.privacy_requests p where p.id = ${requestId}::uuid
      `;
      expect(result).toMatchObject({
        status: "COMPLETED",
        user_id: null,
        users: 0,
        identities: 0,
        sessions: 0,
        credentials: 0,
      });
    } finally {
      await verify.end();
    }
  });
});
