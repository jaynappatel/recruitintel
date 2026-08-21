import { createHash, randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const kind = process.argv.includes("--worker") ? "WORKER" : "ADMIN_API";
const scope = kind === "WORKER" ? "WORKER_INGEST" : "ADMIN_MUTATE";
const label = kind === "WORKER" ? "worker" : "admin";
const publicPart = randomBytes(9).toString("base64url");
const token = `ri_${label}_${publicPart}.${randomBytes(32).toString("base64url")}`;
const tokenPrefix = token.split(".")[0];
const tokenHash = createHash("sha256").update(token).digest("hex");
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [row] = await sql`
    insert into public.service_principals (
      id, name, kind, token_prefix, token_hash, scopes
    ) values (
      ${randomUUID()}::uuid, ${`RecruitIntel ${label}`}, ${kind}, ${tokenPrefix},
      ${tokenHash}, array[${scope}]::public.service_scope[]
    ) returning id
  `;
  console.log(JSON.stringify({ id: row.id, kind, scopes: [scope], token }));
  console.error(
    "Store the token now; RecruitIntel stores only its SHA-256 hash and cannot recover it.",
  );
} finally {
  await sql.end();
}
