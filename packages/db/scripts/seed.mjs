import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const seed = await readFile(resolve(packageRoot, "seeds/001_development.sql"), "utf8");
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  await sql.begin((transaction) => transaction.unsafe(seed));
  console.log("development seed applied");
} finally {
  await sql.end();
}
