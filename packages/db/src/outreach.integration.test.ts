import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveOutreachDraft,
  createOutreachContact,
  createOutreachDraft,
  deleteOutreachContact,
  listOutreachContacts,
  OutreachConflictError,
  OutreachNotFoundError,
  recordManualOutreachSend,
  updateOutreachDraft,
} from "./outreach";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "00000000-0000-0000-0000-000000000001";
const second = "c0000000-0000-0000-0000-000000000018";

integration("M18 consented outreach", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`insert into public.users (id,name,email,email_verified,status) values (${second}::uuid,'M18 second','m18-second@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    await sql`delete from public.outreach_contacts where user_id in (${owner}::uuid,${second}::uuid)`;
    await sql.end();
  });
  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.outreach_contacts where user_id in (${owner}::uuid,${second}::uuid)`;
    await sql`delete from public.users where id=${second}::uuid`;
    await sql.end();
  });

  it("keeps contacts private and invalidates approval after exact-content editing", async () => {
    const contact = await createOutreachContact(owner, {
      displayName: "Public Recruiter",
      email: "PUBLIC.RECRUITER@example.test",
      contactTruth: "USER_PROVIDED",
      provenanceClass: "USER_ENTERED",
      sourceLabel: "User-entered contact",
      consentAt: "2026-08-01T00:00:00.000Z",
    });
    expect(contact.email).toBe("public.recruiter@example.test");
    expect(await listOutreachContacts(second)).toEqual([]);
    await expect(createOutreachDraft(second, { contactId: contact.id })).rejects.toBeInstanceOf(
      OutreachNotFoundError,
    );
    const initial = await createOutreachDraft(owner, { contactId: contact.id });
    const approved = await approveOutreachDraft(owner, initial.id, initial.version);
    const edited = await updateOutreachDraft(owner, approved.id, {
      subject: "Updated subject",
      body: "A grounded, user-reviewed message.",
      version: approved.version,
    });
    expect(edited.status).toBe("DRAFT");
    expect(edited.approvedVersion).toBeNull();
    await expect(recordManualOutreachSend(owner, edited.id, randomUUID())).rejects.toBeInstanceOf(
      OutreachConflictError,
    );
  });

  it("records one manual-copy send exactly once for an approved version", async () => {
    const contact = await createOutreachContact(owner, {
      displayName: "Consent Contact",
      email: `contact-${randomUUID()}@example.test`,
      contactTruth: "USER_PROVIDED",
      provenanceClass: "USER_ENTERED",
      sourceLabel: "User-entered contact",
      consentAt: "2026-08-01T00:00:00.000Z",
    });
    const created = await createOutreachDraft(owner, { contactId: contact.id });
    const approved = await approveOutreachDraft(owner, created.id, created.version);
    const key = randomUUID();
    const [first, retry] = await Promise.all([
      recordManualOutreachSend(owner, approved.id, key),
      recordManualOutreachSend(owner, approved.id, key),
    ]);
    expect(first.attemptId).toBe(retry.attemptId);
    await expect(recordManualOutreachSend(owner, approved.id, randomUUID())).rejects.toBeInstanceOf(
      OutreachConflictError,
    );
    await deleteOutreachContact(owner, contact.id);
  });
});
