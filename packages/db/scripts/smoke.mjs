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
      (select count(*) from public.schools)::int as schools,
      (select count(*) from public.people)::int as people,
      (select count(*) from public.recruiter_profiles)::int as recruiter_profiles,
      (select count(*) from public.recruiter_evidence)::int as recruiter_evidence,
      (select count(*) from public.recruiter_school_relationships)::int
        as recruiter_school_relationships,
      (select count(*) from public.recruiter_role_focus)::int as recruiter_role_focus,
      (select count(*) from public.campus_recruiting_events)::int as campus_recruiting_events,
      (select count(*) from public.unresolved_recruiter_observations)::int
        as unresolved_recruiter_observations,
      (select count(*) from public.recruiting_dates)::int as recruiting_dates,
      (select count(*) from public.calendar_items)::int as calendar_items,
      (select count(*) from public.application_plans)::int as application_plans,
      (select count(*) from public.calendar_connections)::int as calendar_connections,
      (select count(*) from public.calendar_external_events)::int as calendar_external_events,
      (select count(*) from public.calendar_sync_runs)::int as calendar_sync_runs,
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
    "school_aliases_normalized_alias_key",
    "recruiter_profiles_person_id_company_id_key",
    "recruiter_evidence_fingerprint_key",
    "campus_recruiting_events_fingerprint_key",
    "unresolved_recruiter_observations_fingerprint_key",
    "recruiting_dates_source_fingerprint_key",
    "application_plans_owner_id_plan_fingerprint_key",
    "calendar_external_events_calendar_item_id_calendar_connecti_key",
    "calendar_external_events_calendar_connection_id_external_ca_key",
  ];
  const constraints = await sql`
    select conname
    from pg_constraint
    where connamespace = 'public'::regnamespace
      and conname in ${sql(requiredConstraints)}
  `;
  const requiredIndexes = [
    "calendar_items_recruiting_date_owner_unique_idx",
    "calendar_sync_requests_active_unique_idx",
  ];
  const indexes = await sql`
    select indexname from pg_indexes
    where schemaname = 'public' and indexname in ${sql(requiredIndexes)}
  `;

  if (!counts || counts.migrations < 5) {
    throw new Error("no applied RecruitIntel migrations were found");
  }
  if (counts.companies < 1 || counts.sources < 1 || counts.schools < 1) {
    throw new Error("development seed is missing companies, sources, or schools");
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
  if (indexes.length !== requiredIndexes.length) {
    throw new Error("calendar partial idempotency indexes are missing");
  }

  console.log(JSON.stringify({ status: "ok", ...counts }));
} finally {
  await sql.end();
}
