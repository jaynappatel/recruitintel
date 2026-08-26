import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@recruitintel/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userA = "cc000000-0000-4000-8000-000000000001";
const userB = "cc000000-0000-4000-8000-000000000002";

integration("built production M10 HTTP runtime", () => {
  let pool: Pool;
  let server: ChildProcess;
  let baseUrl: string;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = "built-http-test-secret-with-more-than-32-characters";
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:3210";
    // The separately spawned `next start` process runs in production mode.  Set
    // the same mode before constructing BetterAuth here so its secure cookie
    // name/configuration exactly matches the built server.
    Object.assign(process.env, { NODE_ENV: "production" });
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query("delete from public.users where id = any($1::uuid[])", [[userA, userB]]);
    await pool.query(
      `insert into public.users (id,name,email,email_verified,status) values
       ($1,'Built HTTP A','built-http-a@example.test',true,'ACTIVE'),
       ($2,'Built HTTP B','built-http-b@example.test',true,'ACTIVE')`,
      [userA, userB],
    );
    const { auth } = await import("./auth");
    const context = await auth.$context;
    const sessionA = await context.internalAdapter.createSession(userA);
    const sessionB = await context.internalAdapter.createSession(userB);
    const sign = (token: string) =>
      `${context.authCookies.sessionToken.name}=${token}.${createHmac("sha256", context.secret).update(token).digest("base64")}`;
    cookieA = sign(sessionA.token);
    cookieB = sign(sessionB.token);
    server = spawn("pnpm", ["start", "-p", "3210"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: "built-http-test-secret-with-more-than-32-characters",
        BETTER_AUTH_URL: "http://127.0.0.1:3210",
        NODE_ENV: "production",
        ZERO_COST_MODE: "true",
      },
      stdio: "ignore",
    });
    baseUrl = "http://127.0.0.1:3210";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/applications`, {
          headers: { cookie: cookieA },
        });
        if (response.status < 500) return;
      } catch {
        // Server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Built server did not become ready");
  }, 20_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await pool?.query("delete from public.users where id = any($1::uuid[])", [[userA, userB]]);
    await pool?.end();
    await getDatabase().end();
  });

  it("runs authenticated owner-safe application lifecycle over next start", async () => {
    const opportunity = await pool.query(
      "select id from public.job_opportunities where status='ACTIVE' order by id limit 1",
    );
    const opportunityId = String(opportunity.rows[0].id);
    const request = (path: string, init: RequestInit = {}, cookie = cookieA) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
    const create = await request("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunityId,
        cycleKey: "built-http-m10",
        applicationUrlUsed: "https://apply.example/built-http",
      }),
    });
    expect(create.status).toBe(201);
    const application = (await create.json()).data as { id: string };
    expect((await request(`/api/applications/${application.id}`)).status).toBe(200);
    expect((await request(`/api/applications/${application.id}`, {}, cookieB)).status).toBe(404);
    const status = await request(`/api/applications/${application.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPLIED", idempotencyKey: "built-http-submit" }),
    });
    expect(status.status).toBe(200);
    expect((await request(`/api/applications/${application.id}/timeline`)).status).toBe(200);
    const child = await request(`/api/applications/${application.id}/assessments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "OA", idempotencyKey: "built-http-oa" }),
    });
    expect(child.status).toBe(201);
    const assessment = (await child.json()).data as { id: string };
    expect(
      (
        await request(`/api/applications/${application.id}/assessments/${assessment.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/assessments/${assessment.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED" }),
          },
          cookieB,
        )
      ).status,
    ).toBe(404);
    const interviewResponse = await request(`/api/applications/${application.id}/interviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interviewType: "TECHNICAL",
        startsAt: "2027-10-01T12:00:00.000Z",
        timezone: "UTC",
      }),
    });
    expect(interviewResponse.status).toBe(201);
    const interview = (await interviewResponse.json()).data as { id: string };
    expect(
      (
        await request(`/api/applications/${application.id}/interviews/${interview.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/interviews/${interview.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED" }),
          },
          cookieB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/applications/${application.id}/archive`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/api/applications/${application.id}`, {}, cookieB)).status).toBe(404);
  });
});
