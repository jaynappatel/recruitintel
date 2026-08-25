import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import postgres from "postgres";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
const rows = Number.parseInt(process.env.OPPORTUNITY_BENCHMARK_ROWS ?? "10000", 10);
if (!Number.isInteger(rows) || rows < 1_000 || rows > 1_000_000) {
  throw new Error("OPPORTUNITY_BENCHMARK_ROWS must be between 1000 and 1000000");
}
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const databaseName = `recruitintel_m8_bench_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(sourceUrl);
databaseUrl.pathname = `/${databaseName}`;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);
const admin = postgres(adminUrl.toString(), { max: 1 });
let database;

try {
  await admin.unsafe(`create database "${databaseName}"`);
  database = postgres(databaseUrl.toString(), { max: 1, idle_timeout: 5 });
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    const contents = await readFile(path.join(migrationsDirectory, file), "utf8");
    await database.unsafe(contents);
  }
  const [company] = await database`
    insert into public.companies (canonical_name, slug)
    values ('M8 deterministic benchmark', 'm8-deterministic-benchmark') returning id
  `;
  const [sourceRow] = await database`
    insert into public.sources (
      company_id, source_type, provider, external_key, name, reliability,
      source_policy_id
    ) values (
      ${company.id}, 'ATS', 'greenhouse', 'm8-benchmark-board',
      'M8 benchmark source', 0.99,
      (select id from public.source_policies where provider = 'greenhouse')
    ) returning id
  `;
  await database`
    insert into public.jobs (
      company_id, source_id, external_id, title, application_url, source_url,
      content_hash
    )
    select ${company.id}, ${sourceRow.id}, 'bench-' || value::text,
      'Software Engineer Intern ' || value::text,
      'https://boards.greenhouse.io/m8-benchmark/jobs/' || value::text,
      'https://boards.greenhouse.io/m8-benchmark/jobs/' || value::text,
      encode(digest('m8-benchmark-source:' || value::text, 'sha256'), 'hex')
    from generate_series(1, ${rows}) value
  `;
  await database`
    insert into public.job_identity_keys (
      job_id, company_id, key_type, provider, key_hash, validator_version, validated
    )
    select job.id, job.company_id, 'OFFICIAL_APPLICATION_URL', 'greenhouse',
      encode(digest('m8-benchmark-key:' || (row_number() over (order by job.id) % 2000)::text,
        'sha256'), 'hex'), 1, true
    from public.jobs job where job.company_id = ${company.id}
  `;
  const [subject] = await database`
    select job_id from public.job_identity_keys where company_id = ${company.id}
    order by job_id limit 1
  `;
  const [explain] = await database`
    explain (analyze, buffers, format json, costs off, timing off)
    select candidate.job_id
    from public.job_identity_keys own
    join public.job_identity_keys candidate
      on candidate.company_id = own.company_id
     and candidate.key_type = own.key_type
     and candidate.key_hash = own.key_hash
     and candidate.validated and candidate.job_id <> own.job_id
    where own.job_id = ${subject.job_id} and own.validated
    order by candidate.job_id limit 51
  `;
  const plan = explain["QUERY PLAN"][0];
  const serialized = JSON.stringify(plan);
  if (serialized.includes('"Node Type":"Seq Scan"')) {
    throw new Error("candidate generation used an unbounded sequential scan");
  }
  if (!serialized.includes("job_identity_keys_match_idx")) {
    throw new Error("candidate generation did not use the identity-key match index");
  }
  if (plan.Plan["Actual Rows"] > 51) {
    throw new Error("candidate generation exceeded its comparison cap");
  }
  console.log(
    JSON.stringify({
      status: "ok",
      generatedSourcePostings: rows,
      comparisonCap: 51,
      actualRows: plan.Plan["Actual Rows"],
      planningTimeMs: plan["Planning Time"],
      executionTimeMs: plan["Execution Time"],
      indexed: true,
      fullCatalogueScan: false,
    }),
  );
} finally {
  if (database) await database.end({ timeout: 5 });
  await admin`
    select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${databaseName} and pid <> pg_backend_pid()
  `;
  await admin.unsafe(`drop database if exists "${databaseName}"`);
  await admin.end({ timeout: 5 });
}
