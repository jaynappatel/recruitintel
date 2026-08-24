import { describe, expect, it } from "vitest";

import {
  attachGithubRepositoryRequestSchema,
  createRecruiterEvidenceRequestSchema,
  createRecruiterRequestSchema,
  interviewQuestionAnalyticsSchema,
  jobsQuerySchema,
  publicRecruitingClaimSchema,
  publicRecruitingObservationSchema,
  publicWebIntelligenceSchema,
  roleFamilySchema,
  recruiterDetailSchema,
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
    expect(webSearchRequestSchema.parse({ provider: "searxng" }).provider).toBe("searxng");
    expect(() => webSearchRequestSchema.parse({ provider: "unreviewed-vendor" })).toThrow();
    expect(() => webSearchRequestSchema.parse({ provider: "you" })).toThrow();
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

  it("applies conservative defaults to manual recruiter evidence", () => {
    expect(
      createRecruiterRequestSchema.parse({
        name: "Jane Smith",
        title: "University Recruiter",
        sourceUrl: "https://example.edu/events/company",
        evidenceText: "Jane Smith is listed as the university recruiter contact.",
      }),
    ).toMatchObject({ confidence: 0.5, reliability: "UNKNOWN", schoolIdentifiers: [] });
    expect(
      createRecruiterEvidenceRequestSchema.parse({
        sourceUrl: "https://example.edu/events/company",
        evidenceType: "SCHOOL_CONNECTION",
        evidenceText: "Jane Smith is the listed contact for this event.",
      }),
    ).toMatchObject({ confidence: 0.5, reliability: "UNKNOWN" });
  });

  it("validates recruiter provenance, categorical relevance, and freshness", () => {
    const school = {
      id: "d2000000-0000-0000-0000-000000000001",
      canonicalName: "University of Texas at Austin",
      slug: "ut-austin",
      aliases: ["UT Austin"],
      domain: "utexas.edu",
      city: "Austin",
      stateRegion: "Texas",
      country: "US",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z",
    };
    const recruiter = recruiterDetailSchema.parse({
      id: "d3000000-0000-0000-0000-000000000001",
      personId: "d3000000-0000-0000-0000-000000000002",
      name: "Jane Smith",
      company: {
        id: "10000000-0000-0000-0000-000000000001",
        name: "Stripe",
        slug: "stripe",
      },
      title: "University Recruiter",
      categories: ["UNIVERSITY_RECRUITING"],
      location: null,
      publicProfileUrl: null,
      status: "ACTIVE",
      confidence: 0.9,
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      lastSeenAt: "2026-08-18T00:00:00.000Z",
      lastVerifiedAt: "2026-08-18T00:00:00.000Z",
      freshness: {
        status: "CURRENT",
        ageDays: 0,
        lastVerifiedAt: "2026-08-18T00:00:00.000Z",
      },
      schoolFocus: [
        {
          school,
          strength: "HIGH",
          reasons: ["two_independent_sources", "explicit_relationship"],
          evidenceCount: 2,
          confidence: 0.9,
          status: "ACTIVE",
          firstObservedAt: "2026-08-01T00:00:00.000Z",
          lastObservedAt: "2026-08-18T00:00:00.000Z",
          freshness: {
            status: "CURRENT",
            ageDays: 0,
            lastVerifiedAt: "2026-08-18T00:00:00.000Z",
          },
        },
      ],
      roleFocus: [],
      evidence: [
        {
          id: "d4000000-0000-0000-0000-000000000001",
          recruiterProfileId: "d3000000-0000-0000-0000-000000000001",
          source: {
            id: "d5000000-0000-0000-0000-000000000001",
            name: "UT Austin careers",
            type: "UNIVERSITY",
            reliabilityScore: 0.9,
          },
          recruitingObservationId: null,
          sourceUrl: "https://example.edu/events/company",
          evidenceType: "SCHOOL_CONNECTION",
          evidenceText: "Jane Smith is listed as the recruiter contact.",
          observedAt: "2026-08-18T00:00:00.000Z",
          publishedAt: null,
          contentHash: "a".repeat(64),
          fingerprint: "b".repeat(64),
          reliability: "HIGH",
          confidence: 0.9,
          school,
          roleFamily: null,
          metadata: {},
        },
      ],
    });
    expect(recruiter.schoolFocus[0]?.strength).toBe("HIGH");
    expect(recruiter.evidence[0]?.source.name).toBe("UT Austin careers");
  });
});
