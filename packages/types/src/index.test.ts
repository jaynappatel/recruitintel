import { describe, expect, it } from "vitest";

import {
  attachGithubRepositoryRequestSchema,
  interviewQuestionAnalyticsSchema,
  jobsQuerySchema,
  publicRecruitingClaimSchema,
  publicRecruitingObservationSchema,
  publicWebIntelligenceSchema,
  roleFamilySchema,
  webSearchRequestSchema,
} from "./index";

describe("API query schemas", () => {
  it("coerces bounded pagination inputs", () => {
    expect(jobsQuerySchema.parse({ limit: "20", offset: "5" })).toMatchObject({
      limit: 20,
      offset: 5,
    });
  });

  it("rejects unknown role families", () => {
    expect(() => roleFamilySchema.parse("MAGIC")).toThrow();
  });

  it("turns boolean query values into booleans", () => {
    expect(jobsQuerySchema.parse({ earlyCareerOnly: "true" }).earlyCareerOnly).toBe(true);
  });

  it("accepts a safe GitHub attachment contract and applies parser defaults", () => {
    const input = attachGithubRepositoryRequestSchema.parse({
      repositoryUrl: "https://github.com/example/interview-questions",
      repositoryType: "INTERVIEW_QUESTIONS",
      watchedPaths: ["questions/company.md"],
    });
    expect(input.parserType).toBe("AUTO");
    expect(input.enabled).toBe(true);
  });

  it("rejects GitHub URLs and watched paths outside the safe contract", () => {
    expect(() =>
      attachGithubRepositoryRequestSchema.parse({
        repositoryUrl: "https://user:token@github.com/example/questions",
        repositoryType: "INTERVIEW_QUESTIONS",
        watchedPaths: ["../secrets"],
      }),
    ).toThrow();
  });

  it("validates the stable interview analytics response shape", () => {
    expect(
      interviewQuestionAnalyticsSchema.parse({
        items: [],
        aggregates: {
          totalQuestions: 0,
          totalObservations: 0,
          totalSources: 0,
          topicCounts: [],
          difficultyCounts: [],
        },
        ordering: "OBSERVATION_COUNT_THEN_RECENCY",
      }),
    ).toMatchObject({ items: [], aggregates: { totalQuestions: 0 } });
  });

  it("bounds public-web search budgets", () => {
    expect(
      webSearchRequestSchema.parse({
        provider: "static",
        focus: "INTERNSHIP",
        maxResults: 10,
        maxFetches: 3,
      }),
    ).toMatchObject({
      provider: "static",
      focus: "INTERNSHIP",
      minimumIntervalSeconds: 86_400,
      maxResults: 10,
      maxFetches: 3,
    });
    expect(() => webSearchRequestSchema.parse({ maxResults: 2, maxFetches: 3 })).toThrow();
  });

  it("validates public-web provenance and claim conflicts", () => {
    const observation = publicRecruitingObservationSchema.parse({
      id: "81000000-0000-0000-0000-000000000001",
      companyId: "10000000-0000-0000-0000-000000000001",
      type: "APPLICATION_DATE",
      title: "Applications open September 1",
      summary: "The internship page names an application opening date.",
      evidenceText: "Applications open September 1, 2026.",
      occurredAt: null,
      dateStart: "2026-09-01",
      dateEnd: null,
      datePrecision: "EXACT",
      dateCertainty: "CONFIRMED",
      confidence: 0.95,
      contentHash: "a".repeat(64),
      discoveredAt: "2026-08-17T00:00:00.000Z",
      lastVerifiedAt: "2026-08-17T00:00:00.000Z",
      linkedJobId: null,
      linkedSchool: null,
      source: {
        id: "82000000-0000-0000-0000-000000000001",
        name: "Example careers",
        type: "PUBLIC_WEB",
        classification: "COMPANY_CAREERS",
        reliability: "OFFICIAL",
        reliabilityScore: 0.95,
        url: "https://example.com/careers/internships",
        candidateId: "83000000-0000-0000-0000-000000000001",
        canonicalUrl: "https://example.com/careers/internships",
        provider: "static",
      },
      metadata: { relevance_signals: ["internship"] },
    });
    const claim = publicRecruitingClaimSchema.parse({
      id: "84000000-0000-0000-0000-000000000001",
      companyId: observation.companyId,
      type: "APPLICATION_DATE",
      title: observation.title,
      normalizedSubject: "application_date:internship",
      status: "CONFLICTING",
      preferredObservationId: observation.id,
      lastVerifiedAt: observation.lastVerifiedAt,
      confidence: 0.95,
      supportingSourceCount: 2,
      observations: [observation],
      metadata: { distinct_date_count: 2 },
    });
    expect(claim.status).toBe("CONFLICTING");
    expect(claim.observations[0]?.source.reliability).toBe("OFFICIAL");
  });

  it("validates the public-web company summary contract", () => {
    expect(
      publicWebIntelligenceSchema.parse({
        companyId: "10000000-0000-0000-0000-000000000001",
        candidateCounts: { total: 0, pending: 0, relevant: 0, blocked: 0 },
        observationCount: 0,
        claimCounts: { total: 0, conflicting: 0 },
        latestObservations: [],
        latestClaims: [],
      }),
    ).toMatchObject({ candidateCounts: { total: 0 }, latestClaims: [] });
  });
});
