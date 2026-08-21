import { Pool } from "pg";

const globalAuthDatabase = globalThis as typeof globalThis & {
  recruitIntelAuthPool?: Pool;
};

export function getAuthDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!globalAuthDatabase.recruitIntelAuthPool) {
    globalAuthDatabase.recruitIntelAuthPool = new Pool({
      connectionString,
      max: process.env.NODE_ENV === "production" ? 10 : 3,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalAuthDatabase.recruitIntelAuthPool;
}
