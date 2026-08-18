import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const [counts] = await sql`
    select
      (select count(*) from public.companies)::int as companies,
      (select count(*) from public.sources)::int as sources,
      (select count(*) from public.jobs)::int as jobs,
      (select count(*) from public.github_repositories)::int as github_repositories,
      (select count(*) from public.interview_questions)::int as interview_questions,
      (select count(*) from public.interview_question_observations)::int
        as interview_question_observations,
      (select count(*) from public.company_interview_question_analytics)::int
        as question_analytics_rows,
      (select count(*) from public.public_web_candidates)::int as public_web_candidates,
      (select count(*) from public.public_recruiting_observations)::int
        as public_recruiting_observations,
      (select count(*) from public.public_recruiting_claims)::int as public_recruiting_claims,
      (select count(*) from public.recruiting_events)::int as events,
      (select count(*) from public.schema_migrations)::int as migrations
  `;

  const requiredConstraints = [
    "jobs_source_id_external_id_key",
    "recruiting_events_fingerprint_key",
    "github_repositories_owner_repository_name_key",
    "interview_questions_normalized_title_key",
    "interview_question_observations_fingerprint_key",
    "unresolved_github_observations_fingerprint_key",
    "public_web_candidates_company_id_canonical_url_key",
    "public_recruiting_observations_fingerprint_key",
    "public_recruiting_claims_fingerprint_key",
  ];
  const constraints = await sql`
    select conname
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname in ${sql(requiredConstraints)}
  `;

  if (!counts || counts.migrations < 3) {
    throw new Error("no applied RecruitIntel migrations were found");
  }
  if (counts.companies < 1 || counts.sources < 1) {
    throw new Error("development seed is missing companies or sources");
  }
  if (
    counts.github_repositories < 1 ||
    counts.interview_questions < 1 ||
    counts.interview_question_observations < 1 ||
    counts.question_analytics_rows < 1
  ) {
    throw new Error("Milestone 2 GitHub/question seed or analytics projection is missing");
  }
  if (constraints.length !== requiredConstraints.length) {
    throw new Error("database deduplication constraints are missing");
  }

  console.log(JSON.stringify({ status: "ok", ...counts }));
} finally {
  await sql.end();
}
