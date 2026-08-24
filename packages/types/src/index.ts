import { z } from "zod";

export const clientProductEventTypes = [
  "JOB_VIEWED",
  "RECRUITER_VIEWED",
  "INTERVIEW_INTEL_VIEWED",
] as const;
export const clientProductEventSchema = z
  .object({
    eventType: z.enum(clientProductEventTypes),
    entityId: z.uuid(),
  })
  .strict();
export type ClientProductEvent = z.infer<typeof clientProductEventSchema>;

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
    provider: z.literal("static").default("static"),
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
