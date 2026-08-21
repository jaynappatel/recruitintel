import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activateApplicationPlan,
  consumeGoogleOauthState,
  createApplicationPlan,
  createCalendarItem,
  createGoogleOauthState,
  deleteCalendarItem,
  getCalendarItem,
  getDatabase,
  getGoogleCalendarStatus,
  listCalendarItems,
  materializeRecruitingDates,
  saveGoogleCalendarConnection,
  updateCalendarItem,
} from "./index";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userId = "f0000000-0000-0000-0000-000000000001";
const otherUserId = "f0000000-0000-0000-0000-000000000099";
const companyId = "f1000000-0000-0000-0000-000000000001";
const sourceId = "f2000000-0000-0000-0000-000000000001";
const campusEventId = "f3000000-0000-0000-0000-000000000001";
const questionId = "f4000000-0000-0000-0000-000000000001";

async function reset() {
  if (!databaseUrl) return;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`delete from public.calendar_oauth_states where user_id = ${userId}::uuid`;
    await sql`delete from public.calendar_connections where user_id = ${userId}::uuid`;
    await sql`delete from public.calendar_items where user_id = ${userId}::uuid`;
    await sql`delete from public.application_plans where user_id = ${userId}::uuid`;
    await sql`delete from public.recruiting_dates where company_id = ${companyId}::uuid`;
    await sql`delete from public.companies where id = ${companyId}::uuid`;
    await sql`delete from public.interview_questions where id = ${questionId}::uuid`;
    await sql`delete from public.users where id in (${userId}::uuid, ${otherUserId}::uuid)`;
  } finally {
    await sql.end();
  }
}

integration("PostgreSQL recruiting calendar and application planning", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    process.env.DATABASE_URL = databaseUrl;
    await reset();
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql`
        insert into public.users (id, name, email, email_verified, status)
        values
          (${userId}::uuid, 'Calendar User', 'calendar-user@example.com', true, 'ACTIVE'),
          (${otherUserId}::uuid, 'Other User', 'other-user@example.com', true, 'ACTIVE')
      `;
      await sql`
        insert into public.companies (id, canonical_name, slug, website, careers_url)
        values (
          ${companyId}::uuid, 'M5 Contract Company', 'm5-contract-company',
          'https://m5.example', 'https://m5.example/careers'
        )
      `;
      await sql`
        insert into public.sources (
          id, company_id, source_type, provider, external_key, name, base_url, reliability
        ) values (
          ${sourceId}::uuid, ${companyId}::uuid, 'UNIVERSITY', 'm5_contract',
          'm5-contract-calendar', 'M5 University careers',
          'https://university.example/events', 0.9
        )
      `;
      await sql`
        insert into public.campus_recruiting_events (
          id, company_id, title, event_type, description, date_start, date_precision,
          date_certainty, source_id, source_url, first_seen_at, last_verified_at,
          content_hash, confidence, fingerprint
        ) values (
          ${campusEventId}::uuid, ${companyId}::uuid, 'M5 Engineering Career Fair',
          'CAREER_FAIR', 'A confirmed university career fair.', '2026-11-01', 'EXACT',
          'CONFIRMED', ${sourceId}::uuid, 'https://university.example/events/m5-fair',
          now(), now(), ${"a".repeat(64)}, 0.9, ${"b".repeat(64)}
        )
      `;
      await sql`
        insert into public.interview_questions (
          id, canonical_title, normalized_title, difficulty, topics
        ) values (
          ${questionId}::uuid, 'M5 Graph Traversal', 'm5 graph traversal', 'MEDIUM',
          '{Graphs,Trees}'
        )
      `;
      await sql`
        insert into public.company_interview_questions (
          company_id, interview_question_id, first_seen_at, last_seen_at,
          observation_count, confidence
        ) values (${companyId}::uuid, ${questionId}::uuid, now(), now(), 3, 0.8)
      `;
    } finally {
      await sql.end();
    }
  });

  afterAll(async () => {
    if (!databaseUrl) return;
    await getDatabase().end();
    await reset();
  });

  it("deduplicates source dates, generates topic-aware tasks, and activates once", async () => {
    const firstMaterialization = await materializeRecruitingDates(userId);
    const secondMaterialization = await materializeRecruitingDates(userId);
    expect(firstMaterialization.dates).toBeGreaterThanOrEqual(1);
    expect(secondMaterialization.items).toBe(firstMaterialization.items);

    const calendar = await listCalendarItems(userId, { company: "m5-contract-company" });
    const recruitingItem = calendar.find((item) => item.recruitingDate?.campusRecruitingEventId);
    expect(recruitingItem).toMatchObject({
      type: "CAREER_EVENT",
      allDay: true,
      startsOn: "2026-11-01",
      source: "RECRUITING_INTELLIGENCE",
    });
    expect(recruitingItem?.recruitingDate?.dateCertainty).toBe("CONFIRMED");
    if (!recruitingItem?.recruitingDateId)
      throw new Error("Expected a materialized recruiting date");

    const planInput = {
      companyId,
      recruitingDateId: recruitingItem.recruitingDateId,
      title: "Apply to M5 Contract Company",
      targetDate: "2026-11-01",
      timezone: "America/Chicago",
    };
    const plan = await createApplicationPlan(userId, planInput);
    const duplicate = await createApplicationPlan(userId, planInput);
    expect(duplicate.id).toBe(plan.id);
    expect(plan.tasks).toHaveLength(6);
    expect(plan.tasks.map((task) => task.relativeDayOffset)).toEqual([-7, -5, -3, -2, 0, 2]);
    expect(plan.company.id).toBe(companyId);
    expect(plan.tasks.find((task) => task.taskType === "LEETCODE")?.metadata).toMatchObject({
      interviewTopics: ["Graphs", "Trees"],
    });

    await saveGoogleCalendarConnection({
      userId,
      providerAccountId: "m5-google-account",
      providerEmail: "m5@example.com",
      encryptedRefreshToken: "v1.test.test.test",
      scopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
      tokenMetadata: { test: true },
    });
    expect(await getGoogleCalendarStatus(otherUserId)).toMatchObject({
      status: "DISCONNECTED",
      accountEmail: null,
    });
    const active = await activateApplicationPlan(userId, plan.id, true);
    const activeAgain = await activateApplicationPlan(userId, plan.id, true);
    expect(active.status).toBe("ACTIVE");
    expect(activeAgain.tasks.map((task) => task.id)).toEqual(active.tasks.map((task) => task.id));
    expect(active.tasks.every((task) => task.calendarItem.syncEnabled)).toBe(true);

    const sql = postgres(databaseUrl!, { max: 1 });
    try {
      const [countRow] = await sql`
        select count(*)::int as count from public.calendar_sync_requests r
        join public.calendar_connections c on c.id = r.calendar_connection_id
        where c.user_id = ${userId}::uuid and r.status in ('PENDING', 'RUNNING')
      `;
      expect(countRow?.count).toBe(1);
      const productEvents = await sql`
        select event_type, count(*)::int as count from public.product_events
        where user_id = ${userId}::uuid
          and event_type in ('CALENDAR_PLAN_CREATED', 'CALENDAR_PLAN_ACTIVATED')
        group by event_type order by event_type
      `;
      expect(productEvents).toEqual([
        { event_type: "CALENDAR_PLAN_CREATED", count: 1 },
        { event_type: "CALENDAR_PLAN_ACTIVATED", count: 1 },
      ]);
    } finally {
      await sql.end();
    }
  });

  it("creates, completes, updates, and soft-deletes an owner-scoped calendar item", async () => {
    const created = await createCalendarItem(userId, {
      type: "CUSTOM",
      title: "M5 timed prep",
      startsAt: "2026-11-01T15:00:00.000-05:00",
      endsAt: "2026-11-01T16:00:00.000-05:00",
      allDay: false,
      timezone: "America/Chicago",
      status: "TODO",
      syncEnabled: false,
      metadata: {},
    });
    expect(await getCalendarItem(otherUserId, created.id)).toBeNull();
    const completed = await updateCalendarItem(userId, created.id, { status: "DONE" });
    expect(completed.completedAt).not.toBeNull();
    const eventSql = postgres(databaseUrl!, { max: 1 });
    try {
      const [eventCount] = await eventSql`
        select count(*)::int as count from public.product_events
        where user_id = ${userId}::uuid and entity_id = ${created.id}::uuid
          and event_type = 'CALENDAR_ITEM_COMPLETED'
      `;
      expect(eventCount?.count).toBe(1);
    } finally {
      await eventSql.end();
    }
    const reopened = await updateCalendarItem(userId, created.id, {
      status: "TODO",
      title: "M5 updated timed prep",
    });
    expect(reopened.completedAt).toBeNull();
    await deleteCalendarItem(userId, created.id);
    expect((await listCalendarItems(userId)).some((item) => item.id === created.id)).toBe(false);
  });

  it("consumes OAuth state exactly once and rejects replay", async () => {
    const hash = "c".repeat(64);
    await createGoogleOauthState({
      userId,
      stateHash: hash,
      encryptedCodeVerifier: "v1.test.test.test",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      returnTo: "/settings",
    });
    expect(await consumeGoogleOauthState(hash)).toMatchObject({ userId, returnTo: "/settings" });
    expect(await consumeGoogleOauthState(hash)).toBeNull();
    expect(await consumeGoogleOauthState("d".repeat(64))).toBeNull();
  });
});
