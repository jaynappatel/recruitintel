import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication, createInterview } from "./applications";
import {
  createInterviewPrepPlan,
  getInterviewPrepPlan,
  setInterviewPrepItemCompletion,
} from "./interview-prep";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "19000000-0000-4000-8000-000000000001";
const other = "19000000-0000-4000-8000-000000000002";

integration("M19 interview preparation", () => {
  let opportunityId = "";
  beforeAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    process.env.DATABASE_URL = databaseUrl;
    await sql`insert into public.users (id,name,email,email_verified,status) values (${owner}::uuid,'M19 Owner','m19-owner@example.test',true,'ACTIVE'),(${other}::uuid,'M19 Other','m19-other@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    const [opportunity] =
      await sql`select id from public.job_opportunities where status='ACTIVE' order by id limit 1`;
    if (!opportunity) throw new Error("seed opportunity missing");
    opportunityId = String(opportunity.id);
    await sql.end();
  });
  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.users where id in (${owner}::uuid,${other}::uuid)`;
    await sql.end();
  });

  it("creates a deterministic private plan, schedules idempotent Calendar tasks, and fences stale checklist writes", async () => {
    const application = await createApplication(owner, {
      opportunityId,
      cycleKey: `m19-${randomUUID()}`,
    });
    const interview = await createInterview(owner, application.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-01-15T15:00:00.000Z",
      timezone: "UTC",
    });
    const [first, second] = await Promise.all([
      createInterviewPrepPlan(owner, String(interview.id)),
      createInterviewPrepPlan(owner, String(interview.id)),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.items.length).toBeGreaterThanOrEqual(3);
    expect(first.questionIntelligence.items).toEqual([]);
    expect(first.questionIntelligence.excludedReason).toContain("license-approved");
    const item = first.items[0];
    if (!item) throw new Error("prep item missing");
    const completed = await setInterviewPrepItemCompletion(
      owner,
      String(interview.id),
      item.id,
      true,
      item.version,
    );
    expect(completed.progress.completed).toBe(1);
    await expect(
      setInterviewPrepItemCompletion(owner, String(interview.id), item.id, false, item.version),
    ).rejects.toThrow("updated elsewhere");
    await expect(getInterviewPrepPlan(other, String(interview.id))).rejects.toThrow(
      "Interview not found",
    );
    const sql = postgres(databaseUrl!, { max: 1 });
    const [calendar] =
      await sql`select count(*)::int as count from public.calendar_items where user_id=${owner}::uuid and metadata->>'interviewId'=${String(interview.id)} and type='INTERVIEW_PREP'`;
    expect(Number(calendar?.count)).toBe(first.items.length);
    await sql.end();
  });
});
