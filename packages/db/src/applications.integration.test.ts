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
      if (!opportunity) throw new Error("seed opportunity missing");
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
    if (!assessment) throw new Error("assessment missing");
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
      expect(Number(alerts?.count)).toBe(2);
      expect(Number(calendar?.count)).toBe(2);
    } finally {
      await sql.end();
    }
  });

  it("holds PostgreSQL invariants under concurrent application and alert writes", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-race'`;
    await cleanup.end();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        createApplication(owner, {
          opportunityId,
          cycleKey: "m10-race",
          applicationUrlUsed: "https://apply.example/race",
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const app = (
      results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<
        Awaited<ReturnType<typeof createApplication>>
      >
    ).value;
    await Promise.all([
      createApplicationAlert({
        userId: owner,
        applicationId: app.id,
        alertType: "APPLICATION_ACTION_DUE",
        reminderWindow: "DUE",
        title: "Action",
        body: "Action due",
        reasonCodes: ["NEXT_ACTION"],
      }),
      createApplicationAlert({
        userId: owner,
        applicationId: app.id,
        alertType: "APPLICATION_ACTION_DUE",
        reminderWindow: "DUE",
        title: "Action",
        body: "Action due",
        reasonCodes: ["NEXT_ACTION"],
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.applications where user_id=${owner}::uuid and opportunity_id=${opportunityId}::uuid and cycle_key='m10-race' and archived_at is null) applications,
        (select count(*)::int from public.alerts where user_id=${owner}::uuid and application_id=${app.id}::uuid and alert_type='APPLICATION_ACTION_DUE') alerts`;
      expect(Number(counts?.applications)).toBe(1);
      expect(Number(counts?.alerts)).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("serializes identical status transitions and assessment completion", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-status-race'`;
    await cleanup.end();
    const app = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-status-race",
      applicationUrlUsed: "https://apply.example/status-race",
    });
    const statuses = await Promise.allSettled([
      changeApplicationStatus(owner, app.id, { status: "APPLIED", idempotencyKey: "status-race" }),
      changeApplicationStatus(owner, app.id, { status: "APPLIED", idempotencyKey: "status-race" }),
    ]);
    expect(statuses.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const assessment = await createAssessment(owner, app.id, {
      type: "OA",
      idempotencyKey: "assessment-race",
    });
    if (!assessment) throw new Error("assessment missing");
    await Promise.all([
      updateAssessment(owner, app.id, String(assessment.id), {
        status: "COMPLETED",
        completedAt: "2027-02-01T12:00:00.000Z",
      }),
      updateAssessment(owner, app.id, String(assessment.id), {
        status: "COMPLETED",
        completedAt: "2027-02-01T12:00:00.000Z",
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='APPLICATION_SUBMITTED') submitted,
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='OA_COMPLETED') completed,
        (select status::text from public.application_assessments where id=${String(assessment.id)}::uuid) assessment_status`;
      expect(Number(counts?.submitted)).toBe(1);
      expect(Number(counts?.completed)).toBe(1);
      expect(counts?.assessment_status).toBe("COMPLETED");
    } finally {
      await sql.end();
    }
  });

  it("deduplicates concurrent interview scheduling and rescheduling", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-interview-race'`;
    await cleanup.end();
    const app = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-interview-race",
      applicationUrlUsed: "https://apply.example/interview-race",
    });
    const scheduled = await Promise.allSettled([
      createInterview(owner, app.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-03-01T12:00:00.000Z",
        endsAt: "2027-03-01T13:00:00.000Z",
        timezone: "UTC",
      }),
      createInterview(owner, app.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-03-01T12:00:00.000Z",
        endsAt: "2027-03-01T13:00:00.000Z",
        timezone: "UTC",
      }),
    ]);
    expect(scheduled.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const interview = (
      scheduled.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
      }>
    ).value;
    await Promise.all([
      updateInterview(owner, app.id, String(interview.id), {
        startsAt: "2027-03-02T12:00:00.000Z",
      }),
      updateInterview(owner, app.id, String(interview.id), {
        startsAt: "2027-03-02T12:00:00.000Z",
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.application_interviews where application_id=${app.id}::uuid and status <> 'CANCELLED') interviews,
        (select count(*)::int from public.calendar_items where application_id=${app.id}::uuid and application_interview_id=${interview.id}::uuid and deleted_at is null) calendar_items,
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='INTERVIEW_RESCHEDULED') reschedules`;
      expect(Number(counts?.interviews)).toBe(1);
      expect(Number(counts?.calendar_items)).toBe(1);
      expect(Number(counts?.reschedules)).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
