-- Deterministic development data. These are UI examples, not claims that the jobs are open.

insert into public.companies (
  id, canonical_name, slug, website, careers_url, description, industry, ats_type, ats_identifier
) values
  ('10000000-0000-0000-0000-000000000001', 'Stripe', 'stripe', 'https://stripe.com', 'https://stripe.com/jobs', 'Financial infrastructure for the internet.', 'Financial Technology', 'GREENHOUSE', 'stripe'),
  ('10000000-0000-0000-0000-000000000002', 'Cloudflare', 'cloudflare', 'https://www.cloudflare.com', 'https://www.cloudflare.com/careers/', 'Connectivity cloud and internet security company.', 'Cloud Infrastructure', 'GREENHOUSE', 'cloudflare'),
  ('10000000-0000-0000-0000-000000000003', 'Figma', 'figma', 'https://www.figma.com', 'https://www.figma.com/careers/', 'Collaborative product design and development platform.', 'Design Software', 'GREENHOUSE', 'figma'),
  ('10000000-0000-0000-0000-000000000004', 'Netflix', 'netflix', 'https://www.netflix.com', 'https://jobs.netflix.com', 'Global entertainment service and technology company.', 'Entertainment Technology', 'LEVER', 'netflix'),
  ('10000000-0000-0000-0000-000000000005', 'Datadog', 'datadog', 'https://www.datadoghq.com', 'https://careers.datadoghq.com', 'Monitoring and security platform for cloud applications.', 'Cloud Software', 'GREENHOUSE', 'datadog')
on conflict (id) do update set
  canonical_name = excluded.canonical_name,
  slug = excluded.slug,
  website = excluded.website,
  careers_url = excluded.careers_url,
  description = excluded.description,
  industry = excluded.industry,
  ats_type = excluded.ats_type,
  ats_identifier = excluded.ats_identifier;

insert into public.company_aliases (id, company_id, alias, normalized_alias) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Stripe, Inc.', 'stripe'),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Cloudflare, Inc.', 'cloudflare'),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Figma, Inc.', 'figma'),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'Netflix, Inc.', 'netflix'),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'Datadog, Inc.', 'datadog')
on conflict (normalized_alias) do update set alias = excluded.alias, company_id = excluded.company_id;

insert into public.company_domains (id, company_id, domain) values
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'stripe.com'),
  ('12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'cloudflare.com'),
  ('12000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'figma.com'),
  ('12000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'netflix.com'),
  ('12000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'datadoghq.com')
on conflict (domain) do update set company_id = excluded.company_id;

insert into public.schools (
  id, canonical_name, slug, website, domains, aliases, city, state_region, country
) values (
  '13000000-0000-0000-0000-000000000001',
  'University of Texas at Austin',
  'ut-austin',
  'https://www.utexas.edu',
  '{utexas.edu}',
  '{"UT Austin","The University of Texas at Austin"}',
  'Austin',
  'Texas',
  'US'
)
on conflict (canonical_name) do update set
  slug = excluded.slug,
  website = excluded.website,
  domains = excluded.domains,
  aliases = excluded.aliases,
  city = excluded.city,
  state_region = excluded.state_region,
  country = excluded.country;

insert into public.school_aliases (school_id, alias, normalized_alias) values
  ((select id from public.schools where canonical_name = 'University of Texas at Austin'),
   'University of Texas at Austin', 'university of texas at austin'),
  ((select id from public.schools where canonical_name = 'University of Texas at Austin'),
   'UT Austin', 'ut austin')
on conflict (normalized_alias) do update set
  school_id = excluded.school_id,
  alias = excluded.alias;

-- Manual seed sources support a useful offline UI. ATS sources below are separate and
-- contain no seed jobs, so live collection never rewrites demonstration records.
insert into public.sources (
  id, company_id, source_type, provider, external_key, name, base_url, reliability, enabled, metadata
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MANUAL', 'manual', 'seed-stripe', 'RecruitIntel development seed', null, 1.000, false, '{"seed":true}'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MANUAL', 'manual', 'seed-cloudflare', 'RecruitIntel development seed', null, 1.000, false, '{"seed":true}'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'MANUAL', 'manual', 'seed-figma', 'RecruitIntel development seed', null, 1.000, false, '{"seed":true}'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'MANUAL', 'manual', 'seed-netflix', 'RecruitIntel development seed', null, 1.000, false, '{"seed":true}'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'MANUAL', 'manual', 'seed-datadog', 'RecruitIntel development seed', null, 1.000, false, '{"seed":true}'),
  ('21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'ATS', 'greenhouse', 'stripe', 'Stripe Greenhouse board', 'https://boards-api.greenhouse.io', 0.980, true, '{}'),
  ('21000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'ATS', 'greenhouse', 'cloudflare', 'Cloudflare Greenhouse board', 'https://boards-api.greenhouse.io', 0.980, true, '{}'),
  ('21000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'ATS', 'greenhouse', 'figma', 'Figma Greenhouse board', 'https://boards-api.greenhouse.io', 0.980, true, '{}'),
  ('21000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'ATS', 'lever', 'netflix', 'Netflix Lever board', 'https://api.lever.co', 0.980, true, '{"region":"us"}'),
  ('21000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'ATS', 'greenhouse', 'datadog', 'Datadog Greenhouse board', 'https://boards-api.greenhouse.io', 0.980, true, '{}')
on conflict (provider, external_key) do update set
  company_id = excluded.company_id,
  name = excluded.name,
  base_url = excluded.base_url,
  reliability = excluded.reliability,
  enabled = excluded.enabled,
  metadata = excluded.metadata;

insert into public.collector_runs (
  id, source_id, collector, status, started_at, finished_at,
  items_discovered, items_new, items_changed, items_unchanged, items_closed, errors, metadata
) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'development-seed', 'SUCCEEDED', '2026-08-15T14:00:00Z', '2026-08-15T14:00:01Z', 1, 1, 0, 0, 0, 0, '{"seed":true}'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'development-seed', 'SUCCEEDED', '2026-08-16T16:30:00Z', '2026-08-16T16:30:01Z', 1, 1, 0, 0, 0, 0, '{"seed":true}'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'development-seed', 'SUCCEEDED', '2026-08-14T18:15:00Z', '2026-08-14T18:15:01Z', 1, 1, 0, 0, 0, 0, '{"seed":true}'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'development-seed', 'SUCCEEDED', '2026-08-13T11:45:00Z', '2026-08-13T11:45:01Z', 1, 1, 0, 0, 0, 0, '{"seed":true}'),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'development-seed', 'SUCCEEDED', '2026-08-12T09:20:00Z', '2026-08-12T09:20:01Z', 1, 1, 0, 0, 0, 0, '{"seed":true}')
on conflict (id) do update set metadata = excluded.metadata;

insert into public.jobs (
  id, company_id, source_id, external_id, title, description, location,
  employment_type, role_family, experience_level, is_internship, is_new_grad,
  season, graduation_years, application_url, source_url, first_seen_at, last_seen_at,
  changed_at, published_at, content_hash, fingerprint_version, classification_version,
  last_seen_run_id, raw_payload
) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'seed-stripe-swe-intern', 'Software Engineering Intern — development example', 'Synthetic seed record for local UI development. This is not a live opening.', 'San Francisco, CA', 'INTERNSHIP', 'SOFTWARE_ENGINEERING', 'INTERNSHIP', true, false, 'SUMMER', '{2027}', 'https://seed.recruitintel.invalid/jobs/stripe-swe-intern', 'https://seed.recruitintel.invalid/sources/stripe-swe-intern', '2026-08-15T14:00:00Z', '2026-08-15T14:00:00Z', '2026-08-15T14:00:00Z', '2026-08-15T13:30:00Z', encode(digest('seed-stripe-swe-intern-v1', 'sha256'), 'hex'), 1, 1, '30000000-0000-0000-0000-000000000001', '{"seed":true,"live":false}'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'seed-cloudflare-new-grad', 'Software Engineer, New Grad — development example', 'Synthetic seed record for local UI development. This is not a live opening.', 'Austin, TX or Remote', 'FULL_TIME', 'SOFTWARE_ENGINEERING', 'ENTRY_LEVEL', false, true, null, '{2027}', 'https://seed.recruitintel.invalid/jobs/cloudflare-new-grad', 'https://seed.recruitintel.invalid/sources/cloudflare-new-grad', '2026-08-16T16:30:00Z', '2026-08-16T16:30:00Z', '2026-08-16T16:30:00Z', '2026-08-16T16:00:00Z', encode(digest('seed-cloudflare-new-grad-v1', 'sha256'), 'hex'), 1, 1, '30000000-0000-0000-0000-000000000002', '{"seed":true,"live":false}'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'seed-figma-data-intern', 'Data Science Intern — development example', 'Synthetic seed record for local UI development. This is not a live opening.', 'New York, NY', 'INTERNSHIP', 'DATA_SCIENCE', 'INTERNSHIP', true, false, 'SUMMER', '{2027}', 'https://seed.recruitintel.invalid/jobs/figma-data-intern', 'https://seed.recruitintel.invalid/sources/figma-data-intern', '2026-08-14T18:15:00Z', '2026-08-14T18:15:00Z', '2026-08-14T18:15:00Z', '2026-08-14T17:45:00Z', encode(digest('seed-figma-data-intern-v1', 'sha256'), 'hex'), 1, 1, '30000000-0000-0000-0000-000000000003', '{"seed":true,"live":false}'),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'seed-netflix-ml-new-grad', 'Machine Learning Engineer, Early Career — development example', 'Synthetic seed record for local UI development. This is not a live opening.', 'Los Gatos, CA', 'FULL_TIME', 'AI_ML', 'ENTRY_LEVEL', false, true, null, '{}', 'https://seed.recruitintel.invalid/jobs/netflix-ml-new-grad', 'https://seed.recruitintel.invalid/sources/netflix-ml-new-grad', '2026-08-13T11:45:00Z', '2026-08-13T11:45:00Z', '2026-08-13T11:45:00Z', '2026-08-13T11:00:00Z', encode(digest('seed-netflix-ml-new-grad-v1', 'sha256'), 'hex'), 1, 1, '30000000-0000-0000-0000-000000000004', '{"seed":true,"live":false}'),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'seed-datadog-security-intern', 'Security Engineering Intern — development example', 'Synthetic seed record for local UI development. This is not a live opening.', 'Boston, MA', 'INTERNSHIP', 'SECURITY', 'INTERNSHIP', true, false, 'SUMMER', '{2027}', 'https://seed.recruitintel.invalid/jobs/datadog-security-intern', 'https://seed.recruitintel.invalid/sources/datadog-security-intern', '2026-08-12T09:20:00Z', '2026-08-12T09:20:00Z', '2026-08-12T09:20:00Z', '2026-08-12T09:00:00Z', encode(digest('seed-datadog-security-intern-v1', 'sha256'), 'hex'), 1, 1, '30000000-0000-0000-0000-000000000005', '{"seed":true,"live":false}')
on conflict (source_id, external_id) do update set
  title = excluded.title,
  description = excluded.description,
  location = excluded.location,
  employment_type = excluded.employment_type,
  role_family = excluded.role_family,
  experience_level = excluded.experience_level,
  is_internship = excluded.is_internship,
  is_new_grad = excluded.is_new_grad,
  content_hash = excluded.content_hash,
  raw_payload = excluded.raw_payload;

insert into public.job_snapshots (
  id, job_id, collector_run_id, content_hash, fingerprint_version, normalized_payload, raw_payload, observed_at
)
select
  ('50000000-0000-0000-0000-' || right(j.id::text, 12))::uuid,
  j.id,
  j.last_seen_run_id,
  j.content_hash,
  j.fingerprint_version,
  jsonb_build_object(
    'external_id', j.external_id, 'title', j.title, 'description', j.description,
    'location', j.location, 'role_family', j.role_family, 'is_internship', j.is_internship,
    'is_new_grad', j.is_new_grad, 'seed', true
  ),
  j.raw_payload,
  j.first_seen_at
from public.jobs j
where j.raw_payload @> '{"seed":true}'::jsonb
on conflict (job_id, content_hash) do nothing;

insert into public.observations (
  id, source_id, collector_run_id, entity_type, job_id, source_url, collected_at,
  published_at, raw_text, normalized_text, content_hash, confidence, metadata
)
select
  ('60000000-0000-0000-0000-' || right(j.id::text, 12))::uuid,
  j.source_id,
  j.last_seen_run_id,
  'JOB',
  j.id,
  j.source_url,
  j.first_seen_at,
  j.published_at,
  j.description,
  concat_ws(E'\n', j.title, j.description, j.location),
  j.content_hash,
  1.000,
  '{"seed":true,"live":false}'::jsonb
from public.jobs j
where j.raw_payload @> '{"seed":true}'::jsonb
on conflict (id) do update set normalized_text = excluded.normalized_text;

insert into public.recruiting_events (
  id, company_id, source_id, job_id, event_type, occurred_at, discovered_at,
  source_url, confidence, fingerprint, payload
)
select
  ('70000000-0000-0000-0000-' || right(j.id::text, 12))::uuid,
  j.company_id,
  j.source_id,
  j.id,
  'JOB_OPENED',
  coalesce(j.published_at, j.first_seen_at),
  j.first_seen_at,
  j.source_url,
  1.000,
  encode(digest('seed-event:' || j.id::text || ':' || j.content_hash, 'sha256'), 'hex'),
  jsonb_build_object('seed', true, 'live', false, 'content_hash', j.content_hash)
from public.jobs j
where j.raw_payload @> '{"seed":true}'::jsonb
on conflict (fingerprint) do nothing;

-- Synthetic Milestone 2 intelligence for offline API/dashboard development. The repository
-- and observations are examples only and are disabled for collection.
insert into public.sources (
  id, source_type, provider, external_key, name, base_url, reliability, enabled, metadata
) values (
  '22000000-0000-0000-0000-000000000001', 'GITHUB', 'github',
  'recruitintel-demo/synthetic-interview-questions',
  'RecruitIntel synthetic GitHub interview questions',
  'https://github.com/recruitintel-demo/synthetic-interview-questions',
  0.650, false, '{"seed":true,"live":false,"official_api":true}'
)
on conflict (provider, external_key) do update set
  name = excluded.name, enabled = excluded.enabled, metadata = excluded.metadata;

insert into public.github_repositories (
  id, source_id, owner, repository_name, repository_url, default_branch,
  repository_type, parser_type, enabled, metadata
) values (
  '23000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  'recruitintel-demo', 'synthetic-interview-questions',
  'https://github.com/recruitintel-demo/synthetic-interview-questions',
  'main', 'INTERVIEW_QUESTIONS', 'MARKDOWN_TABLE', false,
  '{"seed":true,"live":false}'
)
on conflict (owner, repository_name) do update set
  enabled = excluded.enabled, metadata = excluded.metadata;

insert into public.github_repository_company_links (
  company_id, github_repository_id, watched_paths, company_mapping_rules, enabled
) values (
  '10000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  array['questions/stripe.md'], '{"aliases":["Stripe, Inc."]}', true
)
on conflict (company_id, github_repository_id) do update set
  watched_paths = excluded.watched_paths,
  company_mapping_rules = excluded.company_mapping_rules;

insert into public.interview_questions (
  id, canonical_title, normalized_title, leetcode_slug, leetcode_number,
  difficulty, topics
) values
  ('81000000-0000-0000-0000-000000000001', 'Number of Islands',
   'number of islands', 'number-of-islands', 200, 'MEDIUM', array['bfs', 'dfs', 'graph']),
  ('81000000-0000-0000-0000-000000000002', 'Two Sum',
   'two sum', 'two-sum', 1, 'EASY', array['array', 'hash table'])
on conflict (normalized_title) do update set
  leetcode_slug = excluded.leetcode_slug,
  leetcode_number = excluded.leetcode_number,
  difficulty = excluded.difficulty,
  topics = excluded.topics;

insert into public.company_interview_questions (
  id, company_id, interview_question_id, first_seen_at, last_seen_at,
  observation_count, confidence, role_family, interview_stage
) values
  ('82000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001',
   (select id from public.interview_questions where normalized_title = 'number of islands'),
   '2026-08-15T15:00:00Z', '2026-08-16T15:00:00Z', 2, 0.650,
   'SOFTWARE_ENGINEERING', 'Technical screen'),
  ('82000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000001',
   (select id from public.interview_questions where normalized_title = 'two sum'),
   '2026-08-16T15:00:00Z', '2026-08-16T15:00:00Z', 1, 0.650,
   'SOFTWARE_ENGINEERING', 'Technical screen')
on conflict (company_id, interview_question_id) do update set
  last_seen_at = excluded.last_seen_at,
  observation_count = excluded.observation_count,
  confidence = excluded.confidence;

insert into public.interview_question_observations (
  id, company_interview_question_id, source_id, github_repository_id,
  source_url, source_path, commit_sha, observed_at, raw_title, metadata, fingerprint
) values
  ('83000000-0000-0000-0000-000000000001',
   (select id from public.company_interview_questions
    where company_id = '10000000-0000-0000-0000-000000000001'
      and interview_question_id = (
        select id from public.interview_questions where normalized_title = 'number of islands'
      )),
   '22000000-0000-0000-0000-000000000001',
   '23000000-0000-0000-0000-000000000001',
   'https://github.com/recruitintel-demo/synthetic-interview-questions/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/questions/stripe.md',
   'questions/stripe.md', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   '2026-08-15T15:00:00Z', 'LC 200 - Number of Islands',
   '{"seed":true,"live":false,"row_number":3}',
   encode(digest('seed-question-observation:number-of-islands:1', 'sha256'), 'hex')),
  ('83000000-0000-0000-0000-000000000002',
   (select id from public.company_interview_questions
    where company_id = '10000000-0000-0000-0000-000000000001'
      and interview_question_id = (
        select id from public.interview_questions where normalized_title = 'number of islands'
      )),
   '22000000-0000-0000-0000-000000000001',
   '23000000-0000-0000-0000-000000000001',
   'https://github.com/recruitintel-demo/synthetic-interview-questions/blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/questions/stripe.md',
   'questions/stripe.md', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   '2026-08-16T15:00:00Z', '200. Number of Islands',
   '{"seed":true,"live":false,"row_number":3}',
   encode(digest('seed-question-observation:number-of-islands:2', 'sha256'), 'hex')),
  ('83000000-0000-0000-0000-000000000003',
   (select id from public.company_interview_questions
    where company_id = '10000000-0000-0000-0000-000000000001'
      and interview_question_id = (
        select id from public.interview_questions where normalized_title = 'two sum'
      )),
   '22000000-0000-0000-0000-000000000001',
   '23000000-0000-0000-0000-000000000001',
   'https://github.com/recruitintel-demo/synthetic-interview-questions/blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/questions/stripe.md',
   'questions/stripe.md', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   '2026-08-16T15:00:00Z', 'leetcode.com/problems/two-sum',
   '{"seed":true,"live":false,"row_number":4}',
   encode(digest('seed-question-observation:two-sum:1', 'sha256'), 'hex'))
on conflict (fingerprint) do nothing;

insert into public.recruiting_events (
  id, company_id, source_id, github_repository_id, interview_question_id,
  event_type, occurred_at, discovered_at, source_url, confidence, fingerprint, payload
)
select
  '84000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '22000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001', iq.id,
  'INTERVIEW_QUESTION_ADDED', '2026-08-15T15:00:00Z', '2026-08-15T15:00:00Z',
  'https://github.com/recruitintel-demo/synthetic-interview-questions/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/questions/stripe.md',
  0.650, encode(digest('seed-event:question:number-of-islands', 'sha256'), 'hex'),
  '{"seed":true,"live":false,"commit_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
from public.interview_questions iq where iq.normalized_title = 'number of islands'
on conflict (fingerprint) do nothing;
do $$
begin
  if to_regclass('public.users') is not null then
    insert into public.users (id, name, email, email_verified, status)
    values (
      '00000000-0000-0000-0000-000000000001',
      'RecruitIntel Development User',
      'legacy+00000000-0000-0000-0000-000000000001@recruitintel.invalid',
      false,
      'PENDING_IDENTITY'
    )
    on conflict (id) do nothing;

    insert into public.user_profiles (user_id, timezone, locale)
    values ('00000000-0000-0000-0000-000000000001', 'America/Chicago', 'en-US')
    on conflict (user_id) do nothing;
  end if;
end;
$$;

-- Milestone 7 development-only governance. These records explicitly authorize local
-- fixtures and must never be interpreted as a production legal/terms review.
do $$
declare
  development_principal_id uuid := '97000000-0000-0000-0000-000000000001';
begin
  if to_regclass('public.source_policies') is not null then
    insert into public.source_policies (
      provider, display_name, status, collection_method, official_api_available,
      authentication_mode, robots_policy, rate_policy, retention_policy,
      content_restrictions, allowed_uses, terms_status, reviewed_at, reviewed_by,
      maintainer, notes
    )
    select provider, initcap(replace(provider, '_', ' ')) || ' development fixture',
      case when provider = 'manual'
        then 'MANUAL_ONLY'::public.source_policy_status
        else 'ALLOWED_WITH_LIMITS'::public.source_policy_status end,
      case when provider in ('greenhouse', 'lever', 'github')
        then 'OFFICIAL_API'::public.collection_method
        when provider = 'manual' then 'MANUAL_REFERENCE_ONLY'::public.collection_method
        else 'ROBOTS_PERMITTED_HTTP'::public.collection_method end,
      provider in ('greenhouse', 'lever', 'github'),
      case when provider = 'github' then 'API_TOKEN' else 'NONE' end,
      case when provider in ('greenhouse', 'lever', 'github', 'manual')
        then 'NOT_APPLICABLE'::public.robots_policy_mode
        else 'RESPECT_REQUIRED'::public.robots_policy_mode end,
      '{"development_only":true,"requests_per_second":1}'::jsonb,
      '{"development_only":true}'::jsonb,
      '{"development_only":true}'::jsonb,
      array['LOCAL_TESTING'], 'REVIEWED', now(), 'development-fixture',
      'RecruitIntel developers',
      'DEVELOPMENT_FIXTURE_ONLY. This is not a production legal or terms review.'
    from (
      select distinct provider from public.sources
      union select provider from (values
        ('greenhouse'), ('lever'), ('github'), ('web_search'), ('public_web'), ('manual')
      ) known(provider)
    ) providers
    on conflict (provider) do update set
      status = excluded.status,
      collection_method = excluded.collection_method,
      official_api_available = excluded.official_api_available,
      authentication_mode = excluded.authentication_mode,
      robots_policy = excluded.robots_policy,
      rate_policy = excluded.rate_policy,
      retention_policy = excluded.retention_policy,
      content_restrictions = excluded.content_restrictions,
      allowed_uses = excluded.allowed_uses,
      terms_status = excluded.terms_status,
      reviewed_at = excluded.reviewed_at,
      reviewed_by = excluded.reviewed_by,
      maintainer = excluded.maintainer,
      notes = excluded.notes;

    update public.sources source set source_policy_id = policy.id
    from public.source_policies policy
    where source.provider = policy.provider
      and source.source_policy_id is distinct from policy.id;

    insert into public.source_policy_host_rules (
      source_policy_id, hostname_suffix, allow_subdomains, https_required, allowed_ports
    )
    select distinct source.source_policy_id,
      lower(substring(source.base_url from '^https?://([^/:]+)')),
      false,
      source.base_url like 'https://%',
      case when source.base_url like 'https://%' then array[443] else array[80] end
    from public.sources source
    join public.source_policies policy on policy.id = source.source_policy_id
    where source.base_url is not null
      and policy.collection_method = 'ROBOTS_PERMITTED_HTTP'
      and substring(source.base_url from '^https?://([^/:]+)') is not null
    on conflict (source_policy_id, hostname_suffix) do nothing;

    insert into public.source_policy_host_rules (
      source_policy_id, hostname_suffix, allow_subdomains, https_required,
      allowed_ports
    )
    select policy.id, fixture.hostname, false, true, array[443]
    from public.source_policies policy
    cross join (values
      ('stripe.com'), ('careerengagement.utexas.edu'), ('example.com')
    ) fixture(hostname)
    where policy.provider = 'public_web'
      and policy.notes like 'DEVELOPMENT_FIXTURE_ONLY%'
    on conflict (source_policy_id, hostname_suffix) do nothing;

    insert into public.service_principals (
      id, name, kind, token_prefix, token_hash, scopes, status
    ) values (
      development_principal_id,
      'Development orchestration worker',
      'WORKER',
      'ri_worker_M7Dev0001',
      encode(digest('disabled-development-orchestration-token', 'sha256'), 'hex'),
      array[
        'WORKER_INGEST', 'WORKER_CALENDAR_SYNC', 'WORKER_SCHEDULER',
        'WORKER_GLOBAL', 'WORKER_PRIVACY'
      ]::public.service_scope[],
      'ACTIVE'
    ) on conflict (id) do update set
      scopes = excluded.scopes, status = 'ACTIVE', revoked_at = null;

    insert into public.worker_role_bindings (
      database_role, service_principal_id, allowed_work_classes, can_schedule
    ) values (
      current_user, development_principal_id,
      array[
        'ATS', 'GITHUB', 'WEB_SEARCH', 'WEB_FETCH', 'PROJECTION',
        'CALENDAR', 'PRIVACY', 'CONTROL'
      ]::public.work_class[],
      true
    ) on conflict (database_role) do update set
      service_principal_id = excluded.service_principal_id,
      allowed_work_classes = excluded.allowed_work_classes,
      can_schedule = excluded.can_schedule;

    insert into public.schedules (
      name, work_type, work_class, source_id, enabled, schedule_kind,
      interval_seconds, anchor_at, next_run_at, jitter_seconds, priority,
      max_attempts, retry_policy
    )
    select 'ats:' || source.id::text, 'ATS_COLLECT', 'ATS', source.id, true,
      'INTERVAL', 3600, now(), now() + interval '5 minutes', 300, 60, 3,
      'EXPONENTIAL_V1'
    from public.sources source
    where source.source_type = 'ATS' and source.enabled
      and public.source_policy_is_executable(source.id)
    on conflict (name) do update set
      enabled = excluded.enabled,
      interval_seconds = excluded.interval_seconds,
      jitter_seconds = excluded.jitter_seconds,
      priority = excluded.priority;

    insert into public.schedules (
      name, work_type, work_class, github_repository_id, enabled, schedule_kind,
      interval_seconds, anchor_at, next_run_at, jitter_seconds, priority,
      max_attempts, retry_policy
    )
    select 'github:' || repository.id::text, 'GITHUB_SYNC', 'GITHUB', repository.id,
      false, 'INTERVAL', 21600, now(), now() + interval '6 hours', 900, 45, 3,
      'EXPONENTIAL_V1'
    from public.github_repositories repository
    on conflict (name) do update set
      interval_seconds = excluded.interval_seconds,
      jitter_seconds = excluded.jitter_seconds,
      priority = excluded.priority;

    insert into public.schedules (
      name, work_type, work_class, public_web_search_query_id, enabled,
      schedule_kind, interval_seconds, anchor_at, next_run_at, jitter_seconds,
      priority, max_attempts, retry_policy
    )
    select 'public-web-search:' || query.id::text, 'PUBLIC_WEB_SEARCH', 'WEB_SEARCH',
      query.id, false, 'INTERVAL', greatest(query.minimum_interval_seconds, 21600),
      now(), now() + make_interval(secs => greatest(query.minimum_interval_seconds, 21600)),
      1800, 30, 3, 'EXPONENTIAL_V1'
    from public.public_web_search_queries query
    on conflict (name) do update set
      interval_seconds = excluded.interval_seconds,
      jitter_seconds = excluded.jitter_seconds,
      priority = excluded.priority;

    insert into public.schedules (
      name, work_type, work_class, enabled, schedule_kind, daily_local_time,
      timezone, next_run_at, priority, max_attempts, retry_policy
    ) values
      (
        'system:source-health-rollup', 'SOURCE_HEALTH_ROLLUP', 'CONTROL', true,
        'DAILY_AT', '02:30', 'America/Chicago',
        public.next_daily_occurrence(now(), '02:30', 'America/Chicago'), 20, 1, 'NO_RETRY'
      ),
      (
        'system:privacy-retention-cleanup', 'PRIVACY_RETENTION_CLEANUP', 'PRIVACY', true,
        'DAILY_AT', '03:00', 'America/Chicago',
        public.next_daily_occurrence(now(), '03:00', 'America/Chicago'), 15, 3,
        'EXPONENTIAL_V1'
      )
    on conflict (name) do update set
      enabled = excluded.enabled,
      daily_local_time = excluded.daily_local_time,
      timezone = excluded.timezone,
      priority = excluded.priority;
  end if;
end;
$$;
