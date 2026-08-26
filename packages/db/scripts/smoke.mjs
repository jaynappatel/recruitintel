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
      (select count(*) from public.job_opportunities)::int as job_opportunities,
      (select count(*) from public.job_opportunity_postings
        where valid_to is null)::int as active_opportunity_memberships,
      (
        select count(*) from public.jobs job
        left join public.job_opportunity_postings membership
          on membership.job_id = job.id and membership.valid_to is null
        where membership.id is null
      )::int as opportunity_membership_orphans,
      (select count(*) from public.jobs
        where source_content_hash is null or derivation_hash is null)::int as missing_job_hash_domains,
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
      (select count(*) from public.users)::int as users,
      (select count(*) from public.user_profiles)::int as user_profiles,
      (select count(*) from public.service_principals)::int as service_principals,
      (select count(*) from public.audit_events)::int as audit_events,
      (select count(*) from public.product_events)::int as product_events,
      (select count(*) from public.privacy_requests)::int as privacy_requests,
      (select count(*) from public.source_policies)::int as source_policies,
      (select count(*) from public.schedules)::int as schedules,
      (select count(*) from public.work_items)::int as work_items,
      (select count(*) from public.work_attempts)::int as work_attempts,
      (select count(*) from public.worker_role_bindings)::int as worker_role_bindings,
      (select count(*) from public.search_provider_budgets)::int as search_provider_budgets,
      (select count(*) from public.sources
        where discovery_fingerprint is not null)::int as source_endpoints,
      (select coalesce(sum(paid_spend_micros), 0)::bigint
        from public.search_provider_usage_daily)::text as search_paid_spend_micros,
      (
        select count(*) from public.calendar_items item
        left join public.users app_user on app_user.id = item.user_id
        where app_user.id is null
      )::int as private_owner_orphans,
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
    "user_identities_no_persisted_credentials",
    "calendar_items_plan_owner_fkey",
    "calendar_external_events_connection_owner_fkey",
    "calendar_sync_runs_request_owner_fkey",
    "public_web_search_queries_provider_policy_fkey",
    "public_web_search_queries_source_policy_fkey",
    "source_policies_provider_id_key",
    "sources_id_source_policy_id_key",
    "work_items_no_search_api_key_diagnostics",
    "work_attempts_no_search_api_key_diagnostics",
    "dead_letters_no_search_api_key_diagnostics",
    "public_web_runs_no_raw_search_payload",
    "sources_discovery_fingerprint_key",
    "sources_discovery_fingerprint_check",
    "sources_discovery_confidence_check",
    "schedules_check",
    "jobs_id_company_unique",
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
    "work_items_exclusive_active_idx",
    "work_items_eligible_idx",
    "work_items_lease_expiry_idx",
    "source_incidents_one_open_idx",
    "public_web_runs_request_idx",
    "public_web_search_queries_provider_policy_idx",
    "search_provider_usage_month_idx",
    "sources_company_discovery_idx",
    "schedules_public_web_candidate_idx",
    "job_opportunities_company_active_idx",
    "job_opportunity_postings_one_active_job_idx",
    "job_identity_keys_match_idx",
  ];
  const indexes = await sql`
    select indexname from pg_indexes
    where schemaname = 'public' and indexname in ${sql(requiredIndexes)}
  `;

  if (!counts || counts.migrations < 10) {
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
  if (counts.users < 1 || counts.user_profiles < 1 || counts.private_owner_orphans !== 0) {
    throw new Error("Milestone 6 user/profile seed or private ownership integrity is missing");
  }
  if (counts.source_policies < 1 || counts.schedules < 1 || counts.worker_role_bindings < 1) {
    throw new Error("Milestone 7 policy, schedule, or worker binding seed is missing");
  }
  if (counts.search_provider_budgets < 1) {
    throw new Error("Gate 7.1A search-provider budgets are missing");
  }
  if (counts.source_endpoints !== counts.sources) {
    throw new Error("Gate 7.1A.1 source graph provenance is incomplete");
  }
  if (Number(counts.search_paid_spend_micros) !== 0) {
    throw new Error("development zero-cost mode recorded paid search spend");
  }
  if (
    counts.job_opportunities < counts.jobs ||
    counts.active_opportunity_memberships !== counts.jobs ||
    counts.opportunity_membership_orphans !== 0 ||
    counts.missing_job_hash_domains !== 0
  ) {
    throw new Error("Milestone 8 singleton opportunity or hash-domain integrity is missing");
  }

  console.log(JSON.stringify({ status: "ok", ...counts }));
} finally {
  await sql.end();
}
