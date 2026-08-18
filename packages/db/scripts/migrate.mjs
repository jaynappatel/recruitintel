import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = resolve(packageRoot, "migrations");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  await sql`
    create table if not exists public.schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const body = await readFile(resolve(migrationsDirectory, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const [existing] = await sql`
      select checksum from public.schema_migrations where version = ${file}
    `;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Applied migration ${file} has been modified`);
      }
      console.log(`skip ${file}`);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(body);
      await transaction`
        insert into public.schema_migrations (version, checksum)
        values (${file}, ${checksum})
      `;
    });
    console.log(`apply ${file}`);
  }
} finally {
  await sql.end();
}
