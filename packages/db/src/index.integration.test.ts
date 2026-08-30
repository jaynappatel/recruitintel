import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase, listJobs } from "./index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

// Distinct namespace so this file's fixtures never collide with other integration
// test files' data when the full PostgreSQL suite runs against the shared test database.
const companyAId = "e1000000-0000-0000-0000-000000000001";
const companyBId = "e1000000-0000-0000-0000-000000000002";
const sourceAId = "e2000000-0000-0000-0000-000000000001";
const sourceBId = "e2000000-0000-0000-0000-000000000002";
const jobIds = {
  matchTitle: "e3000000-0000-0000-0000-000000000001",
  matchCompanyName: "e3000000-0000-0000-0000-000000000002",
  noMatch: "e3000000-0000-0000-0000-000000000003",
};

async function reset() {
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    // Inserting a job auto-materializes a canonical job_opportunities row plus a
    // job_opportunity_postings/job_resolution_decisions trail. Those tables reject
    // direct deletes (append-only invariants) but cascade cleanly from the company,
    // so deleting the company is the only supported way to tear this fixture down.
    await sql`delete from public.companies where id in (${companyAId}::uuid, ${companyBId}::uuid)`;
  } finally {
    await sql.end();
  }
}

integration("PostgreSQL listJobs", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    await reset();
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`
        insert into public.companies (id, canonical_name, slug)
        values
          (${companyAId}::uuid, 'Regression Search Widgets', 'regression-search-widgets'),
          (${companyBId}::uuid, 'Unrelated Corp', 'unrelated-corp-list-jobs')
      `;
      await sql`
        insert into public.sources (
          id, company_id, source_type, provider, external_key, name, base_url, reliability
        ) values
          (
            ${sourceAId}::uuid, ${companyAId}::uuid, 'ATS', 'greenhouse',
            'regression-search-widgets-gh', 'Regression Search Widgets Greenhouse',
            'https://boards.greenhouse.io/regression', 0.9
          ),
          (
            ${sourceBId}::uuid, ${companyBId}::uuid, 'ATS', 'greenhouse',
            'unrelated-corp-gh', 'Unrelated Corp Greenhouse',
            'https://boards.greenhouse.io/unrelated', 0.9
          )
      `;
      await sql`
        insert into public.jobs (
          id, company_id, source_id, external_id, title, location,
          application_url, source_url, content_hash
        ) values
          (
            ${jobIds.matchTitle}::uuid, ${companyAId}::uuid, ${sourceAId}::uuid,
            'listjobs-regression-1', 'Distributed Systems Engineer', 'Remote',
            'https://boards.greenhouse.io/regression/1', 'https://boards.greenhouse.io/regression/1',
            ${"1".repeat(64)}
          ),
          (
            ${jobIds.matchCompanyName}::uuid, ${companyAId}::uuid, ${sourceAId}::uuid,
            'listjobs-regression-2', 'Product Designer', 'New York, NY',
            'https://boards.greenhouse.io/regression/2', 'https://boards.greenhouse.io/regression/2',
            ${"2".repeat(64)}
          ),
          (
            ${jobIds.noMatch}::uuid, ${companyBId}::uuid, ${sourceBId}::uuid,
            'listjobs-regression-3', 'Warehouse Associate', 'Columbus, OH',
            'https://boards.greenhouse.io/unrelated/3', 'https://boards.greenhouse.io/unrelated/3',
            ${"3".repeat(64)}
          )
      `;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await reset();
    await getDatabase().end();
  });

  it("succeeds and returns a consistent count when filtering by a free-text query", async () => {
    // Regression test for commit d3e0099: listJobs's count query selected from
    // public.jobs alone while its shared `filters` fragment referenced
    // c.canonical_name (via the query search branch) without joining
    // public.companies. PostgreSQL rejects that at parse time regardless of the
    // search term's runtime value, so this call raised "missing FROM-clause
    // entry for table \"c\"" for every search before the fix.
    const bySearchTerm = await listJobs({ query: "Distributed Systems", limit: 10 });
    expect(bySearchTerm.total).toBe(1);
    expect(bySearchTerm.items).toHaveLength(1);
    expect(bySearchTerm.items[0]?.id).toBe(jobIds.matchTitle);

    // The search term also matches via the company-name branch of the filter,
    // which is the exact branch that referenced the unjoined alias.
    const byCompanyName = await listJobs({ query: "Regression Search Widgets", limit: 10 });
    expect(byCompanyName.total).toBe(2);
    expect(byCompanyName.items.map((item) => item.id).sort()).toEqual(
      [jobIds.matchTitle, jobIds.matchCompanyName].sort(),
    );

    // A query that matches nothing must return a real zero, not throw.
    const noMatches = await listJobs({ query: "Nonexistent Role Title Xyz", limit: 10 });
    expect(noMatches.total).toBe(0);
    expect(noMatches.items).toHaveLength(0);

    // Pagination consistency: total must reflect the full match count even when
    // limit truncates items, proving items.length and total come from the same
    // filter rather than one silently omitting the join.
    const paginated = await listJobs({ query: "Regression Search Widgets", limit: 1, offset: 0 });
    expect(paginated.total).toBe(2);
    expect(paginated.items).toHaveLength(1);
  });

  it("succeeds with no query filter at all", async () => {
    // Even with query left undefined, the shared `filters` SQL fragment is still
    // parsed and must be valid regardless of which branch is live at runtime.
    const all = await listJobs({ companyId: companyAId, limit: 10 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);
  });
});
