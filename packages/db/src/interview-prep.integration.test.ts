import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplication, createInterview, updateInterview } from "./applications";
import {
  createInterviewPrepPlan,
  getInterviewPrepPlan,
  setInterviewPrepItemCompletion,
} from "./interview-prep";
import { createPrivacyRequest, deleteUserAccount } from "./identity";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "19000000-0000-4000-8000-000000000001";
const other = "19000000-0000-4000-8000-000000000002";
const deletingOwner = "19000000-0000-4000-8000-000000000003";

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
    await sql`delete from public.users where id in (${owner}::uuid,${other}::uuid,${deletingOwner}::uuid)`;
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
    const before =
      await sql`select id,starts_at from public.calendar_items where user_id=${owner}::uuid and metadata->>'interviewId'=${String(interview.id)} order by id`;
    await updateInterview(owner, application.id, String(interview.id), {
      startsAt: "2027-01-17T15:00:00.000Z",
    });
    const after =
      await sql`select id,starts_at from public.calendar_items where user_id=${owner}::uuid and metadata->>'interviewId'=${String(interview.id)} order by id`;
    expect(after.map((row) => String(row.id))).toEqual(before.map((row) => String(row.id)));
    expect(
      after.some((row, index) => String(row.starts_at) !== String(before[index]?.starts_at)),
    ).toBe(true);
    await sql.end();
  });

  it("cascades private prep through interview, application, and account deletion without touching shared intelligence", async () => {
    const createPrepared = async (userId: string, suffix: string) => {
      const application = await createApplication(userId, {
        opportunityId,
        cycleKey: `m19-delete-${suffix}-${randomUUID()}`,
      });
      const interview = await createInterview(userId, application.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-02-15T15:00:00.000Z",
      });
      await createInterviewPrepPlan(userId, String(interview.id));
      return { application, interview };
    };
    const sql = postgres(databaseUrl!, { max: 1 });
    const byInterview = await createPrepared(other, "interview");
    await sql`delete from public.application_interviews where id=${String(byInterview.interview.id)}::uuid and user_id=${other}::uuid`;
    const [interviewPlans] =
      await sql`select count(*)::int as count from public.interview_prep_plans where interview_id=${String(byInterview.interview.id)}::uuid`;
    expect(Number(interviewPlans?.count)).toBe(0);
    const byApplication = await createPrepared(other, "application");
    await sql`delete from public.applications where id=${byApplication.application.id}::uuid and user_id=${other}::uuid`;
    const [applicationPlans] =
      await sql`select count(*)::int as count from public.interview_prep_plans where application_id=${byApplication.application.id}::uuid`;
    expect(Number(applicationPlans?.count)).toBe(0);
    await sql`insert into public.users (id,name,email,email_verified,status) values (${deletingOwner}::uuid,'M19 Delete','m19-delete@example.test',true,'ACTIVE')`;
    const byAccount = await createPrepared(deletingOwner, "account");
    const request = await createPrivacyRequest(deletingOwner, "DELETE");
    await deleteUserAccount(deletingOwner, request);
    const [accountPlans] =
      await sql`select count(*)::int as count from public.interview_prep_plans where application_id=${byAccount.application.id}::uuid`;
    const [sharedQuestions] =
      await sql`select count(*)::int as count from public.interview_questions`;
    expect(Number(accountPlans?.count)).toBe(0);
    expect(Number(sharedQuestions?.count)).toBeGreaterThanOrEqual(0);
    await sql.end();
  });
});
