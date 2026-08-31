import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantBetaAccess, hasActiveBetaAccess, revokeBetaAccess } from "./beta-access";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const admin = "20000000-0000-4000-8000-000000000001";

integration("M20 private-beta allowlist", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`insert into public.users (id,name,email,email_verified,status,is_admin) values (${admin}::uuid,'M20 Admin','m20-admin@example.test',true,'ACTIVE',true) on conflict (id) do nothing`;
    await sql.end();
  });
  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.users where id=${admin}::uuid`;
    await sql.end();
  });
  it("normalizes grants, restores revoked access, and rejects revoked users server-side", async () => {
    const granted = await grantBetaAccess(admin, " Beta.User@Example.Test ");
    expect(granted.email).toBe("beta.user@example.test");
    expect(await hasActiveBetaAccess(granted.email)).toBe(true);
    const revoked = await revokeBetaAccess(admin, granted.id);
    expect(revoked.status).toBe("REVOKED");
    expect(await hasActiveBetaAccess(granted.email)).toBe(false);
    const restored = await grantBetaAccess(admin, granted.email);
    expect(restored.id).toBe(granted.id);
    expect(restored.status).toBe("ACTIVE");
  });
});
