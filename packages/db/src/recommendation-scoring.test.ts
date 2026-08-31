import { describe, expect, it } from "vitest";

import {
  RECOMMENDATION_ALGORITHM_VERSION,
  RECOMMENDATION_WEIGHTS,
  scoreOpportunityRecommendation,
  type RecommendationOpportunityFacts,
  type RecruitingPreferenceSnapshot,
} from "./recommendation-scoring";

const preferences: RecruitingPreferenceSnapshot = {
  graduationYear: 2027,
  usWorkAuthorized: true,
  requiresEmployerSponsorship: false,
  roleFamilies: ["SOFTWARE_ENGINEERING"],
  earlyCareerTracks: ["INTERNSHIP"],
  experienceLevels: ["INTERNSHIP"],
  workplaceModes: ["REMOTE", "HYBRID"],
  locations: [{ kind: "CITY_REGION_COUNTRY", city: "Austin", region: "TX", countryCode: "US" }],
};

const opportunity: RecommendationOpportunityFacts = {
  opportunityId: "21000000-0000-0000-0000-000000000001",
  companyId: "10000000-0000-0000-0000-000000000001",
  status: "ACTIVE",
  lifecycleStatus: "OPEN",
  roleFamily: "SOFTWARE_ENGINEERING",
  experienceLevel: "INTERNSHIP",
  isInternship: true,
  isNewGrad: false,
  graduationYears: [2027, 2028],
  workplaceMode: "HYBRID",
  locations: [{ city: "Austin", region: "TX", countryCode: "US", remoteRegion: null }],
  effectiveOpenedAt: "2026-08-24T12:00:00.000Z",
  deadlineAt: "2026-08-31T12:00:00.000Z",
  deadlineReliable: true,
  sourceAuthority: "OFFICIAL_ATS",
  sourceAuthorityReviewed: true,
  sponsorshipAvailable: null,
  sponsorshipUnavailable: null,
  workAuthorizationRequired: null,
};

const asOf = new Date("2026-08-25T12:00:00.000Z");

describe("deterministic opportunity recommendation v1", () => {
  it("keeps the versioned factor set small and totaling 100", () => {
    expect(RECOMMENDATION_ALGORITHM_VERSION).toBe("v1");
    expect(Object.keys(RECOMMENDATION_WEIGHTS)).toHaveLength(9);
    expect(Object.values(RECOMMENDATION_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(
      100,
    );
  });

  it("scores the same input identically with bounded reasons", () => {
    const input = {
      preferences,
      opportunity,
      watches: {
        watchedCompanyIds: new Set([opportunity.companyId]),
        watchedOpportunityIds: new Set<string>(),
      },
      asOf,
    };
    const first = scoreOpportunityRecommendation(input);
    const second = scoreOpportunityRecommendation(input);
    expect(first).toEqual(second);
    expect(first.eligibility).toBe("ELIGIBLE");
    expect(first.category).toBe("HIGH_PRIORITY");
    expect(first.reasonCodes).toContain("WATCHED_COMPANY");
    expect(first.reasonCodes).toContain("GRADUATION_YEAR_ELIGIBLE");
    expect(first.reasonCodes.length).toBeLessThanOrEqual(16);
  });

  it("keeps an explicit graduation mismatch outside weighted scoring", () => {
    const result = scoreOpportunityRecommendation({
      preferences: { ...preferences, graduationYear: 2029 },
      opportunity,
      watches: {
        watchedCompanyIds: new Set([opportunity.companyId]),
        watchedOpportunityIds: new Set<string>(),
      },
      asOf,
    });
    expect(result.eligibility).toBe("NOT_ELIGIBLE");
    expect(result.category).toBe("NOT_ELIGIBLE");
    expect(result.score).toBeNull();
    expect(result.hardConstraintCodes).toContain("GRADUATION_YEAR_INELIGIBLE");
    expect(result.reasonCodes).toContain("WATCHED_COMPANY");
  });

  it("treats explicit seniority mismatch as hard-ineligible", () => {
    const result = scoreOpportunityRecommendation({
      preferences,
      opportunity: { ...opportunity, experienceLevel: "SENIOR", isInternship: false },
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(result.eligibility).toBe("NOT_ELIGIBLE");
    expect(result.hardConstraintCodes).toContain("EXPLICIT_SENIORITY_MISMATCH");
  });

  it("treats explicit work-authorization mismatch as hard-ineligible", () => {
    const result = scoreOpportunityRecommendation({
      preferences: { ...preferences, usWorkAuthorized: false },
      opportunity: { ...opportunity, workAuthorizationRequired: true },
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(result.eligibility).toBe("NOT_ELIGIBLE");
    expect(result.hardConstraintCodes).toContain("WORK_AUTHORIZATION_REQUIRED");
  });

  it("keeps unknown evidence out of both numerator and denominator", () => {
    const unknown = scoreOpportunityRecommendation({
      preferences,
      opportunity: {
        ...opportunity,
        lifecycleStatus: "UNKNOWN",
        roleFamily: "OTHER",
        experienceLevel: "UNKNOWN",
        graduationYears: [],
        workplaceMode: "UNKNOWN",
        locations: [],
        deadlineAt: null,
        deadlineReliable: false,
      },
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(unknown.eligibility).toBe("UNKNOWN");
    expect(unknown.category).toBe("LOW_PRIORITY");
    for (const item of unknown.factors.filter((item) => item.state === "UNKNOWN")) {
      expect(item.availableWeight).toBe(0);
      expect(item.earnedWeight).toBe(0);
    }
  });

  it("matches structured location and reports explicit mismatch deterministically", () => {
    const matching = scoreOpportunityRecommendation({
      preferences,
      opportunity,
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(matching.factors.find((item) => item.code === "LOCATION_MATCH")).toMatchObject({
      state: "MATCH",
      earnedWeight: 14,
    });
    const mismatching = scoreOpportunityRecommendation({
      preferences,
      opportunity: {
        ...opportunity,
        locations: [{ city: "San Francisco", region: "CA", countryCode: "US", remoteRegion: null }],
      },
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(mismatching.mismatchCodes).toContain("LOCATION_MISMATCH");
  });

  it("hard-suppresses closed opportunities regardless of watched company", () => {
    const result = scoreOpportunityRecommendation({
      preferences,
      opportunity: { ...opportunity, lifecycleStatus: "CLOSED" },
      watches: {
        watchedCompanyIds: new Set([opportunity.companyId]),
        watchedOpportunityIds: new Set(),
      },
      asOf,
    });
    expect(result.eligibility).toBe("NOT_ELIGIBLE");
    expect(result.score).toBeNull();
    expect(result.hardConstraintCodes).toContain("OPPORTUNITY_CLOSED");
  });

  it("does not let a watched company rescue the wrong role or workplace mode", () => {
    const result = scoreOpportunityRecommendation({
      preferences,
      opportunity: {
        ...opportunity,
        roleFamily: "DATA_SCIENCE",
        workplaceMode: "ONSITE",
      },
      watches: {
        watchedCompanyIds: new Set([opportunity.companyId]),
        watchedOpportunityIds: new Set(),
      },
      asOf,
    });
    expect(result.eligibility).toBe("ELIGIBLE");
    expect(result.score).not.toBeNull();
    expect(result.mismatchCodes).toEqual(
      expect.arrayContaining(["ROLE_FAMILY_MISMATCH", "WORKPLACE_MODE_MISMATCH"]),
    );
    expect(result.reasonCodes).toContain("WATCHED_COMPANY");
  });

  it("keeps deadline urgency and source confidence bounded and explainable", () => {
    const result = scoreOpportunityRecommendation({
      preferences: {
        ...preferences,
        roleFamilies: [],
        earlyCareerTracks: [],
        experienceLevels: [],
      },
      opportunity: {
        ...opportunity,
        deadlineAt: "2026-08-26T12:00:00.000Z",
        sourceAuthority: "OFFICIAL_ATS",
        sourceAuthorityReviewed: true,
      },
      watches: { watchedCompanyIds: new Set(), watchedOpportunityIds: new Set() },
      asOf,
    });
    expect(result.factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DEADLINE_URGENCY", reasonCode: "DEADLINE_WITHIN_1_DAY" }),
        expect.objectContaining({ code: "SOURCE_CONFIDENCE", reasonCode: "SOURCE_OFFICIAL_ATS" }),
      ]),
    );
    expect(result.reasonCodes.length).toBeLessThanOrEqual(16);
  });

  it("keeps closed and superseded opportunities out of the normal score", () => {
    for (const lifecycle of ["CLOSED", "SUPERSEDED"] as const) {
      const result = scoreOpportunityRecommendation({
        preferences,
        opportunity: {
          ...opportunity,
          lifecycleStatus: lifecycle === "SUPERSEDED" ? "OPEN" : lifecycle,
          status: lifecycle === "SUPERSEDED" ? "SUPERSEDED" : "ACTIVE",
        },
        watches: {
          watchedCompanyIds: new Set([opportunity.companyId]),
          watchedOpportunityIds: new Set(),
        },
        asOf,
      });
      expect(result.eligibility).toBe("NOT_ELIGIBLE");
      expect(result.score).toBeNull();
    }
  });
});
