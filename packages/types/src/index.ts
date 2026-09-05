import { z } from "zod";

export const clientProductEventTypes = [
  "JOB_VIEWED",
  "RECRUITER_VIEWED",
  "INTERVIEW_INTEL_VIEWED",
  "SOURCE_POSTING_SELECTED",
] as const;

// M14 responses are aggregate-only. They intentionally contain no private rows or features.
export const personalAnalyticsSchema = z.object({
  impressions: z.number().int().nonnegative(),
  applications: z.number().int().nonnegative(),
  oaProgressions: z.number().int().nonnegative(),
  interviewProgressions: z.number().int().nonnegative(),
  offers: z.number().int().nonnegative(),
});
export const dataReadinessTaskSchema = z.enum([
  "PERSONALIZED_RANKING",
  "OPENING_FORECAST",
  "SOURCE_ANOMALY",
  "RESUME_OUTCOME",
  "INTERVIEW_TOPIC",
]);
export const m21PromotionGateSchema = z.enum([
  "REAL_CONSENTED_LABELS",
  "REPRODUCIBLE_DATASET",
  "POINT_IN_TIME_FEATURES",
  "CHRONOLOGICAL_HOLDOUT",
  "ENTITY_LEAKAGE_CONTROL",
  "DETERMINISTIC_BASELINE_WIN",
  "CALIBRATION",
  "PRIVACY_REVIEW",
  "PROTECTED_FEATURE_EXCLUSION",
  "SHADOW_HISTORY",
  "MODEL_CARD",
  "ROLLBACK",
  "MONITORING",
  "ZERO_COST",
]);
export const dataReadinessSchema = z.object({
  taskType: dataReadinessTaskSchema,
  status: z.enum(["READY", "NOT_READY"]),
  eligibleSampleCount: z.number().int().nonnegative(),
  positiveLabelCount: z.number().int().nonnegative(),
  negativeLabelCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
  companyCount: z.number().int().nonnegative(),
  timeSpanDays: z.number().int().nonnegative(),
  missingFeatureRate: z.number().min(0).max(1),
  classImbalance: z.number().nullable(),
  outcomeDelayDays: z.number().nullable(),
  duplicateCount: z.number().int().nonnegative(),
  leakageRisks: z.array(z.string()),
  labelConfidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  reasons: z.array(z.string()),
  authoritativeMode: z.literal("DETERMINISTIC"),
  baselineReference: z.string().min(1),
  datasetFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  shadowHistoryDays: z.number().int().nonnegative(),
  promotionGates: z.record(m21PromotionGateSchema, z.boolean()),
});
export const clientProductEventSchema = z
  .object({
    eventType: z.enum(clientProductEventTypes),
    entityId: z.uuid(),
  })
  .strict();
export type ClientProductEvent = z.infer<typeof clientProductEventSchema>;

const outreachUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => value.startsWith("https://"));
export const outreachContactRequestSchema = z
  .object({
    recruiterProfileId: z.uuid().nullable().optional(),
    applicationId: z.uuid().nullable().optional(),
    displayName: z.string().trim().min(1).max(200),
    companyName: z.string().trim().max(200).nullable().optional(),
    title: z.string().trim().max(200).nullable().optional(),
    email: z.email().max(320),
    contactTruth: z.enum(["VERIFIED_PUBLIC", "USER_PROVIDED", "UNVERIFIED"]),
    provenanceClass: z.enum([
      "OFFICIAL_COMPANY",
      "OFFICIAL_RECRUITING",
      "PUBLIC_EVENT",
      "PUBLIC_AUTHOR",
      "USER_ENTERED",
      "PREVIOUSLY_VERIFIED",
    ]),
    sourceUrl: outreachUrlSchema.nullable().optional(),
    sourceLabel: z.string().trim().min(1).max(160),
    consentAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable().optional(),
  })
  .strict();
export const outreachContactUpdateSchema = outreachContactRequestSchema
  .pick({
    displayName: true,
    companyName: true,
    title: true,
    email: true,
    sourceUrl: true,
    sourceLabel: true,
    lastSeenAt: true,
  })
  .partial()
  .strict();
export const outreachDraftRequestSchema = z
  .object({
    contactId: z.uuid(),
    applicationId: z.uuid().nullable().optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
  })
  .strict();
export const outreachDraftUpdateSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    version: z.number().int().positive(),
  })
  .strict();
export const outreachApprovalSchema = z.object({ version: z.number().int().positive() }).strict();
export const outreachManualSendSchema = z
  .object({ idempotencyKey: z.string().trim().min(1).max(200) })
  .strict();

export const roleFamilies = [
  "SOFTWARE_ENGINEERING",
  "AI_ML",
  "DATA_SCIENCE",
  "DATA_ENGINEERING",
  "PRODUCT",
  "DESIGN",
  "SECURITY",
  "CLOUD_DEVOPS",
  "QUANT",
  "HARDWARE",
  "OTHER",
] as const;

export const applicationStatuses = [
  "SAVED",
  "PLANNING",
  "APPLIED",
  "IN_PROCESS",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "CLOSED",
] as const;
export const applicationStages = [
  "NONE",
  "OA",
  "RECRUITER_SCREEN",
  "TECHNICAL_INTERVIEW",
  "ONSITE",
  "FINAL_ROUND",
] as const;
export const applicationStatusSchema = z.enum(applicationStatuses);
export const applicationStageSchema = z.enum(applicationStages);
export const createApplicationRequestSchema = z
  .object({
    opportunityId: z.uuid(),
    sourcePostingId: z.uuid().nullable().optional(),
    cycleKey: z.string().trim().min(1).max(80),
    applicationPlanId: z.uuid().nullable().optional(),
    originRecommendationImpressionId: z.uuid().nullable().optional(),
    applicationUrlUsed: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://"))
      .nullable()
      .optional(),
    appliedAt: z.iso.datetime().nullable().optional(),
  })
  .strict();
export const importApplicationRequestSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    location: z.string().trim().max(300).default(""),
    salary: z.string().trim().max(200).default(""),
    description: z.string().trim().max(100_000).default(""),
    notes: z.string().trim().max(10_000).default(""),
    applicationUrl: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://")),
    appliedAt: z.iso.datetime(),
  })
  .strict();
export const applicationStatusRequestSchema = z
  .object({
    status: applicationStatusSchema,
    stage: applicationStageSchema.optional(),
    occurredAt: z.iso.datetime().optional(),
    reasonCode: z.string().trim().max(100).optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export const applicationAssessmentRequestSchema = z
  .object({
    type: z.string().trim().min(1).max(40),
    dueAt: z.iso.datetime().nullable().optional(),
    providerName: z.string().trim().max(200).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const resumeUploadRequestSchema = z
  .object({
    originalFilename: z.string().trim().min(1).max(255),
    mediaType: z.enum(["application/pdf", "text/plain"]),
    content: z.string().min(1).max(14_000_000),
  })
  .strict();
export const resumeVersionRequestSchema = z
  .object({
    extractedText: z.string().min(1).max(200_000),
  })
  .strict();
export const evidenceReviewRequestSchema = z
  .object({
    disposition: z.enum(["CONFIRMED", "REJECTED", "CORRECTED"]),
    normalizedValue: z.record(z.string(), z.unknown()).optional(),
    reasonCode: z.string().trim().max(100).optional(),
  })
  .strict();
export const resumeMatchRequestSchema = z
  .object({
    opportunityId: z.uuid(),
    resumeVersionId: z.uuid(),
    rankingDecisionId: z.uuid().nullable().optional(),
    recommendationImpressionId: z.uuid().nullable().optional(),
  })
  .strict();

// M13 requests are deliberately small: source text never crosses this contract.
export const modelExplanationRequestSchema = z
  .object({
    matchId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export const modelOutputDispositionSchema = z
  .object({ disposition: z.enum(["CONFIRMED", "REJECTED"]) })
  .strict();

// M12 browser-companion inputs are deliberately structured: the server never
// accepts raw HTML, browser storage, form values, or an asserted owner ID.
const browserHttpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      );
    } catch {
      return false;
    }
  }, "URL must be an http(s) URL without credentials");

export const extensionGrantScopeSchema = z.enum(["PAGE_SCAN", "JOB_IMPORT"]);
export const createExtensionGrantRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    scopes: z.array(extensionGrantScopeSchema).min(1).max(2),
    expiresInSeconds: z.number().int().min(300).max(2_592_000).default(86_400),
  })
  .strict();

const browserCandidateSchema = z
  .object({
    kind: z.enum(["GRID", "SINGLE", "JSON_LD"]),
    url: browserHttpUrlSchema,
    title: z.string().trim().min(1).max(300),
    companyName: z.string().trim().min(1).max(300).nullable().optional(),
    location: z.string().trim().max(300).default(""),
    descriptionExcerpt: z.string().trim().max(8_000).default(""),
    extractionMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const browserScanUploadRequestSchema = z
  .object({
    protocolVersion: z.number().int().positive().max(10).default(1),
    pageUrl: browserHttpUrlSchema,
    pageTitle: z.string().trim().max(300).default(""),
    jsonLdCount: z.number().int().min(0).max(25).default(0),
    linkCount: z.number().int().min(0).max(250).default(0),
    candidates: z.array(browserCandidateSchema).min(1).max(100),
  })
  .strict();

export const browserCandidateSelectionRequestSchema = z
  .object({
    candidateRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const browserDecisionApplicationRequestSchema = z
  .object({
    cycleKey: z.string().trim().min(1).max(100),
    applicationUrlUsed: browserHttpUrlSchema.optional(),
  })
  .strict();
export const browserDecisionPlanRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    targetDate: z.iso.date(),
    timezone: z.string().trim().min(1).max(100),
  })
  .strict();
export const browserDecisionMatchRequestSchema = z.object({ resumeVersionId: z.uuid() }).strict();

export const eventTypes = [
  "JOB_OPENED",
  "JOB_CHANGED",
  "JOB_CLOSED",
  "RECRUITER_DISCOVERED",
  "RECRUITER_ACTIVITY",
  "GITHUB_REPOSITORY_UPDATED",
  "INTERVIEW_QUESTION_ADDED",
  "INTERVIEW_QUESTION_UPDATED",
  "INTERVIEW_REPORT_DISCOVERED",
  "CAREER_PAGE_CHANGED",
  "CAMPUS_EVENT_DISCOVERED",
  "SCHOOL_RECRUITING_SIGNAL",
  "RECRUITING_ARTICLE_DISCOVERED",
  "APPLICATION_DATE_SIGNAL",
  "HIRING_SIGNAL",
] as const;

export const roleFamilySchema = z.enum(roleFamilies);
export const eventTypeSchema = z.enum(eventTypes);
export const githubRepositoryTypes = [
  "INTERNSHIP_LIST",
  "NEW_GRAD_LIST",
  "INTERVIEW_QUESTIONS",
  "COMPANY_REPOSITORY",
  "OTHER",
] as const;
export const githubParserTypes = [
  "AUTO",
  "MARKDOWN_TABLE",
  "CSV",
  "JSON",
  "INTERNSHIP_LIST",
  "INTERVIEW_QUESTIONS",
] as const;
export const questionDifficulties = ["EASY", "MEDIUM", "HARD"] as const;
export const publicObservationTypes = [
  "INTERNSHIP_OPENING_SIGNAL",
  "NEW_GRAD_OPENING_SIGNAL",
  "APPLICATION_DATE",
  "APPLICATION_DEADLINE",
  "CAREER_FAIR",
  "CAMPUS_VISIT",
  "EARLY_CAREER_PROGRAM",
  "INTERVIEW_EXPERIENCE",
  "RECRUITING_ANNOUNCEMENT",
  "ROLE_FAMILY_SIGNAL",
  "SCHOOL_RECRUITING_SIGNAL",
  "GENERAL_RECRUITING_SIGNAL",
] as const;
export const webSourceClassifications = [
  "COMPANY_CAREERS",
  "COMPANY_BLOG",
  "COMPANY_PUBLIC_PAGE",
  "UNIVERSITY",
  "FORUM",
  "GITHUB",
  "PUBLIC_WEB",
  "RECRUITER_PUBLIC_PAGE",
  "OTHER",
] as const;
export const sourceReliabilityLevels = ["OFFICIAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export const relevanceStatuses = [
  "UNKNOWN",
  "RELEVANT",
  "POSSIBLY_RELEVANT",
  "NOT_RELEVANT",
] as const;
export const datePrecisions = ["EXACT", "RANGE", "MONTH", "APPROXIMATE", "UNKNOWN"] as const;
export const dateCertainties = ["CONFIRMED", "ESTIMATED", "HISTORICAL", "CLAIMED"] as const;
export const recruiterProfileStatuses = ["ACTIVE", "UNVERIFIED", "STALE", "INACTIVE"] as const;
export const recruiterRoleCategories = [
  "UNIVERSITY_RECRUITING",
  "EARLY_CAREER",
  "TECHNICAL_RECRUITING",
  "TALENT_ACQUISITION",
  "CAMPUS_PROGRAMS",
  "UNIVERSITY_PROGRAMS",
  "EMERGING_TALENT",
  "GENERAL_RECRUITING",
  "OTHER",
] as const;
export const recruiterEvidenceTypes = [
  "EMPLOYMENT",
  "UNIVERSITY_RECRUITING",
  "SCHOOL_CONNECTION",
  "ROLE_FOCUS",
  "CAMPUS_EVENT",
  "RECRUITING_ANNOUNCEMENT",
  "PUBLIC_PROFILE",
  "OTHER",
] as const;
export const relationshipStrengths = ["HIGH", "MEDIUM", "LOW", "LIMITED_EVIDENCE"] as const;
export const relationshipStatuses = ["ACTIVE", "UNVERIFIED", "STALE", "INACTIVE"] as const;
export const freshnessStatuses = ["CURRENT", "AGING", "STALE", "UNKNOWN"] as const;
export const campusRecruitingEventTypes = [
  "CAREER_FAIR",
  "INFO_SESSION",
  "COMPANY_VISIT",
  "TECH_TALK",
  "COFFEE_CHAT",
  "HACKATHON",
  "RECRUITING_EVENT",
  "INTERVIEW_EVENT",
  "OTHER",
] as const;

export const githubRepositoryTypeSchema = z.enum(githubRepositoryTypes);
export const githubParserTypeSchema = z.enum(githubParserTypes);
export const questionDifficultySchema = z.enum(questionDifficulties);
export const publicObservationTypeSchema = z.enum(publicObservationTypes);
export const webSourceClassificationSchema = z.enum(webSourceClassifications);
export const sourceReliabilityLevelSchema = z.enum(sourceReliabilityLevels);
export const relevanceStatusSchema = z.enum(relevanceStatuses);
export const datePrecisionSchema = z.enum(datePrecisions);
export const dateCertaintySchema = z.enum(dateCertainties);
export const recruiterProfileStatusSchema = z.enum(recruiterProfileStatuses);
export const recruiterRoleCategorySchema = z.enum(recruiterRoleCategories);
export const recruiterEvidenceTypeSchema = z.enum(recruiterEvidenceTypes);
export const relationshipStrengthSchema = z.enum(relationshipStrengths);
export const relationshipStatusSchema = z.enum(relationshipStatuses);
export const freshnessStatusSchema = z.enum(freshnessStatuses);
export const campusRecruitingEventTypeSchema = z.enum(campusRecruitingEventTypes);
export const databaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const orchestrationWorkTypes = [
  "ATS_COLLECT",
  "GITHUB_SYNC",
  "PUBLIC_WEB_SEARCH",
  "PUBLIC_WEB_FETCH",
  "PUBLIC_WEB_PROCESS",
  "RECRUITER_CAMPUS_PROJECT",
  "CALENDAR_SYNC",
  "PRIVACY_RETENTION_CLEANUP",
  "SOURCE_HEALTH_ROLLUP",
  "ALERT_FANOUT",
  "ALERT_EVALUATE",
] as const;
export const orchestrationWorkStatuses = [
  "READY",
  "LEASED",
  "RUNNING",
  "RETRY_WAIT",
  "SUCCEEDED",
  "CANCELLED",
  "DEAD_LETTERED",
  "AUTH_REQUIRED",
  "POLICY_BLOCKED",
] as const;
export const sourcePolicyStatuses = [
  "ALLOWED",
  "ALLOWED_WITH_LIMITS",
  "MANUAL_ONLY",
  "BLOCKED",
  "REVIEW_REQUIRED",
] as const;
export const orchestrationWorkTypeSchema = z.enum(orchestrationWorkTypes);
export const orchestrationWorkStatusSchema = z.enum(orchestrationWorkStatuses);
export const sourcePolicyStatusSchema = z.enum(sourcePolicyStatuses);
export const orchestrationListQuerySchema = z.object({
  status: orchestrationWorkStatusSchema.optional(),
  workType: orchestrationWorkTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export const scheduleUpdateSchema = z.object({ enabled: z.boolean() }).strict();
export const sourcePolicyUpdateSchema = z
  .object({
    status: sourcePolicyStatusSchema,
    reviewedBy: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !["ALLOWED", "ALLOWED_WITH_LIMITS"].includes(value.status) || Boolean(value.reviewedBy),
    { message: "Approved source policy requires a named reviewer", path: ["reviewedBy"] },
  );
export const sourceIncidentStatusSchema = z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]);
export const sourceIncidentListQuerySchema = z.object({
  status: sourceIncidentStatusSchema.optional(),
});
export const sourceIncidentUpdateSchema = z
  .object({ status: z.enum(["ACKNOWLEDGED", "RESOLVED"]) })
  .strict();

export const companySchema = z.object({
  id: databaseUuidSchema,
  canonicalName: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  website: z.url().nullable(),
  careersUrl: z.url().nullable(),
  description: z.string().nullable(),
  industry: z.string().nullable(),
  atsType: z.string().nullable(),
  atsIdentifier: z.string().nullable(),
  openJobCount: z.number().int().nonnegative(),
  earlyCareerJobCount: z.number().int().nonnegative(),
  latestEventAt: z.iso.datetime().nullable(),
});

export const jobSchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  companyName: z.string().min(1),
  companySlug: z.string().min(1),
  title: z.string().min(1),
  location: z.string(),
  roleFamily: roleFamilySchema,
  experienceLevel: z.string().min(1),
  employmentType: z.string().min(1),
  isInternship: z.boolean(),
  isNewGrad: z.boolean(),
  applicationUrl: z.url(),
  sourceUrl: z.url(),
  sourceName: z.string().min(1),
  publishedAt: z.iso.datetime().nullable(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  changedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  isDemo: z.boolean(),
});

export const opportunityLifecycleStatuses = ["OPEN", "CLOSED", "UNKNOWN"] as const;
export const opportunityStatuses = ["ACTIVE", "SUPERSEDED"] as const;
export const opportunityLifecycleStatusSchema = z.enum(opportunityLifecycleStatuses);
export const opportunityStatusSchema = z.enum(opportunityStatuses);

const opportunityCompanySchema = z.object({
  id: databaseUuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const opportunitySchema = z.object({
  id: databaseUuidSchema,
  company: opportunityCompanySchema,
  title: z.string().min(1),
  normalizedTitle: z.string().min(1),
  roleFamily: roleFamilySchema,
  experienceLevel: z.string().min(1),
  employmentType: z.string().min(1),
  isInternship: z.boolean(),
  isNewGrad: z.boolean(),
  season: z.string().nullable(),
  graduationYears: z.array(z.number().int()),
  location: z.string(),
  workplaceMode: z.enum(["REMOTE", "HYBRID", "ONSITE", "MIXED", "UNKNOWN"]),
  applicationUrl: z.url().nullable(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  deadlineAt: z.iso.datetime().nullable(),
  lifecycleStatus: opportunityLifecycleStatusSchema,
  status: opportunityStatusSchema,
  supersededById: databaseUuidSchema.nullable(),
  sourceCount: z.number().int().nonnegative(),
  mergeConfidence: z.number().min(0).max(1),
  canonicalizationVersion: z.number().int().positive(),
  lifecycleReason: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const opportunitySourcePostingSchema = z.object({
  id: databaseUuidSchema,
  source: z.object({
    id: databaseUuidSchema,
    name: z.string().min(1),
    type: z.string().min(1),
    provider: z.string().min(1),
  }),
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  location: z.string(),
  employmentType: z.string().min(1),
  roleFamily: roleFamilySchema,
  experienceLevel: z.string().min(1),
  isInternship: z.boolean(),
  isNewGrad: z.boolean(),
  season: z.string().nullable(),
  graduationYears: z.array(z.number().int()),
  applicationUrl: z.url(),
  sourceUrl: z.url(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  sourceContentHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceContentVersion: z.number().int().positive(),
  derivationHash: z.string().regex(/^[0-9a-f]{64}$/),
  derivationVersion: z.number().int().positive(),
  membership: z.object({
    method: z.string().min(1),
    pinned: z.boolean(),
    validFrom: z.iso.datetime(),
  }),
  authority: z.object({
    level: z.string().min(1),
    reviewed: z.boolean(),
    capabilityVersion: z.number().int().positive(),
  }),
  skills: z.array(
    z.object({
      canonicalName: z.string().nullable(),
      rawMention: z.string().min(1),
      requirement: z.string().min(1),
    }),
  ),
  constraints: z.array(
    z.object({
      type: z.string().min(1),
      value: z.record(z.string(), z.unknown()),
      evidence: z.string().min(1),
    }),
  ),
});

export const opportunityDetailSchema = opportunitySchema.extend({
  sources: z.array(opportunitySourcePostingSchema),
  resolutionHistory: z.array(
    z.object({
      id: databaseUuidSchema,
      action: z.string().min(1),
      outcome: z.enum(["MATCH", "NO_MATCH", "REVIEW_REQUIRED"]),
      decisionSource: z.enum(["MIGRATION", "SYSTEM", "MANUAL"]),
      reasonCodes: z.array(z.string().min(1)),
      algorithmVersion: z.number().int().positive(),
      fromOpportunityId: databaseUuidSchema.nullable(),
      toOpportunityId: databaseUuidSchema.nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const opportunitiesQuerySchema = z.object({
  companyId: databaseUuidSchema.optional(),
  roleFamily: roleFamilySchema.optional(),
  earlyCareerOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  lifecycleStatus: opportunityLifecycleStatusSchema.optional(),
  includeSuperseded: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});

export const opportunityCorrectionSchema = z.object({
  reason: z.string().trim().min(3).max(2_000),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export const mergeOpportunityRequestSchema = opportunityCorrectionSchema.extend({
  winnerId: databaseUuidSchema,
  loserId: databaseUuidSchema,
  reviewId: databaseUuidSchema.optional(),
});
export const splitOpportunityRequestSchema = opportunityCorrectionSchema.extend({
  opportunityId: databaseUuidSchema,
  sourcePostingId: databaseUuidSchema,
});
export const opportunityReviewStatusSchema = z.enum(["PENDING", "RESOLVED", "DISMISSED"]);
export const opportunityReviewsQuerySchema = z.object({
  status: opportunityReviewStatusSchema.default("PENDING"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const dismissOpportunityReviewRequestSchema = opportunityCorrectionSchema;

export const watchEntityTypes = ["COMPANY", "OPPORTUNITY", "RECRUITER", "SCHOOL"] as const;
export const watchReasons = [
  "SAVED_FOR_LATER",
  "TARGET_COMPANY",
  "RECRUITING_CONTACT",
  "TARGET_SCHOOL",
  "OTHER",
] as const;
export const watchNotificationOverrides = ["INHERIT", "ENABLED", "DISABLED"] as const;
export const watchSuccessorPolicies = ["MANUAL", "AUTO_FOLLOW_DIRECT"] as const;
export const watchEntityTypeSchema = z.enum(watchEntityTypes);
export const watchlistCreateSchema = z
  .object({
    entityType: watchEntityTypeSchema,
    entityId: databaseUuidSchema,
    reason: z.enum(watchReasons).default("OTHER"),
    notificationOverride: z.enum(watchNotificationOverrides).default("INHERIT"),
    successorPolicy: z.enum(watchSuccessorPolicies).default("MANUAL"),
  })
  .strict();
export const watchlistPatchSchema = z
  .object({
    notificationOverride: z.enum(watchNotificationOverrides).optional(),
    successorPolicy: z.enum(watchSuccessorPolicies).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");
export const watchlistQuerySchema = z.object({
  state: z.enum(["ACTIVE", "REMOVED", "SUPERSEDED"]).optional(),
  entityType: watchEntityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
export const watchlistItemSchema = z.object({
  id: databaseUuidSchema,
  entityType: watchEntityTypeSchema,
  entityId: databaseUuidSchema,
  entityLabel: z.string().min(1),
  entityHref: z.string().min(1),
  state: z.enum(["ACTIVE", "REMOVED", "SUPERSEDED"]),
  origin: z.enum(["USER", "MIGRATED_SOURCE_POSTING", "SUCCESSOR_FOLLOW"]),
  reason: z.enum(watchReasons),
  notificationOverride: z.enum(watchNotificationOverrides),
  successorPolicy: z.enum(watchSuccessorPolicies),
  resolvedSuccessor: z
    .object({ id: databaseUuidSchema, label: z.string().min(1), href: z.string().min(1) })
    .nullable(),
  createdAt: z.iso.datetime(),
  removedAt: z.iso.datetime().nullable(),
  supersededAt: z.iso.datetime().nullable(),
});

export const experienceLevels = [
  "INTERNSHIP",
  "ENTRY_LEVEL",
  "MID_LEVEL",
  "SENIOR",
  "LEADERSHIP",
] as const;
export const workplaceModes = ["REMOTE", "HYBRID", "ONSITE"] as const;
export const earlyCareerTracks = ["INTERNSHIP", "NEW_GRAD"] as const;
export const preferredLocationSchema = z
  .object({
    kind: z.enum(["CITY_REGION_COUNTRY", "REGION_COUNTRY", "COUNTRY", "REMOTE_REGION"]),
    city: z.string().trim().min(1).max(100).nullable().optional(),
    region: z.string().trim().min(1).max(100).nullable().optional(),
    countryCode: z.string().trim().length(2).toUpperCase().nullable().optional(),
    remoteRegion: z.string().trim().min(1).max(100).nullable().optional(),
    displayLabel: z.string().trim().min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.kind === "CITY_REGION_COUNTRY" && value.city && value.region && value.countryCode) ||
      (value.kind === "REGION_COUNTRY" && !value.city && value.region && value.countryCode) ||
      (value.kind === "COUNTRY" && !value.city && !value.region && value.countryCode) ||
      (value.kind === "REMOTE_REGION" &&
        !value.city &&
        !value.region &&
        !value.countryCode &&
        value.remoteRegion);
    if (!valid) context.addIssue({ code: "custom", message: "Location fields do not match kind" });
  });
export const recruitingPreferencesPatchSchema = z
  .object({
    graduationYear: z.number().int().min(2020).max(2050).nullable().optional(),
    usWorkAuthorized: z.boolean().nullable().optional(),
    requiresEmployerSponsorship: z.boolean().nullable().optional(),
    roleFamilies: z
      .array(roleFamilySchema.exclude(["OTHER"]))
      .max(10)
      .optional(),
    earlyCareerTracks: z.array(z.enum(earlyCareerTracks)).max(2).optional(),
    experienceLevels: z.array(z.enum(experienceLevels)).max(5).optional(),
    workplaceModes: z.array(z.enum(workplaceModes)).max(3).optional(),
    locations: z.array(preferredLocationSchema).max(20).optional(),
    targetSchoolIds: z.array(databaseUuidSchema).max(20).optional(),
  })
  .strict();
export const recruitingPreferencesSchema = recruitingPreferencesPatchSchema.extend({
  graduationYear: z.number().int().nullable(),
  usWorkAuthorized: z.boolean().nullable(),
  requiresEmployerSponsorship: z.boolean().nullable(),
  roleFamilies: z.array(roleFamilySchema.exclude(["OTHER"])),
  earlyCareerTracks: z.array(z.enum(earlyCareerTracks)),
  experienceLevels: z.array(z.enum(experienceLevels)),
  workplaceModes: z.array(z.enum(workplaceModes)),
  locations: z.array(preferredLocationSchema.extend({ id: databaseUuidSchema })),
  targetSchools: z.array(
    z.object({ id: databaseUuidSchema, name: z.string().min(1), slug: z.string().min(1) }),
  ),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});

export const recommendationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(500).optional(),
  includeLowPriority: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),
  includeIneligible: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  company: z.union([databaseUuidSchema, z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)]).optional(),
  roleFamily: roleFamilySchema.optional(),
});
export const recommendationFactorSchema = z.object({
  code: z.enum([
    "COMPANY_PREFERENCE",
    "ROLE_MATCH",
    "EARLY_CAREER_TRACK",
    "EXPERIENCE_LEVEL",
    "LOCATION_MATCH",
    "WORKPLACE_MODE",
    "FRESHNESS",
    "DEADLINE_URGENCY",
    "SOURCE_CONFIDENCE",
  ]),
  state: z.enum(["MATCH", "PARTIAL", "MISMATCH", "UNKNOWN", "NOT_APPLICABLE"]),
  earnedWeight: z.number().int().min(0).max(100),
  availableWeight: z.number().int().min(0).max(100),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});
export const opportunityRecommendationSchema = z.object({
  impressionId: databaseUuidSchema,
  opportunity: opportunitySchema,
  recommendationScore: z.number().int().min(0).max(100).nullable(),
  category: z.enum(["HIGH_PRIORITY", "MEDIUM_PRIORITY", "LOW_PRIORITY", "NOT_ELIGIBLE"]),
  eligibility: z.enum(["ELIGIBLE", "NOT_ELIGIBLE", "UNKNOWN"]),
  evidenceCoverage: z.enum(["HIGH", "MEDIUM", "LOW"]),
  availableWeight: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(16),
  potentialMismatches: z.array(z.string()).max(16),
  hardConstraints: z.array(z.string()).max(8),
  generatedAt: z.iso.datetime(),
  algorithmVersion: z.string().min(1),
});

export const opportunityDismissalSchema = z
  .object({
    reasonCode: z
      .enum(["NOT_INTERESTED", "ALREADY_APPLIED", "WRONG_ROLE", "WRONG_LOCATION", "OTHER"])
      .optional(),
  })
  .strict();
export const recommendationOpenSchema = z.object({ impressionId: databaseUuidSchema }).strict();

export const alertTypes = [
  "WATCHED_COMPANY_OPPORTUNITY_OPENED",
  "RECOMMENDED_OPPORTUNITY_OPENED",
  "APPLICATION_DEADLINE_APPROACHING",
  "OPENING_WINDOW_STARTED",
  "WATCHED_RECRUITER_DISCOVERED",
  "WATCHED_RECRUITER_ACTIVITY",
  "CAMPUS_EVENT_DISCOVERED",
  "INTERVIEW_INTELLIGENCE_UPDATED",
  "CALENDAR_ACTION_DUE",
] as const;
export const alertTypeSchema = z.enum(alertTypes);
export const alertListQuerySchema = z.object({
  state: z.enum(["UNREAD", "READ", "DISMISSED", "EXPIRED"]).optional(),
  type: alertTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
});
export const alertUpdateSchema = z.object({ read: z.boolean() }).strict();
export const alertsShownSchema = z
  .object({ alertIds: z.array(databaseUuidSchema).min(1).max(100) })
  .strict();
export const alertSchema = z.object({
  id: databaseUuidSchema,
  type: alertTypeSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  reasonCodes: z.array(z.string()).max(16),
  state: z.enum(["UNREAD", "READ", "DISMISSED", "EXPIRED"]),
  entity: z
    .object({ type: z.string().min(1), id: databaseUuidSchema, href: z.string().min(1) })
    .nullable(),
  reminderWindow: z.enum(["NONE", "SEVEN_DAY", "THREE_DAY", "ONE_DAY", "DUE"]),
  occurredAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  dismissedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
});
export const notificationPreferencesPatchSchema = z
  .object({
    inAppEnabled: z.boolean().optional(),
    alertTypes: z.record(alertTypeSchema, z.boolean()).optional(),
  })
  .strict();
export const notificationPreferencesSchema = z.object({
  channel: z.literal("IN_APP"),
  inAppEnabled: z.boolean(),
  alertTypes: z.record(alertTypeSchema, z.boolean()),
  settingsVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
export const dailyWorkflowItemSchema = z.object({
  id: databaseUuidSchema,
  source: z.enum(["ALERT", "CALENDAR", "APPLICATION"]),
  kind: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
  dueAt: z.iso.datetime().nullable(),
  urgency: z.enum(["OVERDUE", "TODAY", "UPCOMING"]),
  href: z.string().min(1),
  alertId: databaseUuidSchema.nullable(),
  completed: z.boolean(),
});

export const recruitingEventSchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  companyName: z.string().min(1),
  companySlug: z.string().min(1),
  jobId: databaseUuidSchema.nullable(),
  jobTitle: z.string().nullable(),
  eventType: eventTypeSchema,
  occurredAt: z.iso.datetime(),
  discoveredAt: z.iso.datetime(),
  sourceName: z.string().min(1),
  sourceUrl: z.url(),
  confidence: z.number().min(0).max(1),
  payload: z.record(z.string(), z.unknown()),
  isDemo: z.boolean(),
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const jobsQuerySchema = listQuerySchema.extend({
  query: z.string().trim().max(120).optional(),
  companyId: databaseUuidSchema.optional(),
  roleFamily: roleFamilySchema.optional(),
  earlyCareerOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeClosed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const eventsQuerySchema = listQuerySchema.extend({
  companyId: databaseUuidSchema.optional(),
  eventType: eventTypeSchema.optional(),
});

const githubRepositoryUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "github.com" &&
    !url.username &&
    !url.password &&
    (!url.port || url.port === "443") &&
    !url.search &&
    !url.hash &&
    url.pathname.split("/").filter(Boolean).length === 2
  );
}, "Must be an HTTPS github.com owner/repository URL");

const watchedPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.split("/").some((part) => part === "" || part === "." || part === ".."),
    "Watched paths must be safe relative repository paths",
  );

export const attachGithubRepositoryRequestSchema = z.object({
  repositoryUrl: githubRepositoryUrlSchema,
  repositoryType: githubRepositoryTypeSchema,
  parserType: githubParserTypeSchema.default("AUTO"),
  watchedPaths: z.array(watchedPathSchema).max(100).default([]),
  companyMappingRules: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const companyGithubRepositorySchema = z.object({
  id: databaseUuidSchema,
  owner: z.string().min(1),
  repositoryName: z.string().min(1),
  repositoryUrl: githubRepositoryUrlSchema,
  defaultBranch: z.string().nullable(),
  repositoryType: githubRepositoryTypeSchema,
  parserType: githubParserTypeSchema,
  enabled: z.boolean(),
  linkEnabled: z.boolean(),
  watchedPaths: z.array(z.string()),
  companyMappingRules: z.record(z.string(), z.unknown()),
  lastSeenCommitSha: z.string().nullable(),
  lastProcessedCommitSha: z.string().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  rateLimitRemaining: z.number().int().nonnegative().nullable(),
  rateLimitResetAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const interviewQuestionSummarySchema = z.object({
  id: databaseUuidSchema,
  canonicalTitle: z.string().min(1),
  normalizedTitle: z.string().min(1),
  leetcodeSlug: z.string().nullable(),
  leetcodeNumber: z.number().int().positive().nullable(),
  difficulty: questionDifficultySchema.nullable(),
  topics: z.array(z.string()),
  roleFamily: roleFamilySchema.nullable(),
  interviewStage: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  observationCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
});

export const interviewQuestionAnalyticsQuerySchema = listQuerySchema.extend({
  sort: z.enum(["most_observed", "recent"]).default("most_observed"),
});

export const countBucketSchema = z.object({
  key: z.string(),
  count: z.number().int().nonnegative(),
});

export const interviewQuestionAnalyticsSchema = z.object({
  items: z.array(interviewQuestionSummarySchema),
  aggregates: z.object({
    totalQuestions: z.number().int().nonnegative(),
    totalObservations: z.number().int().nonnegative(),
    totalSources: z.number().int().nonnegative(),
    topicCounts: z.array(countBucketSchema),
    difficultyCounts: z.array(countBucketSchema),
  }),
  ordering: z.enum(["OBSERVATION_COUNT_THEN_RECENCY", "RECENCY_THEN_OBSERVATION_COUNT"]),
});

export const interviewQuestionObservationSchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  companyName: z.string().min(1),
  companySlug: z.string().min(1),
  sourceId: databaseUuidSchema,
  sourceName: z.string().min(1),
  githubRepositoryId: databaseUuidSchema.nullable(),
  repositoryUrl: z.url().nullable(),
  sourceUrl: z.url(),
  sourcePath: z.string().min(1),
  commitSha: z.string().min(40),
  observedAt: z.iso.datetime(),
  rawTitle: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
});

export const interviewQuestionDetailSchema = z.object({
  question: z.object({
    id: databaseUuidSchema,
    canonicalTitle: z.string().min(1),
    normalizedTitle: z.string().min(1),
    leetcodeSlug: z.string().nullable(),
    leetcodeNumber: z.number().int().positive().nullable(),
    difficulty: questionDifficultySchema.nullable(),
    topics: z.array(z.string()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
  companies: z.array(
    z.object({
      companyId: databaseUuidSchema,
      companyName: z.string().min(1),
      companySlug: z.string().min(1),
      observationCount: z.number().int().nonnegative(),
      sourceCount: z.number().int().nonnegative(),
      firstObservedAt: z.iso.datetime(),
      lastObservedAt: z.iso.datetime(),
      confidence: z.number().min(0).max(1),
      roleFamily: roleFamilySchema.nullable(),
      interviewStage: z.string().nullable(),
    }),
  ),
  observations: z.array(interviewQuestionObservationSchema),
});

export const githubSyncRequestSchema = z.object({
  id: databaseUuidSchema,
  githubRepositoryId: databaseUuidSchema,
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  requestedAt: z.iso.datetime(),
});

export const publicObservationSourceSchema = z.object({
  id: databaseUuidSchema,
  name: z.string().min(1),
  type: z.string().min(1),
  classification: webSourceClassificationSchema,
  reliability: sourceReliabilityLevelSchema,
  reliabilityScore: z.number().min(0).max(1),
  url: z.url(),
  candidateId: databaseUuidSchema,
  canonicalUrl: z.url(),
  provider: z.string().min(1),
});

export const publicRecruitingObservationSchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  type: publicObservationTypeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  evidenceText: z.string().min(1),
  occurredAt: z.iso.datetime().nullable(),
  dateStart: z.iso.date().nullable(),
  dateEnd: z.iso.date().nullable(),
  datePrecision: datePrecisionSchema,
  dateCertainty: dateCertaintySchema,
  confidence: z.number().min(0).max(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  discoveredAt: z.iso.datetime(),
  lastVerifiedAt: z.iso.datetime(),
  linkedJobId: databaseUuidSchema.nullable(),
  linkedSchool: z
    .object({ id: databaseUuidSchema, name: z.string().min(1), slug: z.string().min(1) })
    .nullable(),
  source: publicObservationSourceSchema,
  metadata: z.record(z.string(), z.unknown()),
});

export const publicRecruitingClaimSchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  type: publicObservationTypeSchema,
  title: z.string().min(1),
  normalizedSubject: z.string().min(1),
  status: z.enum(["SINGLE_SOURCE", "SUPPORTED", "CONFLICTING"]),
  preferredObservationId: databaseUuidSchema.nullable(),
  lastVerifiedAt: z.iso.datetime(),
  confidence: z.number().min(0).max(1),
  supportingSourceCount: z.number().int().nonnegative(),
  observations: z.array(publicRecruitingObservationSchema),
  metadata: z.record(z.string(), z.unknown()),
});

export const webSearchQuerySchema = z.object({
  id: databaseUuidSchema,
  companyId: databaseUuidSchema,
  provider: z.string().min(1),
  templateKey: z.string().min(1),
  query: z.string().min(1),
  roleFamily: roleFamilySchema.nullable(),
  school: z
    .object({ id: databaseUuidSchema, name: z.string().min(1), slug: z.string().min(1) })
    .nullable(),
  graduationYear: z.number().int().min(2020).max(2040).nullable(),
  focus: z.enum(["INTERNSHIP", "NEW_GRAD", "BOTH"]).nullable(),
  budget: z.object({
    minimumIntervalSeconds: z.number().int().min(60),
    maxResults: z.number().int().min(1).max(100),
    maxFetches: z.number().int().min(0).max(100),
  }),
  status: z.enum(["READY", "RUNNING", "SUCCEEDED", "FAILED", "RATE_LIMITED", "DISABLED"]),
  lastRunAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastResultCount: z.number().int().nonnegative(),
  nextAllowedRunAt: z.iso.datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const publicWebWorkRequestSchema = z.object({
  id: databaseUuidSchema,
  workType: z.enum(["WEB_SEARCH", "WEB_FETCH", "WEB_PROCESS"]),
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  companyId: databaseUuidSchema,
  searchQueryId: databaseUuidSchema.nullable(),
  candidateId: databaseUuidSchema.nullable(),
  requestedAt: z.iso.datetime(),
});

export const webSearchRequestSchema = z
  .object({
    provider: z.enum(["static", "searxng"]).default("static"),
    roleFamily: roleFamilySchema.optional(),
    school: z.string().min(1).max(200).optional(),
    graduationYear: z.number().int().min(2020).max(2040).optional(),
    focus: z.enum(["INTERNSHIP", "NEW_GRAD", "BOTH"]).default("BOTH"),
    minimumIntervalSeconds: z.number().int().min(60).max(2_592_000).default(86_400),
    maxResults: z.number().int().min(1).max(100).default(10),
    maxFetches: z.number().int().min(0).max(100).default(5),
  })
  .refine((value) => value.maxFetches <= value.maxResults, {
    message: "maxFetches must not exceed maxResults",
    path: ["maxFetches"],
  });

export const publicObservationListQuerySchema = listQuerySchema.extend({
  type: publicObservationTypeSchema.optional(),
});

export const publicWebIntelligenceSchema = z.object({
  companyId: databaseUuidSchema,
  candidateCounts: z.object({
    total: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    relevant: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }),
  observationCount: z.number().int().nonnegative(),
  claimCounts: z.object({
    total: z.number().int().nonnegative(),
    conflicting: z.number().int().nonnegative(),
  }),
  latestObservations: z.array(publicRecruitingObservationSchema),
  latestClaims: z.array(publicRecruitingClaimSchema),
});

const publicHttpUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Must be a public HTTP(S) URL without credentials");

export const companyReferenceSchema = z.object({
  id: databaseUuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const schoolSummarySchema = z.object({
  id: databaseUuidSchema,
  canonicalName: z.string().min(1),
  slug: z.string().min(1),
  aliases: z.array(z.string()),
  domain: z.string().nullable(),
  city: z.string().nullable(),
  stateRegion: z.string().nullable(),
  country: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const freshnessSchema = z.object({
  status: freshnessStatusSchema,
  ageDays: z.number().int().nonnegative().nullable(),
  lastVerifiedAt: z.iso.datetime().nullable(),
});

export const recruiterEvidenceSchema = z.object({
  id: databaseUuidSchema,
  recruiterProfileId: databaseUuidSchema,
  source: z.object({
    id: databaseUuidSchema,
    name: z.string().min(1),
    type: z.string().min(1),
    reliabilityScore: z.number().min(0).max(1),
  }),
  recruitingObservationId: databaseUuidSchema.nullable(),
  sourceUrl: publicHttpUrlSchema,
  evidenceType: recruiterEvidenceTypeSchema,
  evidenceText: z.string().min(1),
  observedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  reliability: sourceReliabilityLevelSchema,
  confidence: z.number().min(0).max(1),
  school: schoolSummarySchema.nullable(),
  roleFamily: roleFamilySchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const recruiterSchoolFocusSchema = z.object({
  school: schoolSummarySchema,
  strength: relationshipStrengthSchema,
  reasons: z.array(z.string()),
  evidenceCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  status: relationshipStatusSchema,
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  freshness: freshnessSchema,
});

export const recruiterRoleFocusSchema = z.object({
  roleFamily: roleFamilySchema,
  strength: relationshipStrengthSchema,
  reasons: z.array(z.string()),
  evidenceCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  freshness: freshnessSchema,
});

export const recruiterSummarySchema = z.object({
  id: databaseUuidSchema,
  personId: databaseUuidSchema,
  name: z.string().min(1),
  company: companyReferenceSchema,
  title: z.string().min(1),
  categories: z.array(recruiterRoleCategorySchema).min(1),
  location: z.string().nullable(),
  publicProfileUrl: publicHttpUrlSchema.nullable(),
  status: recruiterProfileStatusSchema,
  confidence: z.number().min(0).max(1),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  lastVerifiedAt: z.iso.datetime(),
  freshness: freshnessSchema,
  schoolFocus: z.array(recruiterSchoolFocusSchema),
  roleFocus: z.array(recruiterRoleFocusSchema),
});

export const recruiterDetailSchema = recruiterSummarySchema.extend({
  evidence: z.array(recruiterEvidenceSchema),
});

export const campusRecruitingEventSchema = z.object({
  id: databaseUuidSchema,
  company: companyReferenceSchema,
  school: schoolSummarySchema.nullable(),
  title: z.string().min(1),
  eventType: campusRecruitingEventTypeSchema,
  description: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  dateStart: z.iso.date().nullable(),
  dateEnd: z.iso.date().nullable(),
  datePrecision: datePrecisionSchema,
  dateCertainty: dateCertaintySchema,
  location: z.string().nullable(),
  isVirtual: z.boolean(),
  registrationUrl: publicHttpUrlSchema.nullable(),
  source: z.object({
    id: databaseUuidSchema,
    name: z.string().min(1),
    type: z.string().min(1),
    reliabilityScore: z.number().min(0).max(1),
  }),
  sourceUrl: publicHttpUrlSchema,
  firstSeenAt: z.iso.datetime(),
  lastVerifiedAt: z.iso.datetime(),
  freshness: freshnessSchema,
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  evidenceCount: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()),
});

export const schoolCompanyIntelligenceSchema = z.object({
  company: companyReferenceSchema,
  recruiterCount: z.number().int().nonnegative(),
  campusEventCount: z.number().int().nonnegative(),
  lastObservedAt: z.iso.datetime(),
});

export const recruiterListQuerySchema = listQuerySchema.extend({
  category: recruiterRoleCategorySchema.optional(),
  roleFamily: roleFamilySchema.optional(),
  school: z.string().min(1).max(200).optional(),
  includeStale: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),
});

export const campusEventListQuerySchema = listQuerySchema.extend({
  eventType: campusRecruitingEventTypeSchema.optional(),
  includePast: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(true),
});

export const schoolListQuerySchema = listQuerySchema.extend({
  query: z.string().max(200).optional(),
});

export const createRecruiterRequestSchema = z.object({
  name: z.string().min(2).max(200),
  title: z.string().min(2).max(300),
  location: z.string().max(300).optional(),
  publicProfileUrl: publicHttpUrlSchema.optional(),
  sourceUrl: publicHttpUrlSchema,
  evidenceText: z.string().min(1).max(10_000),
  observedAt: z.iso.datetime().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  reliability: sourceReliabilityLevelSchema.default("UNKNOWN"),
  schoolIdentifiers: z.array(z.string().min(1).max(200)).max(20).default([]),
  roleFamilies: z.array(roleFamilySchema).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const createRecruiterEvidenceRequestSchema = z.object({
  sourceUrl: publicHttpUrlSchema,
  evidenceType: recruiterEvidenceTypeSchema,
  evidenceText: z.string().min(1).max(10_000),
  observedAt: z.iso.datetime().optional(),
  publishedAt: z.iso.datetime().optional(),
  reliability: sourceReliabilityLevelSchema.default("UNKNOWN"),
  confidence: z.number().min(0).max(1).default(0.5),
  schoolIdentifier: z.string().min(1).max(200).optional(),
  roleFamily: roleFamilySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const recruitingDateTypes = [
  "APPLICATION_OPEN",
  "APPLICATION_DEADLINE",
  "EXPECTED_OPENING_WINDOW",
  "CAREER_FAIR",
  "CAMPUS_EVENT",
  "INFO_SESSION",
  "INTERVIEW_EVENT",
  "OTHER",
] as const;
export const calendarDateCertainties = [
  "CONFIRMED",
  "ESTIMATED",
  "HISTORICAL",
  "CLAIMED",
  "USER_CREATED",
] as const;
export const calendarItemTypes = [
  "RECRUITING_DATE",
  "APPLICATION_TASK",
  "LEETCODE",
  "INTERVIEW_PREP",
  "SYSTEM_DESIGN",
  "BEHAVIORAL_PREP",
  "RECRUITER_OUTREACH",
  "RESUME_WORK",
  "CAREER_EVENT",
  "OA",
  "CUSTOM",
] as const;
export const calendarItemStatuses = ["TODO", "DONE", "SKIPPED", "CANCELLED"] as const;
export const calendarItemSources = ["RECRUITING_INTELLIGENCE", "USER", "APPLICATION_PLAN"] as const;
export const applicationPlanStatuses = ["DRAFT", "ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export const calendarConnectionStatuses = [
  "CONNECTED",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
] as const;
export const calendarSyncStatuses = ["PENDING", "SYNCED", "UNCHANGED", "DELETED", "ERROR"] as const;

export const recruitingDateTypeSchema = z.enum(recruitingDateTypes);
export const calendarDateCertaintySchema = z.enum(calendarDateCertainties);
export const calendarItemTypeSchema = z.enum(calendarItemTypes);
export const calendarItemStatusSchema = z.enum(calendarItemStatuses);
export const calendarItemSourceSchema = z.enum(calendarItemSources);
export const applicationPlanStatusSchema = z.enum(applicationPlanStatuses);
export const calendarConnectionStatusSchema = z.enum(calendarConnectionStatuses);
export const calendarSyncStatusSchema = z.enum(calendarSyncStatuses);

const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Timezone must be a valid IANA time zone");

const calendarCompanySchema = z.object({
  id: databaseUuidSchema,
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const recruitingDateSchema = z.object({
  id: databaseUuidSchema,
  company: calendarCompanySchema.nullable(),
  jobId: databaseUuidSchema.nullable(),
  opportunityId: databaseUuidSchema.nullable(),
  schoolId: databaseUuidSchema.nullable(),
  recruitingEventId: databaseUuidSchema.nullable(),
  campusRecruitingEventId: databaseUuidSchema.nullable(),
  publicRecruitingObservationId: databaseUuidSchema.nullable(),
  publicRecruitingClaimId: databaseUuidSchema.nullable(),
  type: recruitingDateTypeSchema,
  title: z.string().min(1),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  allDay: z.boolean(),
  timezone: timezoneSchema,
  dateCertainty: calendarDateCertaintySchema,
  datePrecision: datePrecisionSchema,
  confidence: z.number().min(0).max(1).nullable(),
  source: z.object({
    kind: z.enum([
      "PUBLIC_OBSERVATION",
      "PUBLIC_CLAIM",
      "CAMPUS_EVENT",
      "RECRUITING_EVENT",
      "USER",
    ]),
    name: z.string().nullable(),
    url: z.url().nullable(),
    provenance: z.record(z.string(), z.unknown()),
  }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const calendarItemSchema = z.object({
  id: databaseUuidSchema,
  company: calendarCompanySchema.nullable(),
  jobId: databaseUuidSchema.nullable(),
  opportunityId: databaseUuidSchema.nullable(),
  resolvedOpportunity: z
    .object({ id: databaseUuidSchema, title: z.string().min(1), status: opportunityStatusSchema })
    .nullable(),
  resolutionMismatch: z.boolean(),
  recruitingDateId: databaseUuidSchema.nullable(),
  applicationPlanId: databaseUuidSchema.nullable(),
  type: calendarItemTypeSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  allDay: z.boolean(),
  timezone: timezoneSchema,
  status: calendarItemStatusSchema,
  source: calendarItemSourceSchema,
  syncEnabled: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  recruitingDate: recruitingDateSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const calendarTimingSchema = z
  .object({
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
    allDay: z.boolean().default(false),
    timezone: timezoneSchema,
  })
  .superRefine((value, context) => {
    if (value.allDay && !value.startsOn) {
      context.addIssue({
        code: "custom",
        path: ["startsOn"],
        message: "All-day items need startsOn",
      });
    }
    if (!value.allDay && !value.startsAt) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Timed items need startsAt",
      });
    }
    if (value.endsOn && !value.startsOn) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: "endsOn requires startsOn" });
    }
  });

export const createCalendarItemRequestSchema = calendarTimingSchema.and(
  z.object({
    companyId: databaseUuidSchema.optional(),
    jobId: databaseUuidSchema.optional(),
    opportunityId: databaseUuidSchema.optional(),
    type: calendarItemTypeSchema.exclude(["RECRUITING_DATE"]),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5_000).optional(),
    status: calendarItemStatusSchema.default("TODO"),
    syncEnabled: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }),
);

export const updateCalendarItemRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    startsOn: z.iso.date().nullable().optional(),
    endsOn: z.iso.date().nullable().optional(),
    allDay: z.boolean().optional(),
    timezone: timezoneSchema.optional(),
    status: calendarItemStatusSchema.optional(),
    syncEnabled: z.boolean().optional(),
    opportunityId: databaseUuidSchema.nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const calendarBoundarySchema = z.union([z.iso.datetime(), z.iso.date()]);
export const calendarQuerySchema = z.object({
  start: calendarBoundarySchema.optional(),
  end: calendarBoundarySchema.optional(),
  type: calendarItemTypeSchema.optional(),
  company: z.string().min(1).max(200).optional(),
  status: calendarItemStatusSchema.optional(),
});

export const applicationPlanTemplateStepSchema = z.object({
  relativeDayOffset: z.number().int().min(-365).max(365),
  taskType: calendarItemTypeSchema.exclude(["RECRUITING_DATE"]),
  title: z.string().trim().min(1).max(200),
  generatedReason: z.string().trim().min(1).max(1_000),
});

export const createApplicationPlanRequestSchema = z.object({
  companyId: databaseUuidSchema,
  jobId: databaseUuidSchema.optional(),
  opportunityId: databaseUuidSchema.optional(),
  recruitingDateId: databaseUuidSchema.optional(),
  title: z.string().trim().min(1).max(300),
  targetDate: z.iso.date(),
  timezone: timezoneSchema,
  template: z.array(applicationPlanTemplateStepSchema).min(1).max(30).optional(),
});

export const updateApplicationPlanRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    targetDate: z.iso.date().optional(),
    timezone: timezoneSchema.optional(),
    status: applicationPlanStatusSchema.optional(),
    opportunityId: databaseUuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const activateApplicationPlanRequestSchema = z.object({
  sync: z.boolean().default(false),
});

export const applicationPlanTaskSchema = z.object({
  id: databaseUuidSchema,
  sequence: z.number().int().nonnegative(),
  relativeDayOffset: z.number().int().nullable(),
  taskType: calendarItemTypeSchema,
  generatedReason: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  calendarItem: calendarItemSchema,
});

export const applicationPlanSchema = z.object({
  id: databaseUuidSchema,
  company: calendarCompanySchema,
  jobId: databaseUuidSchema.nullable(),
  opportunityId: databaseUuidSchema.nullable(),
  resolvedOpportunity: z
    .object({ id: databaseUuidSchema, title: z.string().min(1), status: opportunityStatusSchema })
    .nullable(),
  resolutionMismatch: z.boolean(),
  recruitingDateId: databaseUuidSchema.nullable(),
  title: z.string().min(1),
  targetDate: z.iso.date(),
  timezone: timezoneSchema,
  status: applicationPlanStatusSchema,
  templateVersion: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()),
  activatedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  tasks: z.array(applicationPlanTaskSchema),
});

export const applicationPlanQuerySchema = z.object({
  company: z.string().min(1).max(200).optional(),
  status: applicationPlanStatusSchema.optional(),
});

export const calendarSyncPreferencesSchema = z.object({
  syncRecruitingDates: z.boolean(),
  syncApplicationTasks: z.boolean(),
  syncLeetcode: z.boolean(),
  syncInterviewPrep: z.boolean(),
  syncCareerEvents: z.boolean(),
});

export const googleCalendarStatusSchema = z.object({
  provider: z.literal("GOOGLE"),
  status: calendarConnectionStatusSchema,
  accountEmail: z.string().email().nullable(),
  selectedCalendarId: z.string().min(1),
  scopes: z.array(z.string()),
  preferences: calendarSyncPreferencesSchema,
  lastSyncAt: z.iso.datetime().nullable(),
  lastSyncStatus: calendarSyncStatusSchema.nullable(),
  reconnectRequired: z.boolean(),
  errorCode: z.string().nullable(),
});

export const updateGoogleCalendarRequestSchema = z
  .object({
    selectedCalendarId: z.string().trim().min(1).max(1_000).optional(),
    preferences: calendarSyncPreferencesSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const googleCalendarAuthorizeSchema = z.object({
  authorizeUrl: z.url(),
  expiresAt: z.iso.datetime(),
});

export const googleCalendarOptionSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  primary: z.boolean(),
  timezone: timezoneSchema.nullable(),
  accessRole: z.literal("owner"),
});

export const calendarSyncRequestSchema = z.object({
  id: databaseUuidSchema,
  connectionId: databaseUuidSchema,
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
  attemptCount: z.number().int().nonnegative(),
  requestedAt: z.iso.datetime(),
});

export type Company = z.infer<typeof companySchema>;
export type Job = z.infer<typeof jobSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;
export type OpportunitySourcePosting = z.infer<typeof opportunitySourcePostingSchema>;
export type RecruitingEvent = z.infer<typeof recruitingEventSchema>;
export type RoleFamily = z.infer<typeof roleFamilySchema>;
export type AttachGithubRepositoryRequest = z.infer<typeof attachGithubRepositoryRequestSchema>;
export type CompanyGithubRepository = z.infer<typeof companyGithubRepositorySchema>;
export type InterviewQuestionSummary = z.infer<typeof interviewQuestionSummarySchema>;
export type InterviewQuestionAnalytics = z.infer<typeof interviewQuestionAnalyticsSchema>;
export type InterviewQuestionDetail = z.infer<typeof interviewQuestionDetailSchema>;
export type GithubSyncRequest = z.infer<typeof githubSyncRequestSchema>;
export type PublicRecruitingObservation = z.infer<typeof publicRecruitingObservationSchema>;
export type PublicRecruitingClaim = z.infer<typeof publicRecruitingClaimSchema>;
export type WebSearchQuery = z.infer<typeof webSearchQuerySchema>;
export type PublicWebWorkRequest = z.infer<typeof publicWebWorkRequestSchema>;
export type WebSearchRequest = z.infer<typeof webSearchRequestSchema>;
export type PublicWebIntelligence = z.infer<typeof publicWebIntelligenceSchema>;
export type SchoolSummary = z.infer<typeof schoolSummarySchema>;
export type RecruiterEvidence = z.infer<typeof recruiterEvidenceSchema>;
export type RecruiterSummary = z.infer<typeof recruiterSummarySchema>;
export type RecruiterDetail = z.infer<typeof recruiterDetailSchema>;
export type CampusRecruitingEvent = z.infer<typeof campusRecruitingEventSchema>;
export type CreateRecruiterRequest = z.infer<typeof createRecruiterRequestSchema>;
export type CreateRecruiterEvidenceRequest = z.infer<typeof createRecruiterEvidenceRequestSchema>;
export type RecruitingDate = z.infer<typeof recruitingDateSchema>;
export type CalendarItem = z.infer<typeof calendarItemSchema>;
export type CreateCalendarItemRequest = z.infer<typeof createCalendarItemRequestSchema>;
export type UpdateCalendarItemRequest = z.infer<typeof updateCalendarItemRequestSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type ApplicationPlan = z.infer<typeof applicationPlanSchema>;
export type CreateApplicationPlanRequest = z.infer<typeof createApplicationPlanRequestSchema>;
export type UpdateApplicationPlanRequest = z.infer<typeof updateApplicationPlanRequestSchema>;
export type GoogleCalendarStatus = z.infer<typeof googleCalendarStatusSchema>;
export type UpdateGoogleCalendarRequest = z.infer<typeof updateGoogleCalendarRequestSchema>;
export type CalendarSyncRequest = z.infer<typeof calendarSyncRequestSchema>;
export type GoogleCalendarOption = z.infer<typeof googleCalendarOptionSchema>;
