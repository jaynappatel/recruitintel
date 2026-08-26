import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changeApplicationStatus,
  createApplication,
  createApplicationAlert,
  createAssessment,
  createInterview,
  getApplication,
  getApplicationTimeline,
  updateAssessment,
  updateInterview,
} from "./applications";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "00000000-0000-0000-0000-000000000001";
const second = "a0000000-0000-0000-0000-000000000002";

integration("M10 application lifecycle", () => {
  let opportunityId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [opportunity] =
        await sql`select id from public.job_opportunities where status='ACTIVE' order by id limit 1`;
      opportunityId = String(opportunity.id);
      await sql`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-2026'`;
      await sql`insert into public.users (id,name,email,email_verified,status) values (${second}::uuid,'M10 Second','m10-second@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.users where id=${second}::uuid`;
    await sql.end();
  });

  it("persists an idempotent OA/interview lifecycle and isolates owners", async () => {
    const a = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-2026",
      applicationUrlUsed: "https://apply.example/m10",
    });
    const b = await createApplication(second, {
      opportunityId,
      cycleKey: "m10-2026",
      applicationUrlUsed: "https://apply.example/m10",
    });
    expect(a.id).not.toBe(b.id);
    await expect(getApplication(second, a.id)).rejects.toThrow();
    await expect(
      createApplication(owner, {
        opportunityId,
        cycleKey: "m10-2026",
        applicationUrlUsed: "https://apply.example/m10",
      }),
    ).rejects.toThrow();
    await changeApplicationStatus(owner, a.id, { status: "APPLIED", idempotencyKey: "m10-submit" });
    await changeApplicationStatus(owner, a.id, { status: "APPLIED", idempotencyKey: "m10-submit" });
    const assessment = await createAssessment(owner, a.id, {
      type: "OA",
      dueAt: "2027-01-02T12:00:00.000Z",
      idempotencyKey: "m10-oa",
    });
    await updateAssessment(owner, a.id, String(assessment.id), {
      status: "COMPLETED",
      completedAt: "2027-01-01T12:00:00.000Z",
    });
    const interview = await createInterview(owner, a.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-01-03T12:00:00.000Z",
      endsAt: "2027-01-03T13:00:00.000Z",
      timezone: "America/Chicago",
    });
    await updateInterview(owner, a.id, String(interview.id), {
      startsAt: "2027-01-04T12:00:00.000Z",
    });
    await updateInterview(owner, a.id, String(interview.id), { status: "COMPLETED" });
    await createApplicationAlert({
      userId: owner,
      applicationId: a.id,
      alertType: "INTERVIEW_UPCOMING",
      reminderWindow: "NONE",
      title: "Interview",
      body: "Upcoming interview",
      reasonCodes: ["INTERVIEW_SCHEDULED"],
    });
    await createApplicationAlert({
      userId: owner,
      applicationId: a.id,
      alertType: "INTERVIEW_UPCOMING",
      reminderWindow: "NONE",
      title: "Interview",
      body: "Upcoming interview",
      reasonCodes: ["INTERVIEW_SCHEDULED"],
    });
    await changeApplicationStatus(owner, a.id, { status: "OFFER", idempotencyKey: "m10-offer" });
    const timeline = await getApplicationTimeline(owner, a.id);
    expect(timeline.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "APPLICATION_SUBMITTED",
        "OA_RECEIVED",
        "OA_COMPLETED",
        "INTERVIEW_SCHEDULED",
        "INTERVIEW_RESCHEDULED",
        "INTERVIEW_COMPLETED",
        "OFFER_RECEIVED",
      ]),
    );
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [alerts] =
        await sql`select count(*)::int as count from public.alerts where user_id=${owner}::uuid and application_id=${a.id}::uuid`;
      const [calendar] =
        await sql`select count(*)::int as count from public.calendar_items where user_id=${owner}::uuid and application_id=${a.id}::uuid`;
      expect(Number(alerts.count)).toBe(2);
      expect(Number(calendar.count)).toBe(2);
    } finally {
      await sql.end();
    }
  });
});
