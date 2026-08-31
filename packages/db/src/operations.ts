import { getDatabase } from "./index";

export type OperationalDiagnostics = {
  database: "READY";
  migrationCount: number;
  latestMigration: string | null;
  work: Record<string, number>;
  deadLetters: number;
};

/**
 * Deliberately aggregate-only operational status. It must never become a
 * second event warehouse or disclose private work payloads.
 */
export async function getOperationalDiagnostics(): Promise<OperationalDiagnostics> {
  const sql = getDatabase();
  const [migration] = await sql<
    {
      migration_count: number | string;
      latest_migration: string | null;
    }[]
  >`select count(*)::int as migration_count, max(version) as latest_migration from public.schema_migrations`;
  const statuses = await sql<{ status: string; count: number | string }[]>`
    select status::text, count(*)::int as count
    from public.work_items
    group by status
  `;
  const [deadLetter] = await sql<{ count: number | string }[]>`
    select count(*)::int as count from public.dead_letters
  `;
  return {
    database: "READY",
    migrationCount: Number(migration?.migration_count ?? 0),
    latestMigration: migration?.latest_migration ?? null,
    work: Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)])),
    deadLetters: Number(deadLetter?.count ?? 0),
  };
}
