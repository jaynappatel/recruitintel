import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { getDatabase } from "@recruitintel/db";

import { getAuthDatabasePool } from "./auth-database";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("Better Auth PostgreSQL persistence", () => {
  const userId = "fb000000-0000-4000-8000-000000000001";
  let pool: Pool | undefined;

  afterAll(async () => {
    if (pool) {
      await pool.query("delete from public.users where id = $1", [userId]);
      await pool.end();
    }
    if (databaseUrl) await getDatabase().end();
    if (databaseUrl) await getAuthDatabasePool().end();
  });

  it("persists sessions and accounts without plaintext provider credentials", async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = "integration-test-auth-secret-with-more-than-32-characters";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    await pool.query("delete from public.users where id = $1", [userId]);
    await pool.query(
      `insert into public.users (id, name, email, email_verified, status)
       values ($1, 'Auth Contract User', 'auth-contract@example.com', true, 'ACTIVE')`,
      [userId],
    );

    const { auth } = await import("./auth");
    const context = await auth.$context;
    const account = await context.internalAdapter.createAccount({
      issuer: "https://accounts.google.com",
      accountId: "auth-contract-google-sub",
      providerId: "google",
      userId,
      accessToken: "plaintext-access",
      refreshToken: "plaintext-refresh",
      idToken: "plaintext-id",
      scope: "openid email profile",
    });
    const session = await context.internalAdapter.createSession(userId);
    const persisted = await context.internalAdapter.findSession(session.token);

    expect(persisted?.user.id).toBe(userId);
    expect(persisted?.session.token).toBe(session.token);
    expect(account).toMatchObject({
      issuer: "https://accounts.google.com",
      accountId: "auth-contract-google-sub",
      providerId: "google",
      userId,
    });
    const rows = await pool.query(
      `select access_token, refresh_token, id_token, password
       from public.user_identities where user_id = $1`,
      [userId],
    );
    expect(rows.rows[0]).toEqual({
      access_token: null,
      refresh_token: null,
      id_token: null,
      password: null,
    });
    expect(JSON.stringify(rows.rows[0])).not.toContain("plaintext");
    await expect(
      pool.query(
        "update public.user_identities set access_token = 'plaintext-forbidden' where user_id = $1",
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const createdAudit = await pool.query(
      `select count(*)::int as count from public.audit_events
       where action = 'AUTH_SESSION_CREATED' and resource_id = $1`,
      [session.id],
    );
    expect(createdAudit.rows[0]?.count).toBe(1);

    await context.internalAdapter.deleteSession(session.token);
    expect(await context.internalAdapter.findSession(session.token)).toBeNull();
    const revokedAudit = await pool.query(
      `select count(*)::int as count from public.audit_events
       where action = 'AUTH_SESSION_REVOKED' and resource_id = $1`,
      [session.id],
    );
    expect(revokedAudit.rows[0]?.count).toBe(1);
  });
});
