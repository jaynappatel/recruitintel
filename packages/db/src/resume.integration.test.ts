import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  correctResumeEvidence,
  createResumeDocument,
  createResumeVersion,
  deleteResumeDocument,
  listResumeEvidence,
  readResumeObject,
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
});
