import { describe, expect, it } from "vitest";

import { addDays, DEFAULT_APPLICATION_PLAN_TEMPLATE, planFingerprint } from "./calendar";

const input = {
  companyId: "10000000-0000-0000-0000-000000000001",
  title: "Apply to Stripe SWE Intern",
  targetDate: "2026-11-01",
  timezone: "America/Chicago",
};

describe("deterministic application planning", () => {
  it("keeps the explainable default sequence and relative offsets stable", () => {
    expect(DEFAULT_APPLICATION_PLAN_TEMPLATE.map((step) => step.relativeDayOffset)).toEqual([
      -7, -5, -3, -2, 0, 2,
    ]);
    expect(DEFAULT_APPLICATION_PLAN_TEMPLATE.map((step) => step.taskType)).toEqual([
      "RESUME_WORK",
      "APPLICATION_TASK",
      "INTERVIEW_PREP",
      "LEETCODE",
      "APPLICATION_TASK",
      "RECRUITER_OUTREACH",
    ]);
  });

  it("uses calendar-date arithmetic without daylight-saving drift", () => {
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("fingerprints identical plans and separates meaningful changes", () => {
    const owner = "00000000-0000-0000-0000-000000000001";
    expect(planFingerprint(owner, input)).toBe(planFingerprint(owner, { ...input }));
    expect(planFingerprint(owner, input)).not.toBe(
      planFingerprint(owner, { ...input, targetDate: "2026-11-02" }),
    );
  });
});
