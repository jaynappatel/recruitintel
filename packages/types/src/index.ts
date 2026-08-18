import { z } from "zod";

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

export const githubRepositoryTypeSchema = z.enum(githubRepositoryTypes);
export const githubParserTypeSchema = z.enum(githubParserTypes);
export const questionDifficultySchema = z.enum(questionDifficulties);
export const publicObservationTypeSchema = z.enum(publicObservationTypes);
export const webSourceClassificationSchema = z.enum(webSourceClassifications);
export const sourceReliabilityLevelSchema = z.enum(sourceReliabilityLevels);
export const relevanceStatusSchema = z.enum(relevanceStatuses);
export const datePrecisionSchema = z.enum(datePrecisions);
export const dateCertaintySchema = z.enum(dateCertainties);
export const databaseUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

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
    provider: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .default("static"),
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
