import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDatabase } from "@recruitintel/db";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const userA = "cc000000-0000-4000-8000-000000000001";
const userB = "cc000000-0000-4000-8000-000000000002";
const workerPrincipal = "cc000000-0000-4000-8000-000000000010";
const workerRole = "m11_built_http_worker";
const requirementFingerprint = "9".repeat(64);
const resumeStorageKey = "ab".repeat(32);
const m12CompanyId = "cc100000-0000-4000-8000-000000000001";
const m12SourceId = "cc100000-0000-4000-8000-000000000001";
const m12PolicyId = "cc100000-0000-4000-8000-000000000003";

integration("built production M10 HTTP runtime", () => {
  let pool: Pool;
  let server: ChildProcess;
  let baseUrl: string;
  let cookieA: string;
  let cookieB: string;
  let serverLog = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = "built-http-test-secret-with-more-than-32-characters";
    process.env.BETTER_AUTH_URL = "http://127.0.0.1:3210";
    process.env.RESUME_STORAGE_KEY = resumeStorageKey;
    // The separately spawned `next start` process runs in production mode.  Set
    // the same mode before constructing BetterAuth here so its secure cookie
    // name/configuration exactly matches the built server.
    Object.assign(process.env, { NODE_ENV: "production" });
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    await pool.query("delete from public.users where id = any($1::uuid[])", [[userA, userB]]);
    await pool.query(
      `insert into public.users (id,name,email,email_verified,status) values
       ($1,'Built HTTP A','built-http-a@example.test',true,'ACTIVE'),
       ($2,'Built HTTP B','built-http-b@example.test',true,'ACTIVE')`,
      [userA, userB],
    );
    await pool.query("delete from public.companies where id=$1", [m12CompanyId]);
    await pool.query("delete from public.source_policies where id=$1", [m12PolicyId]);
    await pool.query(
      `insert into public.companies (id,canonical_name,slug,website,careers_url)
       values ($1,'Built M12 Browser','built-m12-browser','https://built-m12.example.test','https://built-m12.example.test/careers')`,
      [m12CompanyId],
    );
    await pool.query(
      `insert into public.source_policies
       (id,provider,display_name,status,collection_method,official_api_available,robots_policy,terms_status,reviewed_at,reviewed_by)
       values ($1,'builtm12','Built M12 source','ALLOWED','USER_SUBMITTED_REFERENCE',false,'NOT_APPLICABLE','REVIEWED',now(),'Built HTTP test')`,
      [m12PolicyId],
    );
    await pool.query(
      `insert into public.sources
       (id,company_id,source_type,provider,external_key,name,base_url,reliability,source_policy_id)
       values ($1,$2,'COMPANY_CAREERS','builtm12','built-m12','Built M12 careers','https://built-m12.example.test/careers',0.9,$3)`,
      [m12SourceId, m12CompanyId, m12PolicyId],
    );
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname='m11_built_http_worker') then
        create role m11_built_http_worker login password 'm11-built-http-worker';
      end if;
    end $$`);
    await pool.query("grant recruitintel_worker_resume to m11_built_http_worker");
    await pool.query("delete from public.worker_role_bindings where database_role=$1", [
      workerRole,
    ]);
    await pool.query("delete from public.service_principals where id=$1", [workerPrincipal]);
    await pool.query(
      `insert into public.service_principals
       (id,name,kind,token_prefix,token_hash,scopes,status)
       values ($1,'Built M11 worker','WORKER','ri_worker_BuiltM1101',
         encode(digest('m11-built-http-worker','sha256'),'hex'),
         array['ORCHESTRATION_MUTATE']::public.service_scope[],'ACTIVE')`,
      [workerPrincipal],
    );
    await pool.query(
      `insert into public.worker_role_bindings
       (database_role,service_principal_id,allowed_work_classes,can_schedule)
       values ($1,$2,array['RESUME']::public.work_class[],false)`,
      [workerRole, workerPrincipal],
    );
    const { auth } = await import("./auth");
    const context = await auth.$context;
    const sessionA = await context.internalAdapter.createSession(userA);
    const sessionB = await context.internalAdapter.createSession(userB);
    const sign = (token: string) =>
      `${context.authCookies.sessionToken.name}=${token}.${createHmac("sha256", context.secret).update(token).digest("base64")}`;
    cookieA = sign(sessionA.token);
    cookieB = sign(sessionB.token);
    server = spawn("pnpm", ["start", "-p", "3210"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: "built-http-test-secret-with-more-than-32-characters",
        BETTER_AUTH_URL: "http://127.0.0.1:3210",
        NODE_ENV: "production",
        ZERO_COST_MODE: "true",
        RESUME_STORAGE_KEY: resumeStorageKey,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => {
      serverLog += String(chunk);
    });
    server.stderr?.on("data", (chunk) => {
      serverLog += String(chunk);
    });
    baseUrl = "http://127.0.0.1:3210";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/applications`, {
          headers: { cookie: cookieA },
        });
        if (response.status < 500) return;
      } catch {
        // Server is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Built server did not become ready");
  }, 20_000);

  afterAll(async () => {
    server?.kill("SIGTERM");
    await pool?.query("delete from public.users where id = any($1::uuid[])", [[userA, userB]]);
    await pool?.query("delete from public.companies where id=$1", [m12CompanyId]);
    await pool?.query("delete from public.source_policies where id=$1", [m12PolicyId]);
    await pool?.query(
      `delete from public.job_requirement_sets
       where requirements::text like $1 and not exists (
         select 1 from public.resume_job_matches where requirement_set_id=job_requirement_sets.id
       )`,
      [`%${requirementFingerprint}%`],
    );
    await pool?.query("delete from public.job_requirements where evidence_fingerprint=$1", [
      requirementFingerprint,
    ]);
    await pool?.query("delete from public.worker_role_bindings where database_role=$1", [
      workerRole,
    ]);
    await pool?.query("delete from public.service_principals where id=$1", [workerPrincipal]);
    await pool?.end();
    await getDatabase().end();
  });

  it("runs authenticated owner-safe application lifecycle over next start", async () => {
    const opportunity = await pool.query(
      "select id from public.job_opportunities where status='ACTIVE' order by id limit 1",
    );
    const opportunityId = String(opportunity.rows[0].id);
    const request = (path: string, init: RequestInit = {}, cookie = cookieA) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
    const create = await request("/api/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        opportunityId,
        cycleKey: "built-http-m10",
        applicationUrlUsed: "https://apply.example/built-http",
      }),
    });
    expect(create.status).toBe(201);
    const application = (await create.json()).data as { id: string };
    expect((await request(`/api/applications/${application.id}`)).status).toBe(200);
    expect((await request(`/api/applications/${application.id}`, {}, cookieB)).status).toBe(404);
    const status = await request(`/api/applications/${application.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPLIED", idempotencyKey: "built-http-submit" }),
    });
    expect(status.status).toBe(200);
    expect((await request(`/api/applications/${application.id}/timeline`)).status).toBe(200);
    const child = await request(`/api/applications/${application.id}/assessments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "OA", idempotencyKey: "built-http-oa" }),
    });
    expect(child.status).toBe(201);
    const assessment = (await child.json()).data as { id: string };
    expect(
      (
        await request(`/api/applications/${application.id}/assessments/${assessment.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/assessments/${assessment.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED" }),
          },
          cookieB,
        )
      ).status,
    ).toBe(404);
    const interviewResponse = await request(`/api/applications/${application.id}/interviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interviewType: "TECHNICAL",
        startsAt: "2027-10-01T12:00:00.000Z",
        timezone: "UTC",
      }),
    });
    expect(interviewResponse.status).toBe(201);
    const interview = (await interviewResponse.json()).data as { id: string };
    expect(
      (
        await request(`/api/applications/${application.id}/interviews/${interview.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "COMPLETED" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/interviews/${interview.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: "COMPLETED" }),
          },
          cookieB,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/applications/${application.id}/archive`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/api/applications/${application.id}`, {}, cookieB)).status).toBe(404);
  });

  it("runs the full recommendation-to-outcome M11 lifecycle over next start", async () => {
    const target = await pool.query(
      `select opportunity.id,opportunity.canonical_source_posting_id
       from public.job_opportunities opportunity
       where opportunity.status='ACTIVE'
         and opportunity.company_id='10000000-0000-0000-0000-000000000001'
       order by opportunity.id limit 1`,
    );
    const opportunityId = String(target.rows[0].id);
    await pool.query(
      `insert into public.job_requirements
       (job_id,requirement_type,normalized_value,raw_evidence,explicit,parser_version,evidence_fingerprint)
       values ($1,'SKILL','{"skill":"python"}'::jsonb,'Python required',true,1,$2)
       on conflict (job_id,evidence_fingerprint) do nothing`,
      [target.rows[0].canonical_source_posting_id, requirementFingerprint],
    );
    const request = (path: string, init: RequestInit = {}, cookie = cookieA) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
    const json = (body: unknown, method = "POST"): RequestInit => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const recommendationResponse = await request(
      "/api/recommendations/opportunities?company=stripe&limit=20&includeLowPriority=true",
    );
    expect(recommendationResponse.status).toBe(200);
    const recommendations = (await recommendationResponse.json()).data as Array<{
      impressionId: string;
      opportunity: { id: string };
      recommendationScore: number | null;
    }>;
    const recommendation = recommendations.find((item) => item.opportunity.id === opportunityId);
    if (!recommendation) throw new Error("Expected Stripe recommendation");
    expect(
      (
        await request(`/api/recommendations/impressions/${recommendation.impressionId}/open`, {
          method: "POST",
        })
      ).status,
    ).toBe(204);

    const uploadResponse = await request(
      "/api/resumes",
      json({
        originalFilename: "built-m11-lifecycle.txt",
        mediaType: "text/plain",
        content: Buffer.from("Python React SQL").toString("base64"),
      }),
    );
    expect(uploadResponse.status).toBe(201);
    const document = (await uploadResponse.json()).data as { id: string };
    expect((await request(`/api/resumes/${document.id}`)).status).toBe(200);
    const versionResponse = await request(
      `/api/resumes/${document.id}/versions`,
      json({ extractedText: "Python React SQL" }),
    );
    expect(versionResponse.status).toBe(201);
    const version = (await versionResponse.json()).data as { id: string };
    expect((await request(`/api/resumes/${document.id}/versions`)).status).toBe(200);
    const parseRequest = await request(
      `/api/resumes/${document.id}/parse`,
      json({ resumeVersionId: version.id }),
    );
    if (parseRequest.status !== 202) {
      throw new Error(`Parse request returned ${parseRequest.status}: ${serverLog.slice(-4000)}`);
    }

    const workerDatabase = new URL(databaseUrl!);
    workerDatabase.username = workerRole;
    workerDatabase.password = "m11-built-http-worker";
    const workerBinary = fileURLToPath(
      new URL("../../../../.venv/bin/recruitintel-collectors", import.meta.url),
    );
    const runFiniteResumeWorker = async () => {
      const worker = spawn(
        workerBinary,
        ["worker", "--classes", "RESUME", "--batch-size", "1", "--lease-seconds", "30", "--once"],
        {
          cwd: fileURLToPath(new URL("../../../..", import.meta.url)),
          env: {
            ...process.env,
            DATABASE_URL: workerDatabase.toString(),
            ZERO_COST_MODE: "true",
          },
          stdio: "ignore",
        },
      );
      return new Promise<number | null>((resolve, reject) => {
        worker.once("error", reject);
        worker.once("exit", resolve);
      });
    };
    expect(await runFiniteResumeWorker()).toBe(0);
    const parseRunsResponse = await request(
      `/api/resumes/${document.id}/parse?resumeVersionId=${version.id}`,
    );
    expect(parseRunsResponse.status).toBe(200);
    const parseRuns = (await parseRunsResponse.json()).data as Array<{ status: string }>;
    expect(parseRuns.some((run) => run.status === "SUCCEEDED")).toBe(true);

    const evidenceResponse = await request(
      `/api/resumes/${document.id}/evidence?resumeVersionId=${version.id}`,
    );
    expect(evidenceResponse.status).toBe(200);
    const evidence = (await evidenceResponse.json()).data as Array<{
      id: string;
      normalizedValue: { skill?: string };
    }>;
    const bySkill = (skill: string) =>
      evidence.find((item) => item.normalizedValue.skill === skill)?.id;
    const python = bySkill("python");
    const react = bySkill("react");
    const sql = bySkill("sql");
    if (!python || !react || !sql) throw new Error("Expected parsed skill evidence");
    expect(
      (
        await request(
          `/api/resumes/${document.id}/evidence`,
          json({
            resumeVersionId: version.id,
            evidenceId: python,
            action: "CONFIRMED",
            expectedVersion: 0,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/resumes/${document.id}/evidence`,
          json({
            resumeVersionId: version.id,
            evidenceId: react,
            action: "REJECTED",
            expectedVersion: 0,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/resumes/${document.id}/evidence`,
          json({
            resumeVersionId: version.id,
            evidenceId: sql,
            action: "CORRECTED",
            normalizedValue: { skill: "pytorch" },
            expectedRevision: 1,
          }),
        )
      ).status,
    ).toBe(200);

    const matchResponse = await request(
      "/api/resume-matches",
      json({
        resumeVersionId: version.id,
        opportunityId,
        recommendationImpressionId: recommendation.impressionId,
      }),
    );
    expect(matchResponse.status).toBe(201);
    const match = (await matchResponse.json()).data as {
      id: string;
      eligibility: string;
      score: number | null;
      citations: Array<{ evidenceId: string | null; reasonCode: string }>;
      evidenceFingerprint: string;
      requirementSetId: string;
      requirementInputFingerprint: string;
      algorithmVersion: string;
    };
    expect(match.eligibility).toBe("ELIGIBLE");
    expect(match.score).toBe(100);
    expect(match.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceId: python, reasonCode: "EXPLICIT_SKILL_EVIDENCE" }),
      ]),
    );
    const retrievedMatch = await request(`/api/resume-matches?id=${match.id}`);
    expect(retrievedMatch.status).toBe(200);
    expect((await retrievedMatch.json()).data).toMatchObject(match);
    const queuedMatchWork = await pool.query(
      `insert into public.work_items
       (work_type,work_class,user_id,resume_version_id,opportunity_id,algorithm_version,
        idempotency_fingerprint,safe_diagnostics)
       values ('MATCH_MATERIALIZE','RESUME',$1,$2,$3,'resume-coverage-v1',$4,'{}')
       returning id`,
      [userA, version.id, opportunityId, "8".repeat(64)],
    );
    expect(await runFiniteResumeWorker()).toBe(0);
    const finiteMatchProof = await pool.query(
      `select work.status::text,
         (select count(*)::int from public.resume_job_matches
          where user_id=$1 and resume_version_id=$2 and opportunity_id=$3) matches
       from public.work_items work where work.id=$4`,
      [userA, version.id, opportunityId, queuedMatchWork.rows[0].id],
    );
    expect(finiteMatchProof.rows[0]).toEqual({ status: "SUCCEEDED", matches: 1 });

    const applicationResponse = await request(
      "/api/applications",
      json({
        opportunityId,
        cycleKey: "built-http-m11",
        originRecommendationImpressionId: recommendation.impressionId,
        applicationUrlUsed: "https://apply.example/built-http-m11",
      }),
    );
    expect(applicationResponse.status).toBe(201);
    const application = (await applicationResponse.json()).data as { id: string };
    expect(
      (
        await request(
          `/api/applications/${application.id}/match`,
          json({ resumeVersionId: version.id, matchId: match.id }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/status`,
          json({ status: "APPLIED", idempotencyKey: "built-m11-submit" }, "PATCH"),
        )
      ).status,
    ).toBe(200);
    const assessmentResponse = await request(
      `/api/applications/${application.id}/assessments`,
      json({ type: "OA", idempotencyKey: "built-m11-oa" }),
    );
    expect(assessmentResponse.status).toBe(201);
    const assessment = (await assessmentResponse.json()).data as { id: string };
    expect(
      (
        await request(
          `/api/applications/${application.id}/assessments/${assessment.id}`,
          json({ status: "COMPLETED" }, "PATCH"),
        )
      ).status,
    ).toBe(200);
    const interviewResponse = await request(
      `/api/applications/${application.id}/interviews`,
      json({
        interviewType: "TECHNICAL",
        startsAt: "2027-11-01T12:00:00.000Z",
        timezone: "UTC",
      }),
    );
    expect(interviewResponse.status).toBe(201);
    const interview = (await interviewResponse.json()).data as { id: string };
    expect(
      (
        await request(
          `/api/applications/${application.id}/interviews/${interview.id}`,
          json({ status: "COMPLETED" }, "PATCH"),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/applications/${application.id}/status`,
          json({ status: "OFFER", idempotencyKey: "built-m11-offer" }, "PATCH"),
        )
      ).status,
    ).toBe(200);

    for (const path of [
      `/api/resumes/${document.id}`,
      `/api/resumes/${document.id}/versions`,
      `/api/resumes/${document.id}/evidence?resumeVersionId=${version.id}`,
      `/api/resumes/${document.id}/parse?resumeVersionId=${version.id}`,
      `/api/resume-matches?id=${match.id}`,
      `/api/applications/${application.id}`,
    ]) {
      expect((await request(path, {}, cookieB)).status).toBe(404);
    }
    const final = await pool.query(
      `select application.current_status::text status,application.match_id,
         impression.score::float8 impression_score,match.score::float8 match_score,
         match.eligibility::text eligibility,match.evidence_fingerprint,
         match.requirement_set_id,match.algorithm_version,
         (select count(*)::int from public.application_assessments where application_id=application.id) assessments,
         (select count(*)::int from public.application_interviews where application_id=application.id) interviews
       from public.applications application
       join public.resume_job_matches match on match.id=application.match_id
       join public.recommendation_impressions impression
         on impression.id=application.origin_recommendation_impression_id
       where application.id=$1`,
      [application.id],
    );
    expect(final.rows[0]).toMatchObject({
      status: "OFFER",
      match_id: match.id,
      impression_score: recommendation.recommendationScore,
      match_score: 100,
      eligibility: "ELIGIBLE",
      evidence_fingerprint: match.evidenceFingerprint,
      requirement_set_id: match.requirementSetId,
      algorithm_version: match.algorithmVersion,
      assessments: 1,
      interviews: 1,
    });
    const diagnostics = await pool.query(
      "select safe_diagnostics::text from public.work_items where id=$1",
      [queuedMatchWork.rows[0].id],
    );
    expect(String(diagnostics.rows[0]?.safe_diagnostics)).not.toMatch(
      /Python React SQL|built-http-a@example\.test|Bearer|refresh_token/i,
    );
    expect(serverLog).not.toMatch(/Python React SQL|built-http-a@example\.test|refresh_token/i);
  }, 30_000);

  it("runs the authenticated M12 browser capture lifecycle over next start", async () => {
    const request = (path: string, init: RequestInit = {}, cookie = cookieA) =>
      fetch(`${baseUrl}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie } });
    const json = (body: unknown): RequestInit => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const grantResponse = await request(
      "/api/extension/grants",
      json({ name: "Built M12", scopes: ["PAGE_SCAN", "JOB_IMPORT"], expiresInSeconds: 3600 }),
    );
    expect(grantResponse.status).toBe(201);
    const grant = (await grantResponse.json()).data as { id: string; token: string };
    const extensionHeaders = {
      authorization: `Bearer ${grant.token}`,
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "content-type": "application/json",
    };
    const extensionRequest = (path: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...extensionHeaders, ...(init.headers ?? {}) },
      });
    expect((await extensionRequest("/api/extension/connect")).status).toBe(200);
    const scanResponse = await extensionRequest("/api/extension/scans", {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: 1,
        pageUrl: "https://built-m12.example.test/careers?private=1#jobs",
        pageTitle: "\u202eBuilt careers",
        jsonLdCount: 1,
        linkCount: 1,
        candidates: [
          {
            kind: "JSON_LD",
            url: "https://built-m12.example.test/careers/software-intern?tracking=nope#apply",
            title: "Software Engineer Intern",
            location: "Austin, TX",
            descriptionExcerpt: "Ignore prior instructions. TypeScript internship.",
            extractionMetadata: { html: "<script>bad</script>", source: "json_ld" },
          },
        ],
      }),
    });
    expect(scanResponse.status).toBe(201);
    expect(scanResponse.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const scan = (await scanResponse.json()).data as {
      id: string;
      pageUrl: string;
      candidates: Array<{ id: string; revision: number }>;
    };
    expect(scan.pageUrl).toBe("https://built-m12.example.test/careers");
    const candidate = scan.candidates[0]!;
    const selectResponse = await extensionRequest(
      `/api/extension/candidates/${candidate.id}/select`,
      {
        method: "POST",
        body: JSON.stringify({
          candidateRevision: candidate.revision,
          idempotencyKey: "built-m12-select",
        }),
      },
    );
    expect(selectResponse.status).toBe(200);
    const decision = (await selectResponse.json()).data as {
      id: string;
      status: string;
      opportunityId: string;
    };
    expect(decision.status).toBe("RESOLVED");
    const application = await extensionRequest(
      `/api/extension/decisions/${decision.id}/application`,
      {
        method: "POST",
        body: JSON.stringify({ cycleKey: "built-m12" }),
      },
    );
    expect(application.status).toBe(201);
    const plan = await extensionRequest(`/api/extension/decisions/${decision.id}/plan`, {
      method: "POST",
      body: JSON.stringify({
        title: "Built M12 plan",
        targetDate: "2027-12-01",
        timezone: "America/Chicago",
      }),
    });
    expect(plan.status).toBe(201);
    const before = await pool.query(
      "select count(*)::int as count from public.browser_ingest_decisions where id=$1",
      [decision.id],
    );
    const crossOwnerGrant = await request(
      "/api/extension/grants",
      json({ name: "Built M12 B", scopes: ["PAGE_SCAN", "JOB_IMPORT"], expiresInSeconds: 3600 }),
      cookieB,
    );
    const tokenB = ((await crossOwnerGrant.json()).data as { token: string }).token;
    const crossOwner = await fetch(`${baseUrl}/api/extension/scans/${scan.id}`, {
      headers: {
        authorization: `Bearer ${tokenB}`,
        origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(crossOwner.status).toBe(404);
    const after = await pool.query(
      "select count(*)::int as count from public.browser_ingest_decisions where id=$1",
      [decision.id],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
    expect((await request(`/api/extension/grants/${grant.id}`, { method: "DELETE" })).status).toBe(
      204,
    );
    expect((await extensionRequest("/api/extension/connect")).status).toBe(401);
  }, 30_000);
});
