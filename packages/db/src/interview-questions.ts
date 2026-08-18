import { getDatabase } from "./index";

export interface InterviewQuestionListOptions {
  limit?: number;
  offset?: number;
  sort?: "most_observed" | "recent";
}

export interface CountBucket {
  key: string;
  count: number;
}

export interface InterviewQuestionSummaryRecord {
  id: string;
  canonicalTitle: string;
  normalizedTitle: string;
  leetcodeSlug: string | null;
  leetcodeNumber: number | null;
  difficulty: string | null;
  topics: string[];
  roleFamily: string | null;
  interviewStage: string | null;
  confidence: number;
  observationCount: number;
  sourceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface InterviewQuestionAnalyticsRecord {
  items: InterviewQuestionSummaryRecord[];
  aggregates: {
    totalQuestions: number;
    totalObservations: number;
    totalSources: number;
    topicCounts: CountBucket[];
    difficultyCounts: CountBucket[];
  };
  ordering: "OBSERVATION_COUNT_THEN_RECENCY" | "RECENCY_THEN_OBSERVATION_COUNT";
}

type Row = Record<string, unknown>;

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected a database string");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  if (value === null || value === undefined) return 0;
  throw new TypeError("Expected a database number");
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new TypeError("Expected a database timestamp");
}

function mapSummary(row: Row): InterviewQuestionSummaryRecord {
  return {
    id: stringValue(row.interview_question_id),
    canonicalTitle: stringValue(row.canonical_title),
    normalizedTitle: stringValue(row.normalized_title),
    leetcodeSlug: nullableString(row.leetcode_slug),
    leetcodeNumber: nullableNumber(row.leetcode_number),
    difficulty: nullableString(row.difficulty),
    topics: Array.isArray(row.topics) ? row.topics.map(stringValue) : [],
    roleFamily: nullableString(row.role_family),
    interviewStage: nullableString(row.interview_stage),
    confidence: numberValue(row.confidence),
    observationCount: numberValue(row.observation_count),
    sourceCount: numberValue(row.source_count),
    firstObservedAt: iso(row.first_observed_at),
    lastObservedAt: iso(row.last_observed_at),
  };
}

export async function getCompanyInterviewQuestionAnalytics(
  companyId: string,
  options: InterviewQuestionListOptions = {},
): Promise<InterviewQuestionAnalyticsRecord> {
  const sql = getDatabase();
  const limit = options.limit ?? 25;
  const offset = options.offset ?? 0;
  const sort = options.sort ?? "most_observed";
  const order =
    sort === "recent"
      ? "last_observed_at desc, observation_count desc, interview_question_id"
      : "observation_count desc, last_observed_at desc, interview_question_id";
  const rows = await sql.unsafe(
    `select * from public.company_interview_question_analytics
     where company_id = $1::uuid
     order by ${order}
     limit $2 offset $3`,
    [companyId, limit, offset],
  );
  const [totals] = await sql`
    select
      count(distinct ciq.interview_question_id)::int as total_questions,
      count(iqo.id)::int as total_observations,
      count(distinct iqo.source_id)::int as total_sources
    from public.company_interview_questions ciq
    left join public.interview_question_observations iqo
      on iqo.company_interview_question_id = ciq.id
    where ciq.company_id = ${companyId}::uuid
  `;
  const topicRows = await sql`
    select topic as key, count(*)::int as count
    from public.company_interview_questions ciq
    join public.interview_questions iq on iq.id = ciq.interview_question_id
    cross join lateral unnest(iq.topics) as topic
    where ciq.company_id = ${companyId}::uuid
    group by topic order by count(*) desc, topic
  `;
  const difficultyRows = await sql`
    select iq.difficulty::text as key, count(*)::int as count
    from public.company_interview_questions ciq
    join public.interview_questions iq on iq.id = ciq.interview_question_id
    where ciq.company_id = ${companyId}::uuid and iq.difficulty is not null
    group by iq.difficulty order by count(*) desc, iq.difficulty
  `;
  return {
    items: rows.map(mapSummary),
    aggregates: {
      totalQuestions: numberValue(totals?.total_questions),
      totalObservations: numberValue(totals?.total_observations),
      totalSources: numberValue(totals?.total_sources),
      topicCounts: topicRows.map((row) => ({
        key: stringValue(row.key),
        count: numberValue(row.count),
      })),
      difficultyCounts: difficultyRows.map((row) => ({
        key: stringValue(row.key),
        count: numberValue(row.count),
      })),
    },
    ordering:
      sort === "recent" ? "RECENCY_THEN_OBSERVATION_COUNT" : "OBSERVATION_COUNT_THEN_RECENCY",
  };
}

export async function getInterviewQuestionDetail(questionId: string) {
  const sql = getDatabase();
  const [question] = await sql`
    select id, canonical_title, normalized_title, leetcode_slug, leetcode_number,
           difficulty, topics, created_at, updated_at
    from public.interview_questions where id = ${questionId}::uuid
  `;
  if (!question) return null;
  const companies = await sql`
    select a.company_id, c.canonical_name as company_name, c.slug as company_slug,
           a.observation_count, a.source_count, a.first_observed_at,
           a.last_observed_at, a.confidence, a.role_family, a.interview_stage
    from public.company_interview_question_analytics a
    join public.companies c on c.id = a.company_id
    where a.interview_question_id = ${questionId}::uuid
    order by a.observation_count desc, a.last_observed_at desc
  `;
  const observations = await sql`
    select iqo.id, ciq.company_id, c.canonical_name as company_name,
           c.slug as company_slug, iqo.source_id, s.name as source_name,
           iqo.github_repository_id, gr.repository_url, iqo.source_url,
           iqo.source_path, iqo.commit_sha, iqo.observed_at, iqo.raw_title, iqo.metadata
    from public.interview_question_observations iqo
    join public.company_interview_questions ciq on ciq.id = iqo.company_interview_question_id
    join public.companies c on c.id = ciq.company_id
    join public.sources s on s.id = iqo.source_id
    left join public.github_repositories gr on gr.id = iqo.github_repository_id
    where ciq.interview_question_id = ${questionId}::uuid
    order by iqo.observed_at desc, iqo.id desc
    limit 200
  `;
  return {
    question: {
      id: stringValue(question.id),
      canonicalTitle: stringValue(question.canonical_title),
      normalizedTitle: stringValue(question.normalized_title),
      leetcodeSlug: nullableString(question.leetcode_slug),
      leetcodeNumber: nullableNumber(question.leetcode_number),
      difficulty: nullableString(question.difficulty),
      topics: Array.isArray(question.topics) ? question.topics.map(stringValue) : [],
      createdAt: iso(question.created_at),
      updatedAt: iso(question.updated_at),
    },
    companies: companies.map((row) => ({
      companyId: stringValue(row.company_id),
      companyName: stringValue(row.company_name),
      companySlug: stringValue(row.company_slug),
      observationCount: numberValue(row.observation_count),
      sourceCount: numberValue(row.source_count),
      firstObservedAt: iso(row.first_observed_at),
      lastObservedAt: iso(row.last_observed_at),
      confidence: numberValue(row.confidence),
      roleFamily: nullableString(row.role_family),
      interviewStage: nullableString(row.interview_stage),
    })),
    observations: observations.map((row) => ({
      id: stringValue(row.id),
      companyId: stringValue(row.company_id),
      companyName: stringValue(row.company_name),
      companySlug: stringValue(row.company_slug),
      sourceId: stringValue(row.source_id),
      sourceName: stringValue(row.source_name),
      githubRepositoryId: nullableString(row.github_repository_id),
      repositoryUrl: nullableString(row.repository_url),
      sourceUrl: stringValue(row.source_url),
      sourcePath: stringValue(row.source_path),
      commitSha: stringValue(row.commit_sha),
      observedAt: iso(row.observed_at),
      rawTitle: stringValue(row.raw_title),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })),
  };
}
