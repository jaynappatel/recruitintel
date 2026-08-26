import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  changeApplicationStatus,
  createApplication,
  createApplicationAlert,
  createAssessment,
  createInterview,
  getApplication,
  getApplicationTimeline,
  updateAssessment,
  updateInterview,
} from "./applications";
import { mergeOpportunities, splitOpportunity } from "./opportunities";
import {
  listOpportunityRecommendations,
  openRecommendation,
  updateRecruitingPreferences,
} from "./personalization";
import { createResumeDocument, createResumeVersion, materializeResumeJobMatch } from "./resume";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const owner = "00000000-0000-0000-0000-000000000001";
const second = "a0000000-0000-0000-0000-000000000002";

integration("M10 application lifecycle", () => {
  let opportunityId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [opportunity] =
        await sql`select id from public.job_opportunities where status='ACTIVE' order by id limit 1`;
      if (!opportunity) throw new Error("seed opportunity missing");
      opportunityId = String(opportunity.id);
      await sql`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-2026'`;
      await sql`insert into public.users (id,name,email,email_verified,status) values (${second}::uuid,'M10 Second','m10-second@example.test',true,'ACTIVE') on conflict (id) do nothing`;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    await sql`delete from public.users where id=${second}::uuid`;
    await sql.end();
  });

  it("persists an idempotent OA/interview lifecycle and isolates owners", async () => {
    const a = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-2026",
      applicationUrlUsed: "https://apply.example/m10",
    });
    const b = await createApplication(second, {
      opportunityId,
      cycleKey: "m10-2026",
      applicationUrlUsed: "https://apply.example/m10",
    });
    expect(a.id).not.toBe(b.id);
    await expect(getApplication(second, a.id)).rejects.toThrow();
    await expect(
      createApplication(owner, {
        opportunityId,
        cycleKey: "m10-2026",
        applicationUrlUsed: "https://apply.example/m10",
      }),
    ).rejects.toThrow();
    await changeApplicationStatus(owner, a.id, { status: "APPLIED", idempotencyKey: "m10-submit" });
    await changeApplicationStatus(owner, a.id, { status: "APPLIED", idempotencyKey: "m10-submit" });
    const assessment = await createAssessment(owner, a.id, {
      type: "OA",
      dueAt: "2027-01-02T12:00:00.000Z",
      idempotencyKey: "m10-oa",
    });
    if (!assessment) throw new Error("assessment missing");
    await updateAssessment(owner, a.id, String(assessment.id), {
      status: "COMPLETED",
      completedAt: "2027-01-01T12:00:00.000Z",
    });
    const interview = await createInterview(owner, a.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-01-03T12:00:00.000Z",
      endsAt: "2027-01-03T13:00:00.000Z",
      timezone: "America/Chicago",
    });
    await updateInterview(owner, a.id, String(interview.id), {
      startsAt: "2027-01-04T12:00:00.000Z",
    });
    await updateInterview(owner, a.id, String(interview.id), { status: "COMPLETED" });
    await createApplicationAlert({
      userId: owner,
      applicationId: a.id,
      alertType: "INTERVIEW_UPCOMING",
      reminderWindow: "NONE",
      title: "Interview",
      body: "Upcoming interview",
      reasonCodes: ["INTERVIEW_SCHEDULED"],
    });
    await createApplicationAlert({
      userId: owner,
      applicationId: a.id,
      alertType: "INTERVIEW_UPCOMING",
      reminderWindow: "NONE",
      title: "Interview",
      body: "Upcoming interview",
      reasonCodes: ["INTERVIEW_SCHEDULED"],
    });
    await changeApplicationStatus(owner, a.id, { status: "OFFER", idempotencyKey: "m10-offer" });
    const timeline = await getApplicationTimeline(owner, a.id);
    expect(timeline.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "APPLICATION_SUBMITTED",
        "OA_RECEIVED",
        "OA_COMPLETED",
        "INTERVIEW_SCHEDULED",
        "INTERVIEW_RESCHEDULED",
        "INTERVIEW_COMPLETED",
        "OFFER_RECEIVED",
      ]),
    );
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [alerts] =
        await sql`select count(*)::int as count from public.alerts where user_id=${owner}::uuid and application_id=${a.id}::uuid`;
      const [calendar] =
        await sql`select count(*)::int as count from public.calendar_items where user_id=${owner}::uuid and application_id=${a.id}::uuid`;
      expect(Number(alerts?.count)).toBe(2);
      expect(Number(calendar?.count)).toBe(2);
    } finally {
      await sql.end();
    }
  });

  it("holds PostgreSQL invariants under concurrent application and alert writes", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-race'`;
    await cleanup.end();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        createApplication(owner, {
          opportunityId,
          cycleKey: "m10-race",
          applicationUrlUsed: "https://apply.example/race",
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const app = (
      results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<
        Awaited<ReturnType<typeof createApplication>>
      >
    ).value;
    await Promise.all([
      createApplicationAlert({
        userId: owner,
        applicationId: app.id,
        alertType: "APPLICATION_ACTION_DUE",
        reminderWindow: "DUE",
        title: "Action",
        body: "Action due",
        reasonCodes: ["NEXT_ACTION"],
      }),
      createApplicationAlert({
        userId: owner,
        applicationId: app.id,
        alertType: "APPLICATION_ACTION_DUE",
        reminderWindow: "DUE",
        title: "Action",
        body: "Action due",
        reasonCodes: ["NEXT_ACTION"],
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.applications where user_id=${owner}::uuid and opportunity_id=${opportunityId}::uuid and cycle_key='m10-race' and archived_at is null) applications,
        (select count(*)::int from public.alerts where user_id=${owner}::uuid and application_id=${app.id}::uuid and alert_type='APPLICATION_ACTION_DUE') alerts`;
      expect(Number(counts?.applications)).toBe(1);
      expect(Number(counts?.alerts)).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("serializes identical status transitions and assessment completion", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-status-race'`;
    await cleanup.end();
    const app = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-status-race",
      applicationUrlUsed: "https://apply.example/status-race",
    });
    const statuses = await Promise.allSettled([
      changeApplicationStatus(owner, app.id, { status: "APPLIED", idempotencyKey: "status-race" }),
      changeApplicationStatus(owner, app.id, { status: "APPLIED", idempotencyKey: "status-race" }),
    ]);
    expect(statuses.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const assessment = await createAssessment(owner, app.id, {
      type: "OA",
      idempotencyKey: "assessment-race",
    });
    if (!assessment) throw new Error("assessment missing");
    await Promise.all([
      updateAssessment(owner, app.id, String(assessment.id), {
        status: "COMPLETED",
        completedAt: "2027-02-01T12:00:00.000Z",
      }),
      updateAssessment(owner, app.id, String(assessment.id), {
        status: "COMPLETED",
        completedAt: "2027-02-01T12:00:00.000Z",
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='APPLICATION_SUBMITTED') submitted,
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='OA_COMPLETED') completed,
        (select status::text from public.application_assessments where id=${String(assessment.id)}::uuid) assessment_status`;
      expect(Number(counts?.submitted)).toBe(1);
      expect(Number(counts?.completed)).toBe(1);
      expect(counts?.assessment_status).toBe("COMPLETED");
    } finally {
      await sql.end();
    }
  });

  it("deduplicates concurrent interview scheduling and rescheduling", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-interview-race'`;
    await cleanup.end();
    const app = await createApplication(owner, {
      opportunityId,
      cycleKey: "m10-interview-race",
      applicationUrlUsed: "https://apply.example/interview-race",
    });
    const scheduled = await Promise.allSettled([
      createInterview(owner, app.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-03-01T12:00:00.000Z",
        endsAt: "2027-03-01T13:00:00.000Z",
        timezone: "UTC",
      }),
      createInterview(owner, app.id, {
        interviewType: "TECHNICAL",
        startsAt: "2027-03-01T12:00:00.000Z",
        endsAt: "2027-03-01T13:00:00.000Z",
        timezone: "UTC",
      }),
    ]);
    expect(scheduled.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const interview = (
      scheduled.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
      }>
    ).value;
    await Promise.all([
      updateInterview(owner, app.id, String(interview.id), {
        startsAt: "2027-03-02T12:00:00.000Z",
      }),
      updateInterview(owner, app.id, String(interview.id), {
        startsAt: "2027-03-02T12:00:00.000Z",
      }),
    ]);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`select
        (select count(*)::int from public.application_interviews where application_id=${app.id}::uuid and status <> 'CANCELLED') interviews,
        (select count(*)::int from public.calendar_items where application_id=${app.id}::uuid and application_interview_id=${interview.id}::uuid and deleted_at is null) calendar_items,
        (select count(*)::int from public.application_events where application_id=${app.id}::uuid and event_type='INTERVIEW_RESCHEDULED') reschedules`;
      expect(Number(counts?.interviews)).toBe(1);
      expect(Number(counts?.calendar_items)).toBe(1);
      expect(Number(counts?.reschedules)).toBe(1);
    } finally {
      await sql.end();
    }
  });

  it("links a production recommendation impression through application outcome", async () => {
    const cleanup = postgres(databaseUrl!, { max: 1 });
    await cleanup`delete from public.applications where user_id=${owner}::uuid and cycle_key='m10-recommendation-e2e'`;
    await cleanup.end();
    await updateRecruitingPreferences(owner, {
      roleFamilies: ["SOFTWARE_ENGINEERING"],
      earlyCareerTracks: ["INTERNSHIP"],
      experienceLevels: ["INTERNSHIP"],
      workplaceModes: ["REMOTE", "HYBRID", "ONSITE"],
      graduationYear: null,
    });
    const recommendations = await listOpportunityRecommendations(owner, {
      limit: 50,
      includeIneligible: false,
      includeLowPriority: true,
    });
    const item = recommendations.items[0];
    if (!item) throw new Error("Expected seeded opportunity recommendation");
    await openRecommendation(owner, item.impressionId);
    const resumeDocument = await createResumeDocument(owner, {
      originalFilename: "recommendation-match.txt",
      mediaType: "text/plain",
      bytes: "Python TypeScript",
    });
    const resumeVersion = await createResumeVersion(owner, resumeDocument.id, "Python TypeScript");
    const match = await materializeResumeJobMatch(owner, resumeVersion.id, item.opportunity.id, {
      rankingDecisionId: item.rankingDecisionId,
      recommendationImpressionId: item.impressionId,
    });
    const application = await createApplication(owner, {
      opportunityId: item.opportunity.id,
      cycleKey: "m10-recommendation-e2e",
      originRecommendationImpressionId: item.impressionId,
      applicationUrlUsed: "https://apply.example/recommendation-e2e",
    });
    const bound = await (await import("./applications")).bindApplicationMatch(
      owner,
      application.id,
      resumeVersion.id,
      match.id,
    );
    expect(bound.matchId).toBe(match.id);
    await changeApplicationStatus(owner, application.id, {
      status: "APPLIED",
      idempotencyKey: "m10-recommendation-submit",
    });
    const assessment = await createAssessment(owner, application.id, {
      type: "OA",
      idempotencyKey: "m10-recommendation-oa",
    });
    if (!assessment) throw new Error("Expected recommendation assessment");
    await updateAssessment(owner, application.id, String(assessment.id), { status: "COMPLETED" });
    const interview = await createInterview(owner, application.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-09-01T12:00:00.000Z",
      endsAt: "2027-09-01T13:00:00.000Z",
      timezone: "UTC",
    });
    await updateInterview(owner, application.id, String(interview.id), { status: "COMPLETED" });
    await changeApplicationStatus(owner, application.id, {
      status: "OFFER",
      idempotencyKey: "m10-recommendation-offer",
    });
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [link] = await sql`
        select a.origin_recommendation_impression_id, a.match_id, i.ranking_decision_id,
          a.current_status::text as status, a.current_stage::text as stage,
          (select count(*)::int from public.application_events where application_id=a.id) as events
        from public.applications a
        join public.recommendation_impressions i on i.id=a.origin_recommendation_impression_id
        where a.id=${application.id}::uuid and a.user_id=${owner}::uuid
      `;
      expect(String(link?.origin_recommendation_impression_id)).toBe(item.impressionId);
      expect(String(link?.match_id)).toBe(match.id);
      expect(link?.ranking_decision_id).toBeTruthy();
      expect(link?.status).toBe("OFFER");
      expect(link?.stage).toBe("OA");
      expect(Number(link?.events)).toBeGreaterThanOrEqual(6);
      await expect(getApplication(second, application.id)).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

const resolutionCompanyId = randomUUID();
const resolutionSourceId = randomUUID();
const resolutionFirstJobId = randomUUID();
const resolutionSecondJobId = randomUUID();
const resolutionSuffix = resolutionCompanyId.replaceAll("-", "").slice(0, 12);

integration("M10 application canonical opportunity resolution", () => {
  let firstOpportunityId: string;
  let secondOpportunityId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      await sql`insert into public.users (id,name,email,email_verified,status)
        values (${second}::uuid,'M10 Resolution Second','m10-resolution-second@example.test',true,'ACTIVE')
        on conflict (id) do nothing`;
      await sql`
        insert into public.companies (id, canonical_name, slug, website, careers_url)
        values (${resolutionCompanyId}::uuid, ${`M10 resolution ${resolutionSuffix}`}, ${`m10-resolution-${resolutionSuffix}`},
          ${`https://${resolutionSuffix}.example.test`}, ${`https://${resolutionSuffix}.example.test/careers`})
      `;
      await sql`
        insert into public.sources (id, company_id, source_type, provider, external_key, name, base_url,
          reliability, source_policy_id)
        values (${resolutionSourceId}::uuid, ${resolutionCompanyId}::uuid, 'ATS', 'greenhouse', ${resolutionSuffix},
          'M10 resolution fixture', ${`https://boards.greenhouse.io/${resolutionSuffix}`}, 0.99,
          (select id from public.source_policies where provider = 'greenhouse'))
      `;
      for (const [jobId, externalId, hash] of [
        [resolutionFirstJobId, "m10-resolution-first", "c".repeat(64)],
        [resolutionSecondJobId, "m10-resolution-second", "d".repeat(64)],
      ] as const) {
        await sql`
          insert into public.jobs (id, company_id, source_id, external_id, title, description, location,
            role_family, experience_level, employment_type, is_internship, application_url, source_url, content_hash)
          values (${jobId}::uuid, ${resolutionCompanyId}::uuid, ${resolutionSourceId}::uuid, ${externalId},
            'Software Engineer Intern', 'M10 resolution fixture', 'Austin, TX', 'SOFTWARE_ENGINEERING',
            'INTERNSHIP', 'INTERNSHIP', true,
            ${`https://boards.greenhouse.io/${resolutionSuffix}/jobs/${externalId}`},
            ${`https://boards.greenhouse.io/${resolutionSuffix}/jobs/${externalId}`}, ${hash})
        `;
      }
      const [first] = await sql`
        select opportunity_id from public.job_opportunity_postings
        where job_id = ${resolutionFirstJobId}::uuid and valid_to is null
      `;
      const [secondOpportunity] = await sql`
        select opportunity_id from public.job_opportunity_postings
        where job_id = ${resolutionSecondJobId}::uuid and valid_to is null
      `;
      if (!first || !secondOpportunity) throw new Error("resolution opportunities missing");
      firstOpportunityId = String(first.opportunity_id);
      secondOpportunityId = String(secondOpportunity.opportunity_id);
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`delete from public.applications where user_id in (${owner}::uuid, ${second}::uuid)
        and opportunity_id in (${firstOpportunityId}::uuid, ${secondOpportunityId}::uuid)
        and cycle_key like 'm10-resolution-%'`;
      await sql`delete from public.companies where id = ${resolutionCompanyId}::uuid`;
    } finally {
      await sql.end();
    }
  });

  it("preserves private application targets through merge, split, and re-merge", async () => {
    const userA = await createApplication(owner, {
      opportunityId: secondOpportunityId,
      sourcePostingId: resolutionSecondJobId,
      cycleKey: "m10-resolution-a",
      applicationUrlUsed: "https://apply.example/m10-resolution-a",
    });
    const userB = await createApplication(second, {
      opportunityId: firstOpportunityId,
      sourcePostingId: resolutionFirstJobId,
      cycleKey: "m10-resolution-b",
      applicationUrlUsed: "https://apply.example/m10-resolution-b",
    });
    await changeApplicationStatus(owner, userA.id, {
      status: "APPLIED",
      idempotencyKey: "m10-resolution-submit",
    });
    const assessment = await createAssessment(owner, userA.id, {
      type: "OA",
      idempotencyKey: "m10-resolution-oa",
    });
    if (!assessment) throw new Error("resolution assessment missing");
    const interview = await createInterview(owner, userA.id, {
      interviewType: "TECHNICAL",
      startsAt: "2027-04-01T15:00:00.000Z",
      endsAt: "2027-04-01T16:00:00.000Z",
      timezone: "UTC",
    });
    const before = await getApplication(owner, userA.id);
    const beforeTimeline = await getApplicationTimeline(owner, userA.id);

    await mergeOpportunities({
      winnerId: firstOpportunityId,
      loserId: secondOpportunityId,
      reason: "M10 application resolution merge",
      idempotencyKey: "m10-resolution-merge",
      actorUserId: owner,
    });
    const merged = await getApplication(owner, userA.id);
    expect(merged.opportunityId).toBe(secondOpportunityId);
    expect(merged.sourcePostingId).toBe(resolutionSecondJobId);
    expect(merged.resolvedOpportunity?.id).toBe(firstOpportunityId);
    expect(merged.resolutionMismatch).toBe(true);
    expect(merged.currentStatus).toBe(before.currentStatus);
    expect(merged.currentStage).toBe(before.currentStage);
    expect((await getApplication(second, userB.id)).opportunityId).toBe(firstOpportunityId);
    await expect(getApplication(second, userA.id)).rejects.toThrow();

    await splitOpportunity({
      opportunityId: firstOpportunityId,
      sourcePostingId: resolutionSecondJobId,
      reason: "M10 application resolution split",
      idempotencyKey: "m10-resolution-split",
      actorUserId: owner,
    });
    const split = await getApplication(owner, userA.id);
    expect(split.opportunityId).toBe(secondOpportunityId);
    expect(split.sourcePostingId).toBe(resolutionSecondJobId);
    expect(split.resolvedOpportunity?.id).toBe(secondOpportunityId);
    expect(split.resolutionMismatch).toBe(false);
    expect(await getApplicationTimeline(owner, userA.id)).toHaveLength(beforeTimeline.length);

    await mergeOpportunities({
      winnerId: firstOpportunityId,
      loserId: secondOpportunityId,
      reason: "M10 application resolution re-merge",
      idempotencyKey: "m10-resolution-remerge",
      actorUserId: owner,
    });
    const remerged = await getApplication(owner, userA.id);
    expect(remerged.opportunityId).toBe(secondOpportunityId);
    expect(remerged.resolvedOpportunity?.id).toBe(firstOpportunityId);
    expect(remerged.resolutionMismatch).toBe(true);
    expect(await getApplicationTimeline(owner, userA.id)).toHaveLength(beforeTimeline.length);
    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [counts] = await sql`
        select
          (select count(*)::int from public.application_events where application_id = ${userA.id}::uuid) events,
          (select count(*)::int from public.application_assessments where application_id = ${userA.id}::uuid) assessments,
          (select count(*)::int from public.application_interviews where application_id = ${userA.id}::uuid) interviews,
          (select id from public.application_interviews where application_id = ${userA.id}::uuid limit 1) interview_id,
          (select count(*)::int from public.calendar_items where application_id = ${userA.id}::uuid and deleted_at is null) calendar_items,
          (select count(*)::int from public.application_events where application_id = ${userA.id}::uuid and user_id = ${owner}::uuid) owned_events,
          (select count(*)::int from public.job_resolution_decisions where company_id = ${resolutionCompanyId}::uuid
            and idempotency_key in ('m10-resolution-merge','m10-resolution-split','m10-resolution-remerge')) decisions
      `;
      expect(Number(counts?.events)).toBe(beforeTimeline.length);
      expect(Number(counts?.assessments)).toBe(1);
      expect(Number(counts?.interviews)).toBe(1);
      expect(String(counts?.interview_id)).toBe(interview.id);
      expect(Number(counts?.calendar_items)).toBe(1);
      expect(Number(counts?.owned_events)).toBe(beforeTimeline.length);
      expect(Number(counts?.decisions)).toBe(3);
    } finally {
      await sql.end();
    }
  });
});
