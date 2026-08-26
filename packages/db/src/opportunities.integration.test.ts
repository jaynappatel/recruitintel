import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createApplicationPlan,
  dismissOpportunityReview,
  getApplicationPlan,
  getDatabase,
  mergeOpportunities,
  splitOpportunity,
  updateApplicationPlan,
} from "./index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userId = randomUUID();
const companyId = randomUUID();
const sourceId = randomUUID();
const firstJobId = randomUUID();
const secondJobId = randomUUID();
const suffix = companyId.replaceAll("-", "").slice(0, 12);

async function activeOpportunity(sql: ReturnType<typeof postgres>, jobId: string) {
  const [row] = await sql`
    select opportunity_id from public.job_opportunity_postings
    where job_id = ${jobId}::uuid and valid_to is null
  `;
  if (!row) throw new Error("Expected active singleton opportunity");
  return String(row.opportunity_id);
}

integration("canonical opportunity manual corrections and M5 compatibility", () => {
  let firstOpportunityId: string;
  let secondOpportunityId: string;

  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`
        insert into public.users (id, name, email, email_verified, is_admin, status)
        values (
          ${userId}::uuid, 'M8 Correction Admin', ${`m8-${suffix}@example.test`},
          true, true, 'ACTIVE'
        )
      `;
      await sql`
        insert into public.companies (id, canonical_name, slug, website, careers_url)
        values (
          ${companyId}::uuid, ${`M8 Corrections ${suffix}`}, ${`m8-corrections-${suffix}`},
          ${`https://${suffix}.example.test`}, ${`https://${suffix}.example.test/careers`}
        )
      `;
      await sql`
        insert into public.sources (
          id, company_id, source_type, provider, external_key, name, base_url,
          reliability, source_policy_id
        ) values (
          ${sourceId}::uuid, ${companyId}::uuid, 'ATS', 'greenhouse', ${suffix},
          'M8 correction fixture', ${`https://boards.greenhouse.io/${suffix}`}, 0.99,
          (select id from public.source_policies where provider = 'greenhouse')
        )
      `;
      for (const [jobId, externalId] of [
        [firstJobId, "first-requisition"],
        [secondJobId, "second-requisition"],
      ] as const) {
        const hash = externalId === "first-requisition" ? "a".repeat(64) : "b".repeat(64);
        await sql`
          insert into public.jobs (
            id, company_id, source_id, external_id, title, description, location,
            role_family, experience_level, employment_type, is_internship,
            application_url, source_url, content_hash
          ) values (
            ${jobId}::uuid, ${companyId}::uuid, ${sourceId}::uuid, ${externalId},
            'Software Engineer Intern', 'Build reliable systems.', 'Austin, TX',
            'SOFTWARE_ENGINEERING', 'INTERNSHIP', 'INTERNSHIP', true,
            ${`https://boards.greenhouse.io/${suffix}/jobs/${externalId}`},
            ${`https://boards.greenhouse.io/${suffix}/jobs/${externalId}`}, ${hash}
          )
        `;
      }
      firstOpportunityId = await activeOpportunity(sql, firstJobId);
      secondOpportunityId = await activeOpportunity(sql, secondJobId);
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await getDatabase().end();
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`delete from public.applications where user_id = ${userId}::uuid`;
      await sql`delete from public.companies where id = ${companyId}::uuid`;
      await sql`delete from public.users where id = ${userId}::uuid`;
    } finally {
      await sql.end();
    }
  });

  it("keeps private targets historical through split and remerge", async () => {
    const plan = await createApplicationPlan(userId, {
      companyId,
      jobId: secondJobId,
      opportunityId: secondOpportunityId,
      title: "Apply to M8 correction fixture",
      targetDate: "2027-08-20",
      timezone: "America/Chicago",
    });

    const firstMerge = await mergeOpportunities({
      winnerId: firstOpportunityId,
      loserId: secondOpportunityId,
      reason: "Synthetic exact correction for reversible-lineage testing",
      idempotencyKey: `m8-merge-${suffix}`,
      actorUserId: userId,
    });
    expect(firstMerge.id).toBe(firstOpportunityId);
    expect(firstMerge.sourceCount).toBe(2);
    const mergedPlan = await getApplicationPlan(userId, plan.id);
    expect(mergedPlan).toMatchObject({
      jobId: secondJobId,
      opportunityId: secondOpportunityId,
      resolutionMismatch: true,
      resolvedOpportunity: { id: firstOpportunityId },
    });

    const split = await splitOpportunity({
      opportunityId: firstOpportunityId,
      sourcePostingId: secondJobId,
      reason: "Synthetic false-merge correction",
      idempotencyKey: `m8-split-${suffix}`,
      actorUserId: userId,
    });
    expect(split.id).toBe(secondOpportunityId);
    const splitPlan = await getApplicationPlan(userId, plan.id);
    expect(splitPlan).toMatchObject({
      jobId: secondJobId,
      opportunityId: secondOpportunityId,
      resolutionMismatch: false,
      resolvedOpportunity: { id: secondOpportunityId },
    });

    const remerged = await mergeOpportunities({
      winnerId: firstOpportunityId,
      loserId: secondOpportunityId,
      reason: "Synthetic reviewed remerge",
      idempotencyKey: `m8-remerge-${suffix}`,
      actorUserId: userId,
    });
    expect(remerged.sourceCount).toBe(2);
    const retry = await mergeOpportunities({
      winnerId: firstOpportunityId,
      loserId: secondOpportunityId,
      reason: "Synthetic reviewed remerge",
      idempotencyKey: `m8-remerge-${suffix}`,
      actorUserId: userId,
    });
    expect(retry.id).toBe(firstOpportunityId);
    const explicitlyRetargeted = await updateApplicationPlan(userId, plan.id, {
      opportunityId: firstOpportunityId,
    });
    expect(explicitlyRetargeted).toMatchObject({
      jobId: secondJobId,
      opportunityId: firstOpportunityId,
      resolutionMismatch: false,
      resolvedOpportunity: { id: firstOpportunityId },
    });
    expect(
      explicitlyRetargeted.tasks.every(
        (task) => task.calendarItem.opportunityId === firstOpportunityId,
      ),
    ).toBe(true);

    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [lineage] = await sql`
        select count(*)::int as decisions from public.job_resolution_decisions
        where decision_source = 'MANUAL' and company_id = ${companyId}::uuid
      `;
      const [membershipHistory] = await sql`
        select count(*)::int as memberships from public.job_opportunity_postings
        where company_id = ${companyId}::uuid
      `;
      expect(lineage?.decisions).toBe(3);
      expect(Number(membershipHistory?.memberships)).toBeGreaterThanOrEqual(5);
    } finally {
      await sql.end();
    }
  });

  it("records reviewed no-match decisions and pins both memberships", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    let reviewId: string;
    try {
      const orderedJobIds = [firstJobId, secondJobId].sort();
      const leftJobId = orderedJobIds[0]!;
      const rightJobId = orderedJobIds[1]!;
      const [review] = await sql`
        insert into public.job_resolution_reviews (
          company_id, left_job_id, right_job_id, algorithm_version, reason_codes
        ) values (
          ${companyId}::uuid, ${leftJobId}::uuid, ${rightJobId}::uuid, 2,
          array['SAME_COMPANY_TITLE_BLOCK_ONLY']
        ) returning id
      `;
      if (!review) throw new Error("Review insert failed");
      reviewId = String(review.id);
    } finally {
      await sql.end();
    }
    // The prior test ends merged, so split before confirming these are distinct.
    await splitOpportunity({
      opportunityId: firstOpportunityId,
      sourcePostingId: secondJobId,
      reason: "Prepare distinct memberships for no-match review",
      idempotencyKey: `m8-review-split-${suffix}`,
      actorUserId: userId,
    });
    const dismissed = await dismissOpportunityReview({
      reviewId,
      reason: "Separate requisitions with no exact identity evidence",
      idempotencyKey: `m8-review-dismiss-${suffix}`,
      actorUserId: userId,
    });
    expect(dismissed.status).toBe("DISMISSED");

    const verify = postgres(databaseUrl!, { max: 1 });
    try {
      const memberships = await verify`
        select pinned from public.job_opportunity_postings
        where job_id in (${firstJobId}::uuid, ${secondJobId}::uuid) and valid_to is null
      `;
      expect(memberships).toHaveLength(2);
      expect(memberships.every((row) => row.pinned === true)).toBe(true);
      const [audit] = await verify`
        select count(*)::int as count from public.audit_events
        where actor_user_id = ${userId}::uuid
          and action = 'OPPORTUNITY_NO_MATCH_CONFIRMED'
      `;
      expect(audit?.count).toBe(1);
    } finally {
      await verify.end();
    }
  });
});
