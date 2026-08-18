import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getDatabase,
  getRecruiter,
  listCompanyCampusEvents,
  listCompanyRecruiters,
  listSchoolCompanies,
} from "./index";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const companyId = "e1000000-0000-0000-0000-000000000001";
const schoolId = "e2000000-0000-0000-0000-000000000001";
const observationId = "e3000000-0000-0000-0000-000000000001";

async function reset() {
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`delete from public.recruiter_profiles where company_id = ${companyId}::uuid`;
    await sql`delete from public.campus_recruiting_events where company_id = ${companyId}::uuid`;
    await sql`
      delete from public.unresolved_recruiter_observations where company_id = ${companyId}::uuid
    `;
    await sql`delete from public.companies where id = ${companyId}::uuid`;
    await sql`delete from public.schools where id = ${schoolId}::uuid`;
  } finally {
    await sql.end();
  }
}

integration("PostgreSQL recruiter/campus API projection", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    await reset();
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`
        insert into public.companies (id, canonical_name, slug, website, careers_url)
        values (
          ${companyId}::uuid, 'M4 Contract Company', 'm4-contract-company',
          'https://company.example', 'https://company.example/careers'
        )
      `;
      await sql`
        insert into public.schools (
          id, canonical_name, slug, website, domains, aliases, city, state_region, country
        ) values (
          ${schoolId}::uuid, 'Contract State University', 'm4-contract-school',
          'https://contract-state.example', '{contract-state.example}', '{"CSU"}',
          'Test City', 'Test State', 'US'
        )
      `;
      await sql`
        insert into public.school_aliases (school_id, alias, normalized_alias)
        values (${schoolId}::uuid, 'CSU', 'csu')
      `;
      await sql`
        insert into public.sources (
          id, company_id, source_type, provider, external_key, name, base_url, reliability
        ) values (
          'e4000000-0000-0000-0000-000000000001', ${companyId}::uuid,
          'UNIVERSITY', 'm4_contract', 'm4-contract-source', 'UT Austin careers',
          'https://careerengagement.utexas.edu', 0.9
        )
      `;
      await sql`
        insert into public.public_web_candidates (
          id, company_id, source_id, source_provider, original_url, canonical_url,
          fetch_status, content_hash, relevance_status
        ) values (
          'e5000000-0000-0000-0000-000000000001', ${companyId}::uuid,
          'e4000000-0000-0000-0000-000000000001', 'm4_contract',
          'https://careerengagement.utexas.edu/events/company-expo',
          'https://careerengagement.utexas.edu/events/company-expo', 'FETCHED',
          ${"a".repeat(64)}, 'RELEVANT'
        )
      `;
      await sql`
        insert into public.public_web_documents (
          id, candidate_id, content_hash, fetched_at, final_url, http_status,
          content_type, title, extracted_text
        ) values (
          'e6000000-0000-0000-0000-000000000001',
          'e5000000-0000-0000-0000-000000000001', ${"a".repeat(64)}, now(),
          'https://careerengagement.utexas.edu/events/company-expo', 200, 'text/html',
          'M4 Contract Company at Engineering Expo',
          'Jane Smith, University Recruiter at M4 Contract Company, will join CSU '
            || 'for the Engineering Expo for software engineering students.'
        )
      `;
      await sql`
        insert into public.public_recruiting_observations (
          id, company_id, source_id, candidate_id, document_id, school_id,
          observation_type, title, summary, evidence_text, source_url,
          source_classification, reliability_level, date_start, date_precision,
          date_certainty, discovered_at, last_verified_at, confidence, content_hash,
          metadata, fingerprint
        ) values (
          ${observationId}::uuid, ${companyId}::uuid,
          'e4000000-0000-0000-0000-000000000001',
          'e5000000-0000-0000-0000-000000000001',
          'e6000000-0000-0000-0000-000000000001', ${schoolId}::uuid, 'CAREER_FAIR',
          'M4 Contract Company at Engineering Expo',
          'Jane Smith is the university recruiter contact.',
          'Jane Smith, University Recruiter at M4 Contract Company, will join CSU '
            || 'for the Engineering Expo for software engineering students.',
          'https://careerengagement.utexas.edu/events/company-expo', 'UNIVERSITY', 'HIGH',
          '2026-09-15', 'EXACT', 'CONFIRMED', now(), now(), 0.9, ${"a".repeat(64)},
          '{"integration_test":true}', ${"b".repeat(64)}
        )
      `;
    } finally {
      await sql.end();
    }
    await execFileAsync(
      resolve(import.meta.dirname, "../../../.venv/bin/python"),
      [
        "-m",
        "recruitintel_collectors.cli",
        "recruiter-campus-process",
        "--observation-id",
        observationId,
      ],
      {
        cwd: resolve(import.meta.dirname, "../../.."),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
  }, 20_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await getDatabase().end();
    await reset();
  });

  it("queries the extracted graph through the typed API projection", async () => {
    const recruiters = await listCompanyRecruiters(companyId);
    expect(recruiters.total).toBe(1);
    const recruiter = recruiters.items[0];
    expect(recruiter?.name).toBe("Jane Smith");
    expect(recruiter?.schoolFocus[0]?.school.canonicalName).toBe("Contract State University");
    expect(recruiter?.roleFocus[0]?.roleFamily).toBe("SOFTWARE_ENGINEERING");
    const detail = await getRecruiter(recruiter?.id ?? "");
    expect(detail?.evidence[0]?.recruitingObservationId).toBe(observationId);
    expect(detail?.evidence[0]?.source.name).toBe("UT Austin careers");

    const events = await listCompanyCampusEvents(companyId);
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.eventType).toBe("CAREER_FAIR");
    const companies = await listSchoolCompanies(schoolId);
    expect(companies.items[0]).toMatchObject({
      recruiterCount: 1,
      campusEventCount: 1,
    });
  });
});
