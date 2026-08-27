import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import { createApplication } from "./applications";
import { createApplicationPlan } from "./calendar";
import { getDatabase } from "./index";
import { materializeResumeJobMatch } from "./resume";

type QuerySql = Sql | TransactionSql;
type Row = Record<string, unknown>;

export class BrowserCompanionNotFoundError extends Error {}
export class BrowserCompanionConflictError extends Error {}
export class BrowserCompanionPolicyError extends Error {}
export class BrowserCompanionValidationError extends Error {}

export type BrowserCandidateKind = "GRID" | "SINGLE" | "JSON_LD";
export interface BrowserScanCandidateInput {
  kind: BrowserCandidateKind;
  url: string;
  title: string;
  companyName?: string | null;
  location?: string;
  descriptionExcerpt?: string;
  extractionMetadata?: Record<string, unknown>;
}

export interface BrowserScanUploadInput {
  protocolVersion: number;
  pageUrl: string;
  pageTitle: string;
  jsonLdCount: number;
  linkCount: number;
  candidates: BrowserScanCandidateInput[];
}

export interface BrowserCandidateRecord {
  id: string;
  revision: number;
  kind: BrowserCandidateKind;
  url: string;
  title: string;
  companyName: string | null;
  location: string;
  descriptionExcerpt: string;
  rankScore: number;
  rankReasons: string[];
  createdAt: string;
}

export interface BrowserScanRecord {
  id: string;
  pageUrl: string;
  pageTitle: string;
  status: "REVIEWING" | "COMPLETED" | "FAILED" | "REVOKED";
  candidateCount: number;
  selectedCount: number;
  createdAt: string;
  completedAt: string | null;
  candidates: BrowserCandidateRecord[];
}

export interface BrowserIngestDecisionRecord {
  id: string;
  candidateId: string;
  candidateRevision: number;
  status: "PENDING" | "RESOLVED" | "POLICY_BLOCKED" | "STALE" | "FAILED";
  resultCode: string;
  opportunityId: string | null;
  currentOpportunityId: string | null;
  resolutionMismatch: boolean;
  sourcePostingId: string | null;
  applicationId: string | null;
  applicationPlanId: string | null;
  matchId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const text = (value: unknown) => String(value);
const optionalText = (value: unknown) =>
  value === null || value === undefined ? null : text(value);
const timestamp = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
const optionalTimestamp = (value: unknown) =>
  value === null || value === undefined ? null : timestamp(value);

// Browser control and bidi characters are data hazards, not display content.
const INVISIBLE = new RegExp(
  String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]`,
  "g",
);
const FORBIDDEN_KEYS = new Set([
  "html",
  "raw_html",
  "dom_html",
  "cookie",
  "cookies",
  "localstorage",
  "sessionstorage",
  "authorization",
  "access_token",
  "refresh_token",
  "password",
  "prompt",
  "instruction",
]);

function normalizedText(value: string, maximum: number): string {
  const result = value.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (result.length > maximum)
    throw new BrowserCompanionValidationError("Browser text exceeds limits");
  return result;
}

function safeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    if (typeof item === "string") output[key] = normalizedText(item, 500);
    else if (typeof item === "number" || typeof item === "boolean" || item === null)
      output[key] = item;
  }
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined));
}

function canonicalUrl(value: string): { url: string; host: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BrowserCompanionValidationError("Browser URL is invalid");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new BrowserCompanionValidationError("Only http(s) browser pages are supported");
  if (parsed.username || parsed.password || !parsed.hostname)
    throw new BrowserCompanionValidationError("Browser URL credentials are not allowed");
  const host = parsed.hostname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com"))
    throw new BrowserCompanionPolicyError("LinkedIn pages are not supported");
  parsed.hostname = host;
  parsed.search = "";
  parsed.hash = "";
  return { url: parsed.toString(), host };
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function candidateRank(candidate: {
  kind: BrowserCandidateKind;
  title: string;
  description: string;
  location: string;
}): { score: number; reasons: string[] } {
  let score = candidate.kind === "JSON_LD" ? 75 : candidate.kind === "SINGLE" ? 70 : 60;
  const reasons = [
    candidate.kind === "JSON_LD"
      ? "JSON_LD"
      : candidate.kind === "SINGLE"
        ? "SINGLE_JOB"
        : "JOB_GRID",
  ];
  if (candidate.description.length >= 80) {
    score += 12;
    reasons.push("DESCRIPTION_PRESENT");
  }
  if (candidate.location) {
    score += 6;
    reasons.push("LOCATION_PRESENT");
  }
  if (/\b(intern|new grad|engineer|developer|analyst|designer|manager)\b/i.test(candidate.title)) {
    score += 7;
    reasons.push("ROLE_TITLE_SIGNAL");
  }
  return { score: Math.min(score, 100), reasons };
}

function classify(title: string) {
  const lower = title.toLowerCase();
  const internship = /\bintern(ship)?\b/.test(lower);
  const newGrad = /\b(new grad|graduate program|university graduate)\b/.test(lower);
  const roleFamily = /\b(data (scientist|analyst)|analytics)\b/.test(lower)
    ? "DATA_SCIENCE"
    : /\b(machine learning|artificial intelligence|\bai\b)\b/.test(lower)
      ? "AI_ML"
      : /\b(product manager|product management)\b/.test(lower)
        ? "PRODUCT"
        : /\b(design|ux|ui)\b/.test(lower)
          ? "DESIGN"
          : /\b(security)\b/.test(lower)
            ? "SECURITY"
            : /\b(devops|platform|cloud|sre)\b/.test(lower)
              ? "CLOUD_DEVOPS"
              : /\b(engineer|developer|software)\b/.test(lower)
                ? "SOFTWARE_ENGINEERING"
                : "OTHER";
  return {
    roleFamily,
    experienceLevel: internship ? "INTERNSHIP" : newGrad ? "ENTRY_LEVEL" : "UNKNOWN",
    employmentType: internship ? "INTERNSHIP" : "UNKNOWN",
    isInternship: internship,
    isNewGrad: newGrad,
  };
}

function mapCandidate(row: Row): BrowserCandidateRecord {
  return {
    id: text(row.id),
    revision: Number(row.revision),
    kind: text(row.candidate_kind) as BrowserCandidateKind,
    url: text(row.job_url),
    title: text(row.title),
    companyName: optionalText(row.company_name),
    location: text(row.location_text),
    descriptionExcerpt: text(row.description_excerpt),
    rankScore: Number(row.rank_score),
    rankReasons: Array.isArray(row.rank_reasons) ? row.rank_reasons.map(String) : [],
    createdAt: timestamp(row.created_at),
  };
}

function mapScan(row: Row, candidates: BrowserCandidateRecord[]): BrowserScanRecord {
  return {
    id: text(row.id),
    pageUrl: text(row.page_url),
    pageTitle: text(row.page_title),
    status: text(row.status) as BrowserScanRecord["status"],
    candidateCount: Number(row.candidate_count),
    selectedCount: Number(row.selected_count),
    createdAt: timestamp(row.created_at),
    completedAt: optionalTimestamp(row.completed_at),
    candidates,
  };
}

async function candidatesFor(sql: QuerySql, userId: string, scanId: string) {
  const rows = await sql`
    select id,revision,candidate_kind,job_url,title,company_name,location_text,description_excerpt,
      rank_score,rank_reasons,created_at from public.page_job_candidates
    where user_id=${userId}::uuid and scan_session_id=${scanId}::uuid
    order by rank_score desc,ordinal,id
  `;
  return rows.map(mapCandidate);
}

export async function uploadBrowserScan(
  userId: string,
  extensionGrantId: string,
  input: BrowserScanUploadInput,
): Promise<BrowserScanRecord> {
  if (input.candidates.length < 1 || input.candidates.length > 100)
    throw new BrowserCompanionValidationError("Browser scan candidate count is invalid");
  const page = canonicalUrl(input.pageUrl);
  const pageTitle = normalizedText(input.pageTitle, 300);
  const candidates = input.candidates.map((candidate) => {
    const url = canonicalUrl(candidate.url).url;
    const title = normalizedText(candidate.title, 300);
    if (!title) throw new BrowserCompanionValidationError("Candidate title is required");
    const description = normalizedText(candidate.descriptionExcerpt ?? "", 8_000);
    const location = normalizedText(candidate.location ?? "", 300);
    const companyName = candidate.companyName ? normalizedText(candidate.companyName, 300) : null;
    const metadata = safeMetadata(candidate.extractionMetadata);
    const ranked = candidateRank({ kind: candidate.kind, title, description, location });
    return {
      kind: candidate.kind,
      url,
      title,
      description,
      location,
      companyName,
      metadata,
      ...ranked,
      fingerprint: sha256({ v: 1, url, title, description, location, companyName }),
    };
  });
  const uniqueCandidates = [
    ...new Map(candidates.map((candidate) => [candidate.fingerprint, candidate])).values(),
  ];
  const fingerprint = sha256({
    v: input.protocolVersion,
    pageUrl: page.url,
    pageTitle,
    candidates: uniqueCandidates
      .map(({ fingerprint: candidateFingerprint }) => candidateFingerprint)
      .sort(),
  });
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [scan] = await transaction`
      insert into public.browser_scan_sessions
        (user_id,extension_grant_id,page_url,page_host,page_title,snapshot_fingerprint,protocol_version,status,candidate_count,completed_at)
      values (${userId}::uuid,${extensionGrantId}::uuid,${page.url},${page.host},${pageTitle},${fingerprint},
        ${input.protocolVersion},'COMPLETED',${uniqueCandidates.length},now())
      on conflict (user_id,snapshot_fingerprint) do update set updated_at=public.browser_scan_sessions.updated_at
      returning *
    `;
    if (!scan) throw new BrowserCompanionConflictError("Browser scan could not be persisted");
    await transaction`
      insert into public.page_snapshots
        (scan_session_id,user_id,page_url,content_fingerprint,extraction_version,json_ld_count,link_count,summary)
      values (${text(scan.id)}::uuid,${userId}::uuid,${page.url},${fingerprint},${input.protocolVersion},
        ${input.jsonLdCount},${input.linkCount},${transaction.json({ candidateCount: uniqueCandidates.length } as never)})
      on conflict (scan_session_id) do nothing
    `;
    for (const [ordinal, candidate] of uniqueCandidates.entries()) {
      await transaction`
        insert into public.page_job_candidates
          (scan_session_id,snapshot_id,user_id,ordinal,candidate_kind,candidate_fingerprint,job_url,title,
           company_name,location_text,description_excerpt,rank_score,rank_reasons,extraction_metadata)
        select ${text(scan.id)}::uuid,snapshot.id,${userId}::uuid,${ordinal},${candidate.kind},
          ${candidate.fingerprint},${candidate.url},${candidate.title},${candidate.companyName},${candidate.location},
          ${candidate.description},${candidate.score},${candidate.reasons},${transaction.json(candidate.metadata as never)}
        from public.page_snapshots snapshot where snapshot.scan_session_id=${text(scan.id)}::uuid
        on conflict (scan_session_id,candidate_fingerprint) do nothing
      `;
    }
    return mapScan(scan, await candidatesFor(transaction, userId, text(scan.id)));
  });
}

export async function getBrowserScan(userId: string, scanId: string): Promise<BrowserScanRecord> {
  const sql = getDatabase();
  const [scan] = await sql`
    select * from public.browser_scan_sessions where id=${scanId}::uuid and user_id=${userId}::uuid
  `;
  if (!scan) throw new BrowserCompanionNotFoundError("Browser scan was not found");
  return mapScan(scan, await candidatesFor(sql, userId, scanId));
}

function mapDecision(row: Row): BrowserIngestDecisionRecord {
  const opportunityId = optionalText(row.opportunity_id);
  const currentOpportunityId = optionalText(row.current_opportunity_id) ?? opportunityId;
  return {
    id: text(row.id),
    candidateId: text(row.candidate_id),
    candidateRevision: Number(row.candidate_revision),
    status: text(row.status) as BrowserIngestDecisionRecord["status"],
    resultCode: text(row.result_code),
    opportunityId,
    currentOpportunityId,
    resolutionMismatch: Boolean(
      opportunityId && currentOpportunityId && opportunityId !== currentOpportunityId,
    ),
    sourcePostingId: optionalText(row.source_posting_id),
    applicationId: optionalText(row.application_id),
    applicationPlanId: optionalText(row.application_plan_id),
    matchId: optionalText(row.match_id),
    createdAt: timestamp(row.created_at),
    resolvedAt: optionalTimestamp(row.resolved_at),
  };
}

const decisionSelect = `
  select decision.*, coalesce(current_opportunity.id, opportunity.id) as current_opportunity_id
  from public.browser_ingest_decisions decision
  left join public.job_opportunities opportunity on opportunity.id=decision.opportunity_id
  left join public.job_opportunities current_opportunity on current_opportunity.id=opportunity.superseded_by_id
`;

async function sourceForCandidate(transaction: TransactionSql, candidateUrl: string) {
  const rows = await transaction`
    select source.id,source.company_id,source.base_url,policy.id as source_policy_id
    from public.sources source join public.source_policies policy on policy.id=source.source_policy_id
    where source.enabled and policy.status in ('ALLOWED','ALLOWED_WITH_LIMITS')
      and source.base_url is not null
  `;
  const normalized = canonicalUrl(candidateUrl).url;
  const matching = rows
    .map((row) => ({ row, base: canonicalUrl(text(row.base_url)).url }))
    .filter(({ base }) => normalized.startsWith(base))
    .sort((left, right) => right.base.length - left.base.length);
  return matching[0]?.row ?? null;
}

export async function selectBrowserCandidate(
  userId: string,
  candidateId: string,
  candidateRevision: number,
  idempotencyKey: string,
): Promise<BrowserIngestDecisionRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const candidateRows = await transaction`
      select candidate.* from public.page_job_candidates candidate
      join public.browser_scan_sessions scan on scan.id=candidate.scan_session_id
      where candidate.id=${candidateId}::uuid and candidate.user_id=${userId}::uuid
      for update
    `;
    const candidate = candidateRows[0];
    if (!candidate) throw new BrowserCompanionNotFoundError("Browser candidate was not found");
    if (Number(candidate.revision) !== candidateRevision)
      throw new BrowserCompanionConflictError("Browser candidate is stale");
    const existingRows = await transaction.unsafe(
      `${decisionSelect} where decision.user_id=$1::uuid and decision.candidate_id=$2::uuid`,
      [userId, candidateId],
    );
    if (existingRows[0]) return mapDecision(existingRows[0]);
    const [decision] = await transaction`
      insert into public.browser_ingest_decisions (user_id,candidate_id,candidate_revision,idempotency_key)
      values (${userId}::uuid,${candidateId}::uuid,${candidateRevision},${idempotencyKey})
      on conflict (user_id,idempotency_key) do update set updated_at=public.browser_ingest_decisions.updated_at
      returning *
    `;
    if (!decision)
      throw new BrowserCompanionConflictError("Browser selection could not be persisted");
    if (text(decision.candidate_id) !== candidateId) {
      const rows = await transaction.unsafe(`${decisionSelect} where decision.id=$1::uuid`, [
        text(decision.id),
      ]);
      if (!rows[0])
        throw new BrowserCompanionConflictError("Browser decision could not be retrieved");
      return mapDecision(rows[0]);
    }
    const exact = await transaction`
      select job.id as source_posting_id,membership.opportunity_id
      from public.jobs job join public.job_opportunity_postings membership
        on membership.job_id=job.id and membership.valid_to is null
      where regexp_replace(job.application_url,'[?#].*$','')=${text(candidate.job_url)}
      order by job.first_seen_at asc limit 1
    `;
    if (exact[0]) {
      await transaction`
        update public.browser_ingest_decisions set status='RESOLVED',result_code='EXACT_EXISTING_POSTING',
          source_posting_id=${text(exact[0].source_posting_id)}::uuid,
          opportunity_id=${text(exact[0].opportunity_id)}::uuid,resolved_at=now()
        where id=${text(decision.id)}::uuid
      `;
    } else {
      const source = await sourceForCandidate(transaction, text(candidate.job_url));
      if (!source) {
        await transaction`
          update public.browser_ingest_decisions set status='POLICY_BLOCKED',result_code='SOURCE_POLICY_NOT_ALLOWED',
            resolved_at=now() where id=${text(decision.id)}::uuid
        `;
      } else {
        const classification = classify(text(candidate.title));
        const contentHash = sha256({
          v: 1,
          url: text(candidate.job_url),
          title: text(candidate.title),
          description: text(candidate.description_excerpt),
          location: text(candidate.location_text),
        });
        const [job] = await transaction`
          insert into public.jobs (
            company_id,source_id,external_id,title,description,location,employment_type,role_family,
            experience_level,is_internship,is_new_grad,application_url,source_url,content_hash,raw_payload
          ) values (
            ${text(source.company_id)}::uuid,${text(source.id)}::uuid,${`browser:${contentHash}`},
            ${text(candidate.title)},${text(candidate.description_excerpt)},${text(candidate.location_text)},
            ${classification.employmentType}::public.employment_type,${classification.roleFamily}::public.role_family,
            ${classification.experienceLevel}::public.experience_level,${classification.isInternship},${classification.isNewGrad},
            ${text(candidate.job_url)},${text(candidate.job_url)},${contentHash},
            ${transaction.json({ browserCandidateFingerprint: text(candidate.candidate_fingerprint), ingestion: "M12" } as never)}
          ) on conflict (source_id,external_id) do update set last_seen_at=now(),updated_at=now()
          returning id
        `;
        if (!job) throw new BrowserCompanionConflictError("Browser posting could not be persisted");
        const [membership] = await transaction`
          select opportunity_id from public.job_opportunity_postings
          where job_id=${text(job.id)}::uuid and valid_to is null
        `;
        if (!membership)
          throw new BrowserCompanionConflictError("Browser posting opportunity was not created");
        await transaction`
          update public.browser_ingest_decisions set status='RESOLVED',result_code='NEW_SOURCE_POSTING',
            source_policy_id=${text(source.source_policy_id)}::uuid,source_posting_id=${text(job.id)}::uuid,
            opportunity_id=${text(membership.opportunity_id)}::uuid,resolved_at=now()
          where id=${text(decision.id)}::uuid
        `;
      }
    }
    await transaction`
      update public.browser_scan_sessions set selected_count=selected_count+1
      where id=${text(candidate.scan_session_id)}::uuid
    `;
    const rows = await transaction.unsafe(`${decisionSelect} where decision.id=$1::uuid`, [
      text(decision.id),
    ]);
    if (!rows[0])
      throw new BrowserCompanionConflictError("Browser decision could not be retrieved");
    return mapDecision(rows[0]);
  });
}

export async function getBrowserIngestDecision(
  userId: string,
  decisionId: string,
): Promise<BrowserIngestDecisionRecord> {
  const rows = await getDatabase().unsafe(
    `${decisionSelect} where decision.id=$1::uuid and decision.user_id=$2::uuid`,
    [decisionId, userId],
  );
  if (!rows[0]) throw new BrowserCompanionNotFoundError("Browser decision was not found");
  return mapDecision(rows[0]);
}

async function resolvedDecision(userId: string, decisionId: string) {
  const decision = await getBrowserIngestDecision(userId, decisionId);
  if (decision.status !== "RESOLVED" || !decision.opportunityId)
    throw new BrowserCompanionPolicyError("Selected candidate is not available for this action");
  return decision;
}

export async function addBrowserDecisionToApplication(
  userId: string,
  decisionId: string,
  input: { cycleKey: string; applicationUrlUsed?: string },
) {
  const decision = await resolvedDecision(userId, decisionId);
  const result = await createApplication(userId, {
    opportunityId: decision.opportunityId!,
    cycleKey: input.cycleKey,
    applicationUrlUsed: input.applicationUrlUsed ?? null,
  });
  await getDatabase()`update public.browser_ingest_decisions set application_id=${result.id}::uuid
    where id=${decisionId}::uuid and user_id=${userId}::uuid`;
  return result;
}

export async function addBrowserDecisionToPlan(
  userId: string,
  decisionId: string,
  input: { title: string; targetDate: string; timezone: string },
) {
  const decision = await resolvedDecision(userId, decisionId);
  const [opportunity] = await getDatabase()`select company_id from public.job_opportunities
    where id=${decision.opportunityId}::uuid`;
  if (!opportunity) throw new BrowserCompanionNotFoundError("Opportunity was not found");
  const result = await createApplicationPlan(userId, {
    companyId: text(opportunity.company_id),
    opportunityId: decision.opportunityId!,
    title: input.title,
    targetDate: input.targetDate,
    timezone: input.timezone,
  });
  await getDatabase()`update public.browser_ingest_decisions set application_plan_id=${result.id}::uuid
    where id=${decisionId}::uuid and user_id=${userId}::uuid`;
  return result;
}

export async function addBrowserDecisionToMatch(
  userId: string,
  decisionId: string,
  resumeVersionId: string,
) {
  const decision = await resolvedDecision(userId, decisionId);
  const result = await materializeResumeJobMatch(userId, resumeVersionId, decision.opportunityId!);
  await getDatabase()`update public.browser_ingest_decisions set match_id=${result.id}::uuid
    where id=${decisionId}::uuid and user_id=${userId}::uuid`;
  return result;
}
