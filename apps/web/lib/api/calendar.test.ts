import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApplicationPlan,
  CalendarItem,
  GoogleCalendarStatus,
  RecruitingDate,
} from "@recruitintel/types";

import {
  activateApplicationPlan,
  CalendarApiError,
  completeCalendarItem,
  createApplicationPlan,
  createCalendarItem,
  deleteApplicationPlan,
  deleteCalendarItem,
  disconnectGoogleCalendar,
  getApplicationPlan,
  getCalendarItems,
  getGoogleCalendarAuthorizeUrl,
  getGoogleCalendars,
  getGoogleCalendarStatus,
  listApplicationPlans,
  syncGoogleCalendar,
  toCalendarItemView,
  updateApplicationPlan,
  updateCalendarItem,
  updateGoogleCalendar,
  zonedDateTimeToIso,
} from "./calendar";

const COMPANY = {
  id: "10000000-0000-0000-0000-000000000001",
  name: "Stripe",
  slug: "stripe",
};

function canonicalItem(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "50000000-0000-0000-0000-000000000001",
    company: COMPANY,
    jobId: null,
    opportunityId: null,
    resolvedOpportunity: null,
    resolutionMismatch: false,
    recruitingDateId: null,
    applicationPlanId: null,
    type: "LEETCODE",
    title: "Graph practice",
    description: null,
    startsAt: "2026-08-20T14:00:00.000Z",
    endsAt: "2026-08-20T15:00:00.000Z",
    startsOn: null,
    endsOn: null,
    allDay: false,
    timezone: "America/Chicago",
    status: "TODO",
    source: "USER",
    syncEnabled: false,
    completedAt: null,
    metadata: {},
    recruitingDate: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function recruitingDate(overrides: Partial<RecruitingDate> = {}): RecruitingDate {
  return {
    id: "60000000-0000-0000-0000-000000000001",
    company: COMPANY,
    jobId: null,
    opportunityId: null,
    schoolId: null,
    recruitingEventId: null,
    campusRecruitingEventId: null,
    publicRecruitingObservationId: null,
    publicRecruitingClaimId: null,
    type: "EXPECTED_OPENING_WINDOW",
    title: "Expected opening window",
    startsAt: "2026-08-20T00:00:00.000Z",
    endsAt: "2026-08-25T00:00:00.000Z",
    startsOn: "2026-08-20",
    endsOn: "2026-08-25",
    allDay: true,
    timezone: "America/Chicago",
    dateCertainty: "ESTIMATED",
    datePrecision: "RANGE",
    confidence: 0.7,
    source: {
      kind: "PUBLIC_OBSERVATION",
      name: "Careers page history",
      url: "https://example.com/careers",
      provenance: {},
    },
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function planFixture(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  const item = canonicalItem({
    id: "50000000-0000-0000-0000-000000000002",
    applicationPlanId: "70000000-0000-0000-0000-000000000001",
    type: "RESUME_WORK",
    allDay: true,
    startsAt: "2026-08-13T00:00:00.000Z",
    endsAt: null,
    startsOn: "2026-08-13",
    endsOn: null,
    source: "APPLICATION_PLAN",
  });
  return {
    id: "70000000-0000-0000-0000-000000000001",
    company: COMPANY,
    jobId: null,
    opportunityId: null,
    resolvedOpportunity: null,
    resolutionMismatch: false,
    recruitingDateId: null,
    title: "Apply to Stripe",
    targetDate: "2026-08-20",
    timezone: "America/Chicago",
    status: "DRAFT",
    templateVersion: 1,
    metadata: { generator: "deterministic-v1" },
    activatedAt: null,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    tasks: [
      {
        id: "80000000-0000-0000-0000-000000000001",
        sequence: 0,
        relativeDayOffset: -7,
        taskType: "RESUME_WORK",
        generatedReason: "Tailor the resume.",
        metadata: {},
        createdAt: "2026-08-20T12:00:00.000Z",
        calendarItem: item,
      },
    ],
    ...overrides,
  };
}

function googleStatus(overrides: Partial<GoogleCalendarStatus> = {}): GoogleCalendarStatus {
  return {
    provider: "GOOGLE",
    status: "CONNECTED",
    accountEmail: "person@example.com",
    selectedCalendarId: "primary",
    scopes: ["https://www.googleapis.com/auth/calendar.events.owned"],
    preferences: {
      syncRecruitingDates: true,
      syncApplicationTasks: true,
      syncLeetcode: true,
      syncInterviewPrep: true,
      syncCareerEvents: true,
    },
    lastSyncAt: null,
    lastSyncStatus: null,
    reconnectRequired: false,
    errorCode: null,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("calendar API adapter", () => {
  it("preserves all-day dates and intelligence certainty without UTC shifting", () => {
    const date = recruitingDate();
    const view = toCalendarItemView(
      canonicalItem({
        type: "RECRUITING_DATE",
        recruitingDateId: date.id,
        startsAt: date.startsAt,
        endsAt: date.endsAt,
        startsOn: date.startsOn,
        endsOn: date.endsOn,
        allDay: true,
        source: "RECRUITING_INTELLIGENCE",
        recruitingDate: date,
      }),
    );

    expect(view.date).toBe("2026-08-20");
    expect(view.endDate).toBe("2026-08-25");
    expect(view.status).toBe("ESTIMATED");
    expect(view.itemStatus).toBe("TODO");
    expect(view.type).toBe("EXPECTED_OPENING_WINDOW");
  });

  it("converts local timed events with timezone and rejects a DST gap", () => {
    expect(zonedDateTimeToIso("2026-08-20", "09:00", "America/Chicago")).toBe(
      "2026-08-20T14:00:00.000Z",
    );
    expect(zonedDateTimeToIso("2026-03-08", "01:30", "America/Chicago")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(() => zonedDateTimeToIso("2026-03-08", "02:30", "America/Chicago")).toThrow(
      CalendarApiError,
    );
    expect(() => zonedDateTimeToIso("2026-08-20", "09:00", "Not/A_Zone")).toThrow(
      "Enter a valid IANA timezone.",
    );
  });

  it("lists, creates timed and all-day items, updates, completes, and deletes through real routes", async () => {
    const timed = canonicalItem();
    const allDay = canonicalItem({
      id: "50000000-0000-0000-0000-000000000003",
      type: "CUSTOM",
      startsAt: "2026-08-21T00:00:00.000Z",
      endsAt: null,
      startsOn: "2026-08-21",
      endsOn: null,
      allDay: true,
    });
    const completed = canonicalItem({ status: "DONE", completedAt: "2026-08-20T16:00:00.000Z" });
    const fetchMock = mockFetch(
      response({ data: [timed], meta: { total: 1 } }),
      response({ data: timed }, 201),
      response({ data: allDay }, 201),
      response({ data: { ...timed, title: "Updated title" } }),
      response({ data: completed }),
      response(null, 204),
    );

    await getCalendarItems({ from: "2026-08-01", to: "2026-08-31", company: "stripe" });
    await createCalendarItem({
      title: "Graph practice",
      date: "2026-08-20",
      time: "09:00",
      endTime: "10:00",
      allDay: false,
      timezone: "America/Chicago",
      type: "LEETCODE",
    });
    await createCalendarItem({
      title: "All-day task",
      date: "2026-08-21",
      allDay: true,
      timezone: "America/Chicago",
      type: "CUSTOM",
    });
    await updateCalendarItem(timed.id, { title: "Updated title" });
    await completeCalendarItem(timed.id);
    await deleteCalendarItem(timed.id);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/calendar?start=2026-08-01&end=2026-08-31&company=stripe",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      startsAt: "2026-08-20T14:00:00.000Z",
      endsAt: "2026-08-20T15:00:00.000Z",
      allDay: false,
      timezone: "America/Chicago",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      startsOn: "2026-08-21",
      allDay: true,
    });
    expect(fetchMock.mock.calls[4]?.[0]).toContain("/complete");
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("DELETE");
  });

  it("uses backend-generated plans and wires every plan route without sending a browser template", async () => {
    const company = {
      id: COMPANY.id,
      canonicalName: COMPANY.name,
      slug: COMPANY.slug,
      website: "https://stripe.com",
      careersUrl: "https://stripe.com/jobs",
      description: null,
      industry: null,
      atsType: null,
      atsIdentifier: null,
      openJobCount: 0,
      earlyCareerJobCount: 0,
      latestEventAt: null,
    };
    const plan = planFixture();
    const active = planFixture({
      status: "ACTIVE",
      activatedAt: "2026-08-20T13:00:00.000Z",
    });
    const fetchMock = mockFetch(
      response({ data: company }),
      response({ data: plan }, 201),
      response({ data: [plan], meta: { total: 1 } }),
      response({ data: plan }),
      response({ data: { ...plan, title: "Updated plan" } }),
      response({ data: active }),
      response(null, 204),
    );

    await createApplicationPlan({
      companySlug: "stripe",
      companyName: "Stripe",
      targetLabel: "Apply to Stripe",
      targetDate: "2026-08-20",
      timezone: "America/Chicago",
    });
    await listApplicationPlans({ company: "stripe", status: "DRAFT" });
    await getApplicationPlan(plan.id);
    await updateApplicationPlan(plan.id, { title: "Updated plan" });
    await activateApplicationPlan(plan.id, false);
    await deleteApplicationPlan(plan.id);

    const createBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(createBody).toMatchObject({
      companyId: COMPANY.id,
      title: "Apply to Stripe",
      targetDate: "2026-08-20",
    });
    expect(createBody).not.toHaveProperty("template");
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({ sync: false });
    expect(fetchMock.mock.calls[6]?.[1]?.method).toBe("DELETE");
  });

  it("wires Google status, authorization, calendars, preferences, queued sync, and disconnect", async () => {
    const connected = googleStatus();
    const disconnected = googleStatus({
      status: "DISCONNECTED",
      accountEmail: null,
      scopes: [],
    });
    const request = {
      id: "90000000-0000-0000-0000-000000000001",
      connectionId: "91000000-0000-0000-0000-000000000001",
      status: "PENDING" as const,
      attemptCount: 0,
      requestedAt: "2026-08-20T12:00:00.000Z",
    };
    const fetchMock = mockFetch(
      response({ data: connected }),
      response({
        data: {
          authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=x",
          expiresAt: "2026-08-20T12:10:00.000Z",
        },
      }),
      response({
        data: [
          {
            id: "primary",
            summary: "My Calendar",
            primary: true,
            timezone: "America/Chicago",
            accessRole: "owner",
          },
        ],
        meta: { total: 1 },
      }),
      response({ data: { ...connected, selectedCalendarId: "work" } }),
      response({ data: request }, 202),
      response(null, 204),
      response({ data: disconnected }),
    );

    expect((await getGoogleCalendarStatus()).status).toBe("CONNECTED");
    expect(await getGoogleCalendarAuthorizeUrl()).toContain("accounts.google.com");
    expect(await getGoogleCalendars()).toHaveLength(1);
    await updateGoogleCalendar({
      selectedCalendarId: "work",
      preferences: { syncInterviewPrep: false },
    });
    expect((await syncGoogleCalendar()).status).toBe("PENDING");
    expect((await disconnectGoogleCalendar()).status).toBe("DISCONNECTED");

    expect(fetchMock.mock.calls[4]?.[0]).toBe("/api/integrations/google-calendar/sync");
    expect(fetchMock.mock.calls[4]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[5]?.[1]?.method).toBe("DELETE");
  });

  it("sanitizes backend/provider failures before exposing them to components", async () => {
    mockFetch(
      response(
        {
          error: {
            code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
            message: "provider stack and secret response body",
          },
        },
        502,
      ),
    );

    await expect(getGoogleCalendarAuthorizeUrl()).rejects.toMatchObject({
      code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
      message: "Google Calendar needs to be reconnected.",
    });
  });
});
