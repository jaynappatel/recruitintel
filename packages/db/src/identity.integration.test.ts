import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authenticateServicePrincipal,
  createPrivacyRequest,
  createExtensionGrant,
  deleteUserAccount,
  exportUserAccount,
  hashOpaqueToken,
  recordAuditEvent,
  serviceTokenPrefix,
} from "./identity";
import { recordProductEvent } from "./instrumentation";
import { getDatabase } from "./index";
import {
  changeApplicationStatus,
  createApplication,
  createAssessment,
  createInterview,
} from "./applications";
import {
  createResumeDocument,
  createResumeVersion,
  listResumeEvidence,
  materializeResumeJobMatch,
  queueResumeParseRun,
  readResumeObject,
  reviewResumeEvidence,
} from "./resume";
import { uploadBrowserScan } from "./browser-companion";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userId = "fd000000-0000-4000-8000-000000000001";
const secondUserId = "fd000000-0000-4000-8000-000000000002";
const serviceId = "fd100000-0000-4000-8000-000000000001";

integration("identity, audit, instrumentation, and privacy", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`delete from public.service_principals where id = ${serviceId}::uuid`;
      await sql`delete from public.users where id = ${userId}::uuid`;
      await sql`delete from public.users where id = ${secondUserId}::uuid`;
      await sql`
        insert into public.users (id, name, email, email_verified, status)
        values (${userId}::uuid, 'Identity User', 'identity-user@example.com', true, 'ACTIVE')
      `;
      await sql`
        insert into public.users (id, name, email, email_verified, status)
        values (${secondUserId}::uuid, 'Identity Second User', 'identity-second@example.com', true, 'ACTIVE')
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
      await sql`delete from public.users where id = ${secondUserId}::uuid`;
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

  it("exports policy-approved M10/M11 data without secrets or another user's data", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [opportunity] = await sql`
        select id from public.job_opportunities
        where status = 'ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
        order by id limit 1
      `;
      if (!opportunity) throw new Error("Seed opportunity missing");
      const application = await createApplication(userId, {
        opportunityId: String(opportunity.id),
        cycleKey: "privacy-export-m10",
        applicationUrlUsed: "https://apply.example/privacy-export",
      });
      await changeApplicationStatus(userId, application.id, {
        status: "APPLIED",
        idempotencyKey: "privacy-export-submit",
      });
      const assessment = await createAssessment(userId, application.id, {
        type: "OA",
        idempotencyKey: "privacy-export-oa",
      });
      if (!assessment) throw new Error("Assessment creation failed");
      const interview = await createInterview(userId, application.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-06-01T12:00:00.000Z",
        endsAt: "2027-06-01T13:00:00.000Z",
        timezone: "UTC",
      });
      const document = await createResumeDocument(userId, {
        originalFilename: "privacy-export-m11.txt",
        mediaType: "text/plain",
        bytes: "Python TypeScript privacy export",
      });
      const version = await createResumeVersion(
        userId,
        document.id,
        "Python TypeScript privacy export",
      );
      await queueResumeParseRun(userId, version.id);
      const evidence = (await listResumeEvidence(userId, version.id))[0];
      if (!evidence) throw new Error("Resume evidence missing");
      await reviewResumeEvidence(userId, evidence.id, "CONFIRMED");
      const match = await materializeResumeJobMatch(userId, version.id, String(opportunity.id));
      await createResumeDocument(secondUserId, {
        originalFilename: "user-b-private-marker.txt",
        mediaType: "text/plain",
        bytes: "USER_B_PRIVATE_MARKER",
      });
      await sql`insert into public.user_sessions (expires_at, token, user_id)
        values (now()+interval '1 hour','privacy-export-session-secret',${userId}::uuid)`;
      await sql`insert into public.calendar_connections
        (user_id,provider,encrypted_refresh_token,connection_status)
        values (${userId}::uuid,'GOOGLE','privacy-export-google-secret','CONNECTED')
        on conflict (user_id,provider) do update set
          encrypted_refresh_token=excluded.encrypted_refresh_token,
          connection_status=excluded.connection_status`;
      const requestId = await createPrivacyRequest(userId, "EXPORT");
      const extensionGrant = await createExtensionGrant(userId, {
        name: "privacy export extension",
        scopes: ["PAGE_SCAN"],
        expiresInSeconds: 3600,
      });
      const browserScan = await uploadBrowserScan(userId, extensionGrant.id, {
        protocolVersion: 1,
        pageUrl: "https://privacy-export.example.test/careers?private=1",
        pageTitle: "Privacy careers",
        jsonLdCount: 0,
        linkCount: 1,
        candidates: [
          {
            kind: "GRID",
            url: "https://privacy-export.example.test/careers/role#private",
            title: "Privacy Engineer",
            descriptionExcerpt: "Private browser capture",
          },
        ],
      });
      const exported = await exportUserAccount(userId);
      const [request] = await sql`
        select id, user_id, request_type, status from public.privacy_requests where id = ${requestId}::uuid
      `;
      const [counts] = await sql`
        select
          (select count(*)::int from public.application_events where application_id = ${application.id}::uuid) events,
          (select count(*)::int from public.application_assessments where id = ${String(assessment.id)}::uuid and user_id = ${userId}::uuid) assessments,
          (select count(*)::int from public.application_interviews where id = ${String(interview.id)}::uuid and user_id = ${userId}::uuid) interviews,
          (select count(*)::int from public.applications where user_id = ${secondUserId}::uuid) other_user_apps
      `;
      expect(request).toMatchObject({
        id: requestId,
        user_id: userId,
        request_type: "EXPORT",
        status: "PENDING",
      });
      expect(Number(counts?.events)).toBeGreaterThan(0);
      expect(Number(counts?.assessments)).toBe(1);
      expect(Number(counts?.interviews)).toBe(1);
      expect(Number(counts?.other_user_apps)).toBe(0);
      expect(exported.resumes.some((row) => String(row.id) === document.id)).toBe(true);
      expect(exported.versions.some((row) => String(row.id) === version.id)).toBe(true);
      expect(exported.parseRuns.some((row) => String(row.resume_version_id) === version.id)).toBe(
        true,
      );
      expect(exported.evidence.some((row) => String(row.id) === evidence.id)).toBe(true);
      expect(exported.evidenceConfirmations).toHaveLength(1);
      expect(exported.matches.some((row) => String(row.id) === match.id)).toBe(true);
      expect(exported.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: match.id,
            requirement_set_version: match.requirementSetVersion,
            requirement_algorithm_version: match.requirementAlgorithmVersion,
            requirement_input_fingerprint: match.requirementInputFingerprint,
            evidence_fingerprint: match.evidenceFingerprint,
          }),
        ]),
      );
      expect(exported.applications.some((row) => String(row.id) === application.id)).toBe(true);
      expect(exported.applicationEvents.length).toBeGreaterThan(0);
      expect(exported.applicationAssessments).toHaveLength(1);
      expect(exported.applicationInterviews).toHaveLength(1);
      expect(exported.extensionGrants.some((row) => String(row.id) === extensionGrant.id)).toBe(
        true,
      );
      expect(exported.browserScans.some((row) => String(row.id) === browserScan.id)).toBe(true);
      expect(exported.browserCandidates).toHaveLength(1);
      const serialized = JSON.stringify(exported);
      expect(serialized).not.toContain(secondUserId);
      expect(serialized).not.toContain("user-b-private-marker");
      expect(serialized).not.toContain("privacy-export-session-secret");
      expect(serialized).not.toContain("privacy-export-google-secret");
      expect(serialized).not.toMatch(
        /encrypted_refresh_token|storage_ciphertext|storage_key|session_token/i,
      );
    } finally {
      await sql.end();
    }
  });

  it("deletes private state and encrypted credentials while retaining a minimized request record", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const ciphertext = "v1.account-deletion-encrypted-google-credential";
    let deletedResumeDocumentId = "";
    let browserScanId = "";
    try {
      const [opportunity] = await sql`
        select id, company_id from public.job_opportunities
        where status = 'ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
        order by id limit 1
      `;
      if (!opportunity) throw new Error("Seed opportunity missing");
      const userApplication = await createApplication(userId, {
        opportunityId: String(opportunity.id),
        cycleKey: "privacy-delete-m10",
        applicationUrlUsed: "https://apply.example/privacy-delete",
      });
      await createApplication(secondUserId, {
        opportunityId: String(opportunity.id),
        cycleKey: "privacy-delete-m10",
        applicationUrlUsed: "https://apply.example/privacy-delete-second",
      });
      await changeApplicationStatus(userId, userApplication.id, {
        status: "APPLIED",
        idempotencyKey: "privacy-delete-submit",
      });
      const assessment = await createAssessment(userId, userApplication.id, {
        type: "OA",
        dueAt: "2027-05-01T12:00:00.000Z",
        idempotencyKey: "privacy-delete-oa",
      });
      if (!assessment) throw new Error("Assessment creation failed");
      await createInterview(userId, userApplication.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-05-02T12:00:00.000Z",
        endsAt: "2027-05-02T13:00:00.000Z",
        timezone: "UTC",
      });
      const document = await createResumeDocument(userId, {
        originalFilename: "privacy-delete-m11.txt",
        mediaType: "text/plain",
        bytes: "Python privacy deletion",
      });
      deletedResumeDocumentId = document.id;
      const extensionGrant = await createExtensionGrant(userId, {
        name: "privacy delete extension",
        scopes: ["PAGE_SCAN"],
        expiresInSeconds: 3600,
      });
      const browserScan = await uploadBrowserScan(userId, extensionGrant.id, {
        protocolVersion: 1,
        pageUrl: "https://privacy-delete.example.test/careers",
        pageTitle: "Delete careers",
        jsonLdCount: 0,
        linkCount: 1,
        candidates: [
          {
            kind: "GRID",
            url: "https://privacy-delete.example.test/careers/role",
            title: "Delete Engineer",
          },
        ],
      });
      browserScanId = browserScan.id;
      const version = await createResumeVersion(userId, document.id, "Python privacy deletion");
      await queueResumeParseRun(userId, version.id);
      await materializeResumeJobMatch(userId, version.id, String(opportunity.id));
      await expect(readResumeObject(userId, document.id)).resolves.toEqual(
        Buffer.from("Python privacy deletion"),
      );
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
        on conflict (user_id,provider) do update set
          encrypted_refresh_token=excluded.encrypted_refresh_token,
          connection_status=excluded.connection_status
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
          (select count(*)::int from public.applications
            where user_id = ${userId}::uuid) as applications,
          (select count(*)::int from public.application_events
            where user_id = ${userId}::uuid) as application_events,
          (select count(*)::int from public.application_assessments
            where user_id = ${userId}::uuid) as assessments,
          (select count(*)::int from public.application_interviews
            where user_id = ${userId}::uuid) as interviews,
          (select count(*)::int from public.calendar_items
            where user_id = ${userId}::uuid and application_id is not null) as application_calendar,
          (select count(*)::int from public.applications
            where user_id = ${secondUserId}::uuid) as second_user_applications,
          (select count(*)::int from public.job_opportunities
            where id = (select id from public.job_opportunities
              where status = 'ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
              order by id limit 1)) as shared_opportunities,
          (select count(*)::int from public.calendar_connections
            where encrypted_refresh_token = ${ciphertext}) as credentials,
          (select count(*)::int from public.resume_documents
            where user_id = ${userId}::uuid) as resume_documents,
          (select count(*)::int from public.resume_versions
            where user_id = ${userId}::uuid) as resume_versions,
          (select count(*)::int from public.resume_parse_runs
            where user_id = ${userId}::uuid) as resume_parse_runs,
          (select count(*)::int from public.candidate_evidence
            where user_id = ${userId}::uuid) as candidate_evidence,
          (select count(*)::int from public.resume_job_matches
            where user_id = ${userId}::uuid) as resume_matches,
          (select count(*)::int from public.work_items
            where user_id = ${userId}::uuid) as work_items,
          (select count(*)::int from public.resume_documents
            where user_id = ${secondUserId}::uuid) as second_user_resumes,
          (select count(*)::int from public.extension_grants
            where user_id = ${userId}::uuid) as extension_grants,
          (select count(*)::int from public.browser_scan_sessions
            where user_id = ${userId}::uuid) as browser_scans,
          (select count(*)::int from public.page_job_candidates
            where user_id = ${userId}::uuid) as browser_candidates,
          (select count(*)::int from public.browser_scan_sessions
            where id = ${browserScanId}::uuid) as deleted_browser_scan
        from public.privacy_requests p where p.id = ${requestId}::uuid
      `;
      expect(result).toMatchObject({
        status: "COMPLETED",
        user_id: null,
        users: 0,
        identities: 0,
        sessions: 0,
        applications: 0,
        application_events: 0,
        assessments: 0,
        interviews: 0,
        application_calendar: 0,
        second_user_applications: 1,
        shared_opportunities: 1,
        credentials: 0,
        resume_documents: 0,
        resume_versions: 0,
        resume_parse_runs: 0,
        candidate_evidence: 0,
        resume_matches: 0,
        work_items: 0,
        second_user_resumes: 1,
        extension_grants: 0,
        browser_scans: 0,
        browser_candidates: 0,
        deleted_browser_scan: 0,
      });
      await expect(readResumeObject(userId, deletedResumeDocumentId)).rejects.toThrow();
    } finally {
      await verify.end();
    }
  });
});
