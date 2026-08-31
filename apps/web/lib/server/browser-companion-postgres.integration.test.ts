import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionGrant, getDatabase, revokeExtensionGrant } from "@recruitintel/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userA = randomUUID();
const userB = randomUUID();
const origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

integration("M12 extension HTTP authorization", () => {
  let pool: Pool;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query(
      `insert into public.users (id,name,email,email_verified,status) values
       ($1,'M12 HTTP A',$2,true,'ACTIVE'),($3,'M12 HTTP B',$4,true,'ACTIVE')`,
      [userA, `m12-http-a-${userA}@example.test`, userB, `m12-http-b-${userB}@example.test`],
    );
    tokenA = (
      await createExtensionGrant(userA, {
        name: "A",
        scopes: ["PAGE_SCAN", "JOB_IMPORT"],
        expiresInSeconds: 3600,
      })
    ).token;
    tokenB = (
      await createExtensionGrant(userB, {
        name: "B",
        scopes: ["PAGE_SCAN", "JOB_IMPORT"],
        expiresInSeconds: 3600,
      })
    ).token;
  });

  afterAll(async () => {
    await pool.query("delete from public.users where id=any($1::uuid[])", [[userA, userB]]);
    await pool.end();
    await getDatabase().end();
  });

  const extensionRequest = (token: string, body?: unknown) =>
    new Request("http://localhost:3000/api/extension/scans", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("enforces USER_A/USER_B ownership and rejected calls do not mutate", async () => {
    const scansRoute = await import("../../app/api/extension/scans/route");
    const scanRoute = await import("../../app/api/extension/scans/[id]/route");
    const selectRoute = await import("../../app/api/extension/candidates/[id]/select/route");
    const payload = {
      protocolVersion: 1,
      pageUrl: "https://m12-http.example.test/careers?secret=1",
      pageTitle: "Jobs",
      jsonLdCount: 0,
      linkCount: 1,
      candidates: [
        { kind: "GRID", url: "https://m12-http.example.test/careers/job#apply", title: "Engineer" },
      ],
    };
    const created = await scansRoute.POST(extensionRequest(tokenA, payload));
    expect(created.status).toBe(201);
    const scan = (await created.json()).data as {
      id: string;
      candidates: Array<{ id: string; revision: number }>;
    };
    const candidate = scan.candidates[0]!;
    const before = await pool.query(
      "select count(*)::int as count from public.browser_ingest_decisions where user_id=$1",
      [userA],
    );
    expect(
      (
        await scanRoute.GET(
          new Request(`http://localhost:3000/api/extension/scans/${scan.id}`, {
            headers: { authorization: `Bearer ${tokenB}`, origin },
          }),
          { params: Promise.resolve({ id: scan.id }) },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await selectRoute.POST(
          new Request(`http://localhost:3000/api/extension/candidates/${candidate.id}/select`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${tokenB}`,
              origin,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              candidateRevision: candidate.revision,
              idempotencyKey: "cross-owner",
            }),
          }),
          { params: Promise.resolve({ id: candidate.id }) },
        )
      ).status,
    ).toBe(404);
    const after = await pool.query(
      "select count(*)::int as count from public.browser_ingest_decisions where user_id=$1",
      [userA],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    expect(
      (
        await scansRoute.POST(
          extensionRequest(tokenA, { ...payload, pageUrl: "https://linkedin.com/jobs" }),
        )
      ).status,
    ).toBe(409);
  });

  it("rejects revoked grants before scan mutation", async () => {
    const scansRoute = await import("../../app/api/extension/scans/route");
    const grant = await createExtensionGrant(userA, {
      name: "revoked",
      scopes: ["PAGE_SCAN"],
      expiresInSeconds: 3600,
    });
    await revokeExtensionGrant(userA, grant.id);
    const response = await scansRoute.POST(
      extensionRequest(grant.token, {
        protocolVersion: 1,
        pageUrl: "https://m12-http.example.test/revoked",
        pageTitle: "Jobs",
        jsonLdCount: 0,
        linkCount: 0,
        candidates: [
          { kind: "GRID", url: "https://m12-http.example.test/revoked/1", title: "Engineer" },
        ],
      }),
    );
    expect(response.status).toBe(401);
  });
});
