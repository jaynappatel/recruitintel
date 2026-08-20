import { describe, expect, it } from "vitest";

import {
  calendarQuerySchema,
  createApplicationPlanRequestSchema,
  createCalendarItemRequestSchema,
  updateCalendarItemRequestSchema,
} from "./index";

describe("calendar API contracts", () => {
  it("accepts an all-day item without converting its local date", () => {
    expect(
      createCalendarItemRequestSchema.parse({
        title: "Review resume",
        type: "RESUME_WORK",
        allDay: true,
        startsOn: "2026-11-01",
        timezone: "America/Chicago",
      }),
    ).toMatchObject({ startsOn: "2026-11-01", status: "TODO", syncEnabled: false });
  });

  it("requires the correct timing representation", () => {
    expect(() =>
      createCalendarItemRequestSchema.parse({
        title: "Broken timed event",
        type: "CUSTOM",
        allDay: false,
        timezone: "UTC",
      }),
    ).toThrow();
    expect(() =>
      createCalendarItemRequestSchema.parse({
        title: "Broken all-day event",
        type: "CUSTOM",
        allDay: true,
        startsAt: "2026-08-20T12:00:00.000Z",
        timezone: "UTC",
      }),
    ).toThrow();
  });

  it("validates typed filters and non-empty patches", () => {
    expect(calendarQuerySchema.parse({ start: "2026-08-01", status: "DONE" })).toMatchObject({
      start: "2026-08-01",
      status: "DONE",
    });
    expect(() => calendarQuerySchema.parse({ type: "ALERT" })).toThrow();
    expect(() => updateCalendarItemRequestSchema.parse({})).toThrow();
  });

  it("accepts a bounded configurable deterministic plan template", () => {
    expect(
      createApplicationPlanRequestSchema.parse({
        companyId: "10000000-0000-0000-0000-000000000001",
        title: "Roblox SWE Intern",
        targetDate: "2026-08-20",
        timezone: "America/Chicago",
        template: [
          {
            relativeDayOffset: -7,
            taskType: "RESUME_WORK",
            title: "Resume review",
            generatedReason: "Tailor the resume before the opening window.",
          },
        ],
      }),
    ).toMatchObject({ targetDate: "2026-08-20" });
  });
});
