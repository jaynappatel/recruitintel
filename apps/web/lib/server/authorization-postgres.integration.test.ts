import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getDatabase } from "@recruitintel/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userOneId = "fc000000-0000-4000-8000-000000000001";
const userTwoId = "fc000000-0000-4000-8000-000000000002";
const companyId = "fc100000-0000-4000-8000-000000000001";
const planTwoId = "fc200000-0000-4000-8000-000000000002";

integration("authenticated route ownership", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = "authorization-test-secret-with-more-than-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("delete from public.users where id = any($1::uuid[])", [
      [userOneId, userTwoId],
    ]);
    await pool.query("delete from public.companies where id = $1", [companyId]);
    await pool.query(
      `insert into public.users (id, name, email, email_verified, status, is_admin)
       values ($1, 'User One', 'user-one@example.com', true, 'ACTIVE', true),
              ($2, 'User Two', 'user-two@example.com', true, 'ACTIVE', false)`,
      [userOneId, userTwoId],
    );
    await pool.query(
      `insert into public.companies (id, canonical_name, slug, website, careers_url)
       values ($1, 'Authorization Company', 'authorization-company',
               'https://authorization.example', 'https://authorization.example/careers')`,
      [companyId],
    );
    await pool.query(
      `insert into public.application_plans (
         id, user_id, company_id, title, target_date, timezone, plan_fingerprint
       ) values ($1, $2, $3, 'Private plan', '2026-09-01', 'America/Chicago', $4)`,
      [planTwoId, userTwoId, companyId, "d".repeat(64)],
    );
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await pool.query("delete from public.users where id = any($1::uuid[])", [
      [userOneId, userTwoId],
    ]);
    await pool.query("delete from public.companies where id = $1", [companyId]);
    await pool.end();
    await getDatabase().end();
  });

  it("returns 401 without a session and 404 across owners, even for an admin", async () => {
    const { auth } = await import("./auth");
    const sessionSpy = vi.spyOn(auth.api, "getSession");
    sessionSpy.mockResolvedValueOnce(null);
    const planRoute = await import("../../app/api/application-plans/[id]/route");
    const unauthenticated = await planRoute.GET(
      new Request(`http://localhost:3000/api/application-plans/${planTwoId}`),
      { params: Promise.resolve({ id: planTwoId }) },
    );
    expect(unauthenticated.status).toBe(401);

    sessionSpy.mockResolvedValueOnce({
      session: {} as never,
      user: {
        id: userOneId,
        email: "user-one@example.com",
        emailVerified: true,
        name: "User One",
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const crossOwner = await planRoute.GET(
      new Request(`http://localhost:3000/api/application-plans/${planTwoId}`),
      { params: Promise.resolve({ id: planTwoId }) },
    );
    expect(crossOwner.status).toBe(404);
    sessionSpy.mockRestore();
  });

  it("rejects a cross-origin cookie-authenticated mutation", async () => {
    const { auth } = await import("./auth");
    const sessionSpy = vi.spyOn(auth.api, "getSession");
    const calendarRoute = await import("../../app/api/calendar/route");
    const response = await calendarRoute.POST(
      new Request("http://localhost:3000/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(403);
    expect(sessionSpy).not.toHaveBeenCalled();
    sessionSpy.mockRestore();
  });

  it("ignores a browser-supplied userId and binds writes to the authenticated user", async () => {
    const { auth } = await import("./auth");
    const sessionSpy = vi.spyOn(auth.api, "getSession").mockResolvedValue({
      session: {} as never,
      user: {
        id: userOneId,
        email: "user-one@example.com",
        emailVerified: true,
        name: "User One",
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const calendarRoute = await import("../../app/api/calendar/route");
    const response = await calendarRoute.POST(
      new Request("http://localhost:3000/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          userId: userTwoId,
          type: "CUSTOM",
          title: "Authenticated owner contract",
          startsAt: "2026-09-01T14:00:00.000Z",
          allDay: false,
          timezone: "America/Chicago",
          status: "TODO",
          syncEnabled: false,
          metadata: {},
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    const result = await pool.query("select user_id from public.calendar_items where id = $1", [
      body.data.id,
    ]);
    expect(result.rows[0]?.user_id).toBe(userOneId);
    sessionSpy.mockRestore();
  });

  it("enforces owner isolation across M10 application routes", async () => {
    const { auth } = await import("./auth");
    const { createApplication, createAssessment, createInterview } =
      await import("@recruitintel/db");
    const opportunityResult = await pool.query(
      "select id from public.job_opportunities where status = 'ACTIVE' order by id limit 1",
    );
    const opportunityId = String(opportunityResult.rows[0].id);
    const app = await createApplication(userOneId, {
      opportunityId,
      cycleKey: "http-idor-m10",
      applicationUrlUsed: "https://apply.example/http-idor",
    });
    const assessment = await createAssessment(userOneId, app.id, {
      type: "OA",
      idempotencyKey: "http-idor-oa",
    });
    if (!assessment) throw new Error("assessment missing");
    const interview = await createInterview(userOneId, app.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-07-01T12:00:00.000Z",
      endsAt: "2027-07-01T13:00:00.000Z",
      timezone: "UTC",
    });
    const user = (id: string) => ({
      session: {} as never,
      user: {
        id,
        email: `${id}@example.test`,
        emailVerified: true,
        name: id,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    let currentUser: string | null = userOneId;
    const sessionSpy = vi
      .spyOn(auth.api, "getSession")
      .mockImplementation(async () => (currentUser ? user(currentUser) : null));
    const appRoute = await import("../../app/api/applications/[id]/route");
    const listRoute = await import("../../app/api/applications/route");
    const statusRoute = await import("../../app/api/applications/[id]/status/route");
    const timelineRoute = await import("../../app/api/applications/[id]/timeline/route");
    const assessmentRoute = await import("../../app/api/applications/[id]/assessments/route");
    const assessmentPatchRoute =
      await import("../../app/api/applications/[id]/assessments/[assessmentId]/route");
    const interviewRoute = await import("../../app/api/applications/[id]/interviews/route");
    const interviewPatchRoute =
      await import("../../app/api/applications/[id]/interviews/[interviewId]/route");
    const archiveRoute = await import("../../app/api/applications/[id]/archive/route");
    const context = { params: Promise.resolve({ id: app.id }) };
    expect(
      (await listRoute.GET(new Request("http://localhost:3000/api/applications"))).status,
    ).toBe(200);
    expect(
      (await appRoute.GET(new Request(`http://localhost:3000/api/applications/${app.id}`), context))
        .status,
    ).toBe(200);
    expect((await timelineRoute.GET(new Request("http://localhost:3000"), context)).status).toBe(
      200,
    );
    currentUser = userTwoId;
    expect(
      (await listRoute.GET(new Request("http://localhost:3000/api/applications"))).status,
    ).toBe(200);
    expect((await appRoute.GET(new Request("http://localhost:3000"), context)).status).toBe(404);
    expect((await timelineRoute.GET(new Request("http://localhost:3000"), context)).status).toBe(
      404,
    );
    const jsonRequest = (body: unknown) =>
      new Request("http://localhost:3000", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      });
    expect(
      (
        await statusRoute.POST(
          jsonRequest({ status: "APPLIED", idempotencyKey: "idor-status" }),
          context,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await assessmentRoute.POST(
          jsonRequest({ type: "OA", idempotencyKey: "idor-child" }),
          context,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await assessmentPatchRoute.PATCH(jsonRequest({ status: "COMPLETED" }), {
          params: Promise.resolve({ id: app.id, assessmentId: String(assessment.id) }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await interviewRoute.POST(
          jsonRequest({
            interviewType: "TECHNICAL",
            startsAt: "2027-08-01T12:00:00.000Z",
            timezone: "UTC",
          }),
          context,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await interviewPatchRoute.PATCH(jsonRequest({ status: "COMPLETED" }), {
          params: Promise.resolve({ id: app.id, interviewId: String(interview.id) }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await archiveRoute.POST(
          new Request("http://localhost:3000", {
            method: "POST",
            headers: { origin: "http://localhost:3000" },
          }),
          context,
        )
      ).status,
    ).toBe(404);
    currentUser = null;
    expect((await appRoute.GET(new Request("http://localhost:3000"), context)).status).toBe(401);
    sessionSpy.mockRestore();
  });
});
