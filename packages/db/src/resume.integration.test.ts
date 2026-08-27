import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  correctResumeEvidence,
  createResumeDocument,
  createResumeVersion,
  deleteResumeDocument,
  listResumeEvidence,
  materializeRequirementSet,
  materializeResumeJobMatch,
  readResumeObject,
  ResumeConflictError,
  reviewResumeEvidence,
} from "./resume";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "b1000000-0000-4000-8000-000000000001";
const otherOwner = "b1000000-0000-4000-8000-000000000002";

integration("M11 resume evidence persistence", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`insert into public.users (id,name,email,email_verified,status) values (${owner}::uuid,'M11 Resume User','m11-resume@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    await sql`insert into public.users (id,name,email,email_verified,status) values (${otherOwner}::uuid,'M11 Other User','m11-other@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    await sql.end();
  });
  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.users where id=${owner}::uuid`;
    await sql`delete from public.users where id=${otherOwner}::uuid`;
    await sql.end();
  });

  it("preserves extracted evidence and appends corrections", async () => {
    const document = await createResumeDocument(owner, {
      originalFilename: "resume.txt",
      mediaType: "text/plain",
      bytes: "Python and React",
    });
    const version = await createResumeVersion(owner, document.id, "Python and React");
    const extracted = await listResumeEvidence(owner, version.id);
    expect(extracted.map((item) => item.normalizedValue.skill).sort()).toEqual(["python", "react"]);
    await reviewResumeEvidence(owner, extracted[0]!.id, "CONFIRMED");
    const corrected = await correctResumeEvidence(owner, extracted[0]!.id, { skill: "PyTorch" });
    expect(corrected.source).toBe("USER_CORRECTED");
    expect(corrected.reviewStatus).toBe("CONFIRMED");
    const history = await listResumeEvidence(owner, version.id);
    expect(history.some((item) => item.reviewStatus === "SUPERSEDED")).toBe(true);
    expect(history.some((item) => item.source === "USER_CORRECTED")).toBe(true);
  });

  it("keeps resume objects private and deletes bytes idempotently", async () => {
    const bytes = Buffer.from("private resume object lifecycle");
    const document = await createResumeDocument(owner, {
      originalFilename: "lifecycle.txt",
      mediaType: "text/plain",
      bytes,
    });
    const duplicate = await createResumeDocument(owner, {
      originalFilename: "lifecycle-copy.txt",
      mediaType: "text/plain",
      bytes,
    });
    expect(duplicate.id).toBe(document.id);
    await expect(readResumeObject(owner, document.id)).resolves.toEqual(bytes);
    await expect(readResumeObject(otherOwner, document.id)).rejects.toThrow();

    await deleteResumeDocument(owner, document.id);
    await deleteResumeDocument(owner, document.id);
    await expect(readResumeObject(owner, document.id)).rejects.toThrow();

    const sql = postgres(databaseUrl!, { max: 1 });
    const [row] = await sql`select status, storage_key, storage_ciphertext, storage_nonce
      from public.resume_documents where id=${document.id}::uuid`;
    await sql.end();
    expect(row?.status).toBe("DELETED");
    expect(row?.storage_key).toBeNull();
    expect(row?.storage_ciphertext).toBeNull();
    expect(row?.storage_nonce).toBeNull();
  });

  it("serializes concurrent reviews and rejects stale evidence clients", async () => {
    const document = await createResumeDocument(owner, {
      originalFilename: "concurrency.txt",
      mediaType: "text/plain",
      bytes: "Python and React",
    });
    const version = await createResumeVersion(owner, document.id, "Python and React");
    const evidence = (await listResumeEvidence(owner, version.id))[0]!;
    const results = await Promise.allSettled([
      reviewResumeEvidence(owner, evidence.id, "CONFIRMED", undefined, 0),
      reviewResumeEvidence(owner, evidence.id, "CONFIRMED", undefined, 0),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const sql = postgres(databaseUrl!, { max: 1 });
    const confirmations =
      await sql`select count(*)::int as count from public.evidence_confirmations where evidence_id=${evidence.id}::uuid`;
    await sql.end();
    expect(Number(confirmations[0]?.count)).toBe(1);
    await expect(
      reviewResumeEvidence(owner, evidence.id, "REJECTED", undefined, 0),
    ).rejects.toBeInstanceOf(ResumeConflictError);
  });

  it("allows only one competing correction and preserves the original claim", async () => {
    const document = await createResumeDocument(owner, {
      originalFilename: "correction-race.txt",
      mediaType: "text/plain",
      bytes: "Python",
    });
    const version = await createResumeVersion(owner, document.id, "Python");
    const evidence = (await listResumeEvidence(owner, version.id))[0]!;
    const outcomes = await Promise.allSettled([
      correctResumeEvidence(owner, evidence.id, { skill: "Python" }, undefined, 1),
      correctResumeEvidence(
        owner,
        evidence.id,
        { skill: "Python", framework: "FastAPI" },
        undefined,
        1,
      ),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    const history = await listResumeEvidence(owner, version.id);
    expect(
      history.some((item) => item.id === evidence.id && item.reviewStatus === "SUPERSEDED"),
    ).toBe(true);
    expect(history.filter((item) => item.source === "USER_CORRECTED")).toHaveLength(1);
  });

  it("creates a new match version when evidence changes", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const [opportunity] = await sql`select id from public.job_opportunities
        where status='ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
        limit 1`;
    await sql.end();
    if (!opportunity) return;
    const document = await createResumeDocument(owner, {
      originalFilename: "match-version.txt",
      mediaType: "text/plain",
      bytes: "Python",
    });
    const version = await createResumeVersion(owner, document.id, "Python");
    const evidence = (await listResumeEvidence(owner, version.id))[0]!;
    const first = await materializeResumeJobMatch(owner, version.id, String(opportunity.id));
    await correctResumeEvidence(owner, evidence.id, { skill: "Python", framework: "FastAPI" });
    const second = await materializeResumeJobMatch(owner, version.id, String(opportunity.id));
    expect(second.id).not.toBe(first.id);
    expect(first.resumeVersionId).toBe(version.id);
    expect(second.resumeVersionId).toBe(version.id);
  });

  it("serializes duplicate uploads, versions, requirement sets, and exact matches", async () => {
    const content = "M11 concurrency Python TypeScript SQL";
    const documents = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createResumeDocument(owner, {
          originalFilename: `concurrent-${index}.txt`,
          mediaType: "text/plain",
          bytes: content,
        }),
      ),
    );
    expect(new Set(documents.map((item) => item.id)).size).toBe(1);
    const documentId = documents[0]!.id;
    const versions = await Promise.all(
      Array.from({ length: 4 }, () => createResumeVersion(owner, documentId, content)),
    );
    expect(new Set(versions.map((item) => item.versionNumber))).toEqual(new Set([1, 2, 3, 4]));

    const sql = postgres(databaseUrl!, { max: 1 });
    const [opportunity] = await sql`select id from public.job_opportunities
        where status='ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
        order by id limit 1`;
    await sql.end();
    if (!opportunity) throw new Error("Seed opportunity missing");
    const opportunityId = String(opportunity.id);
    const requirementSets = await Promise.all(
      Array.from({ length: 8 }, () => materializeRequirementSet(opportunityId)),
    );
    expect(new Set(requirementSets.map((item) => String(item.id))).size).toBe(1);
    const matches = await Promise.all(
      Array.from({ length: 8 }, () =>
        materializeResumeJobMatch(owner, versions[0]!.id, opportunityId),
      ),
    );
    expect(new Set(matches.map((item) => item.id)).size).toBe(1);
    expect(new Set(matches.map((item) => item.evidenceFingerprint)).size).toBe(1);
    expect(new Set(matches.map((item) => item.requirementInputFingerprint)).size).toBe(1);
  });

  it("enforces compound M11 ownership at the database boundary", async () => {
    const a = await createResumeDocument(owner, {
      originalFilename: "owner-a.txt",
      mediaType: "text/plain",
      bytes: "Python",
    });
    const b = await createResumeDocument(otherOwner, {
      originalFilename: "owner-b.txt",
      mediaType: "text/plain",
      bytes: "React",
    });
    const av = await createResumeVersion(owner, a.id, "Python");
    const bv = await createResumeVersion(otherOwner, b.id, "React");
    const ae = (await listResumeEvidence(owner, av.id))[0]!;
    const sql = postgres(databaseUrl!, { max: 1 });
    await expect(readResumeObject(otherOwner, a.id)).rejects.toThrow();
    await expect(sql`insert into public.candidate_evidence
      (user_id,resume_version_id,evidence_type,normalized_value,source,evidence_hash)
      values (${otherOwner}::uuid,${av.id}::uuid,'SKILL','{"skill":"Python"}'::jsonb,'DETERMINISTIC_PARSE',${"f".repeat(64)})`).rejects.toThrow();
    const [opportunity] = await sql`select id from public.job_opportunities
        where status='ACTIVE' and company_id='10000000-0000-0000-0000-000000000001'::uuid
        limit 1`;
    if (opportunity) {
      const [application] =
        await sql`select id from public.applications where user_id=${owner}::uuid limit 1`;
      if (application) {
        await expect(
          sql`update public.applications set resume_version_id=${bv.id}::uuid where id=${String(application.id)}::uuid`,
        ).rejects.toThrow();
      }
    }
    await sql.end();
    await expect(reviewResumeEvidence(otherOwner, ae.id, "CONFIRMED")).rejects.toThrow();
    await expect(deleteResumeDocument(otherOwner, a.id)).rejects.toThrow("Resume not found");
    await expect(readResumeObject(owner, a.id)).resolves.toEqual(Buffer.from("Python"));
  });
});
