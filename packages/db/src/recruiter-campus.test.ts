import { describe, expect, it } from "vitest";

import { classifyFreshness, classifyRecruiterTitle } from "./recruiter-campus";

describe("recruiter and campus projections", () => {
  it("uses the same deterministic recruiter-title categories as the worker", () => {
    expect(classifyRecruiterTitle("Early Talent Technical Recruiter")).toEqual([
      "EARLY_CAREER",
      "TECHNICAL_RECRUITING",
    ]);
    expect(classifyRecruiterTitle("Talent Acquisition Partner")).toEqual(["TALENT_ACQUISITION"]);
    expect(classifyRecruiterTitle("Sales Director")).toEqual(["OTHER"]);
  });

  it("exposes categorical freshness and age without deleting stale records", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    expect(classifyFreshness("2026-08-01T00:00:00.000Z", now)).toMatchObject({
      status: "CURRENT",
      ageDays: 17,
    });
    expect(classifyFreshness("2026-04-01T00:00:00.000Z", now).status).toBe("AGING");
    expect(classifyFreshness("2025-01-01T00:00:00.000Z", now).status).toBe("STALE");
    expect(classifyFreshness(null, now)).toEqual({
      status: "UNKNOWN",
      ageDays: null,
      lastVerifiedAt: null,
    });
  });
});
