import { createHash } from "node:crypto";

import { getDatabase } from "./index";
import { decryptResumeObject, encryptResumeObject } from "./resume-storage";

type Row = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
const iso = (value: unknown): string | null =>
  value == null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : null;
const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export const RESUME_PARSER_VERSION = 1;
export const MATCH_ALGORITHM_VERSION = "resume-coverage-v1";

export class ResumeValidationError extends Error {}
export class ResumeNotFoundError extends Error {}

export interface ResumeValidationResult {
  valid: boolean;
  code: string | null;
  pageCount: number | null;
  extractedText: string;
}

export function validateResumeBytes(
  bytes: Buffer,
  mediaType: "application/pdf" | "text/plain",
  limits: { maxBytes?: number; maxPages?: number; maxCharacters?: number } = {},
): ResumeValidationResult {
  const maxBytes = limits.maxBytes ?? 10 * 1024 * 1024;
  const maxPages = limits.maxPages ?? 50;
  const maxCharacters = limits.maxCharacters ?? 200_000;
  if (bytes.length < 1)
    return { valid: false, code: "EMPTY_DOCUMENT", pageCount: null, extractedText: "" };
  if (bytes.length > maxBytes)
    return { valid: false, code: "DOCUMENT_TOO_LARGE", pageCount: null, extractedText: "" };
  if (mediaType === "text/plain") {
    const extractedText = bytes.toString("utf8").replaceAll("\u0000", "");
    if (extractedText.length > maxCharacters)
      return {
        valid: false,
        code: "EXTRACTED_TEXT_LIMIT_EXCEEDED",
        pageCount: null,
        extractedText: "",
      };
    if (!extractedText.trim())
      return { valid: false, code: "NO_READABLE_TEXT", pageCount: null, extractedText: "" };
    return { valid: true, code: null, pageCount: null, extractedText };
  }
  const header = bytes.subarray(0, 5).toString("ascii");
  const body = bytes.toString("latin1");
  if (header !== "%PDF-" || !body.includes("%%EOF"))
    return { valid: false, code: "MALFORMED_PDF", pageCount: null, extractedText: "" };
  const pageCount = (body.match(/\/Type\s*\/Page(?:\s|\/|>>)/g) ?? []).length;
  if (pageCount > maxPages)
    return { valid: false, code: "PAGE_LIMIT_EXCEEDED", pageCount, extractedText: "" };
  const extractedText = [...body.matchAll(/\(([^()]*)\)\s*Tj/g)]
    .map((match) => match[1] ?? "")
    .join(" ");
  if (extractedText.length > maxCharacters)
    return { valid: false, code: "EXTRACTED_TEXT_LIMIT_EXCEEDED", pageCount, extractedText: "" };
  if (!extractedText.trim())
    return { valid: false, code: "NO_READABLE_TEXT", pageCount, extractedText: "" };
  return { valid: true, code: null, pageCount, extractedText };
}

export type EvidenceReviewStatus =
  | "EXTRACTED"
  | "CONFIRMED"
  | "REJECTED"
  | "SUPERSEDED"
  | "UNKNOWN";
export type MatchEligibility = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";

export interface ResumeDocumentRecord {
  id: string;
  userId: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
  status: string;
  createdAt: string;
}

export interface ResumeEvidenceRecord {
  id: string;
  userId: string;
  resumeVersionId: string | null;
  evidenceType: string;
  normalizedValue: Record<string, unknown>;
  source: string;
  reviewStatus: EvidenceReviewStatus;
  pageNumber: number | null;
  section: string | null;
  sourceSpan: string | null;
}

export interface ResumeMatchRecord {
  id: string;
  userId: string;
  resumeVersionId: string;
  opportunityId: string;
  requirementSetId: string;
  eligibility: MatchEligibility;
  score: number | null;
  reasonCodes: string[];
  algorithmVersion: string;
  generatedAt: string;
}

function documentRecord(row: Row): ResumeDocumentRecord {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    originalFilename: text(row.original_filename),
    mediaType: text(row.media_type),
    byteSize: Number(row.byte_size),
    contentHash: text(row.content_hash),
    status: text(row.status),
    createdAt: text(iso(row.created_at)),
  };
}

function evidenceRecord(row: Row): ResumeEvidenceRecord {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    resumeVersionId: row.resume_version_id == null ? null : text(row.resume_version_id),
    evidenceType: text(row.evidence_type),
    normalizedValue: (row.normalized_value ?? {}) as Record<string, unknown>,
    source: text(row.source),
    reviewStatus: text(row.review_status) as EvidenceReviewStatus,
    pageNumber: row.page_number == null ? null : Number(row.page_number),
    section: row.section == null ? null : text(row.section),
    sourceSpan: row.source_span == null ? null : text(row.source_span),
  };
}

function matchRecord(row: Row): ResumeMatchRecord {
  return {
    id: text(row.id),
    userId: text(row.user_id),
    resumeVersionId: text(row.resume_version_id),
    opportunityId: text(row.opportunity_id),
    requirementSetId: text(row.requirement_set_id),
    eligibility: text(row.eligibility) as MatchEligibility,
    score: row.score == null ? null : Number(row.score),
    reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes.map(String) : [],
    algorithmVersion: text(row.algorithm_version),
    generatedAt: text(iso(row.generated_at)),
  };
}

export function extractResumeSkills(input: string): string[] {
  const known = [
    "javascript",
    "typescript",
    "python",
    "java",
    "go",
    "rust",
    "react",
    "angular",
    "node.js",
    "sql",
    "pytorch",
    "tensorflow",
    "kubernetes",
    "aws",
  ];
  const lower = input.toLocaleLowerCase("en-US");
  return known.filter((skill) =>
    new RegExp(`(^|[^a-z0-9+#])${skill.replace(".", "\\.")}(?=$|[^a-z0-9+#])`, "i").test(lower),
  );
}

export function deterministicSkillCoverage(resumeText: string, requiredSkills: string[]) {
  const supported = new Set(extractResumeSkills(resumeText));
  const normalizedRequired = [
    ...new Set(requiredSkills.map((skill) => skill.trim().toLowerCase()).filter(Boolean)),
  ];
  const matched = normalizedRequired.filter((skill) => supported.has(skill));
  const unknown = normalizedRequired.filter((skill) => !supported.has(skill));
  return {
    matched,
    unknown,
    score: normalizedRequired.length
      ? Math.round((matched.length / normalizedRequired.length) * 100)
      : null,
    eligibility:
      normalizedRequired.length === 0
        ? ("UNKNOWN" as const)
        : unknown.length
          ? ("UNKNOWN" as const)
          : ("ELIGIBLE" as const),
    reasonCodes: unknown.length ? ["NO_EXPLICIT_EVIDENCE"] : ["ALL_EXPLICIT_SKILLS_SUPPORTED"],
  };
}

export async function createResumeDocument(
  userId: string,
  input: {
    originalFilename: string;
    mediaType: "application/pdf" | "text/plain";
    bytes: Buffer | string;
    storageObjectKey?: string;
  },
): Promise<ResumeDocumentRecord> {
  const bytes = typeof input.bytes === "string" ? Buffer.from(input.bytes, "utf8") : input.bytes;
  if (!/^[-\w .()]+\.(pdf|txt)$/i.test(input.originalFilename))
    throw new ResumeValidationError("Unsupported resume filename");
  const validation = validateResumeBytes(bytes, input.mediaType);
  if (!validation.valid) throw new ResumeValidationError(validation.code ?? "INVALID_DOCUMENT");
  const contentHash = hash(bytes);
  const key = input.storageObjectKey ?? `resume/${userId}/${contentHash}`;
  const encrypted = encryptResumeObject(userId, contentHash, bytes);
  return getDatabase().begin(async (tx) => {
    const [existing] =
      await tx`select * from public.resume_documents where user_id=${userId}::uuid and content_hash=${contentHash}`;
    if (existing) return documentRecord(existing);
    const [row] =
      await tx`insert into public.resume_documents (user_id,storage_object_key,original_filename,media_type,byte_size,content_hash,status,storage_key,storage_ciphertext,storage_nonce,storage_key_version)
      values (${userId}::uuid,${key},${input.originalFilename},${input.mediaType},${bytes.length},${contentHash},'READY',${encrypted.storageKey},${encrypted.ciphertext},${encrypted.nonce},${encrypted.keyVersion}) returning *`;
    if (!row) throw new ResumeValidationError("Resume could not be stored");
    return documentRecord(row);
  });
}

export async function readResumeObject(userId: string, documentId: string): Promise<Buffer> {
  const [row] =
    await getDatabase()`select storage_key,storage_ciphertext,storage_nonce,content_hash from public.resume_documents where id=${documentId}::uuid and user_id=${userId}::uuid and status <> 'DELETED'`;
  if (!row || !row.storage_key || !row.storage_ciphertext || !row.storage_nonce)
    throw new ResumeNotFoundError("Resume not found");
  return decryptResumeObject(userId, text(row.content_hash), {
    storageKey: text(row.storage_key),
    ciphertext: row.storage_ciphertext as Buffer,
    nonce: row.storage_nonce as Buffer,
  });
}

export async function deleteResumeDocument(userId: string, documentId: string): Promise<void> {
  await getDatabase()`update public.resume_documents set status='DELETED', deleted_at=coalesce(deleted_at, now()), storage_ciphertext=null, storage_nonce=null, storage_key=null where id=${documentId}::uuid and user_id=${userId}::uuid`;
}

export async function createResumeVersion(
  userId: string,
  documentId: string,
  extractedText: string,
) {
  if (extractedText.length > 200_000)
    throw new ResumeValidationError("Extracted resume text exceeds limits");
  return getDatabase().begin(async (tx) => {
    const [document] =
      await tx`select id from public.resume_documents where id=${documentId}::uuid and user_id=${userId}::uuid and deleted_at is null`;
    if (!document) throw new ResumeNotFoundError("Resume not found");
    const [latest] =
      await tx`select coalesce(max(version_number),0)::int as version from public.resume_versions where user_id=${userId}::uuid and document_id=${documentId}::uuid`;
    const version = Number(latest?.version ?? 0) + 1;
    const [rawRow] =
      await tx`insert into public.resume_versions (document_id,user_id,version_number,text_hash) values (${documentId}::uuid,${userId}::uuid,${version},${hash(extractedText)}) returning *`;
    const row = rawRow as Row | undefined;
    if (!row) throw new ResumeValidationError("Resume version could not be created");
    const skills = extractResumeSkills(extractedText);
    for (const skill of skills) {
      const evidenceHash = hash(`${text(row.id)}\0skill\0${skill}`);
      await tx`insert into public.candidate_evidence (user_id,resume_version_id,evidence_type,normalized_value,source,review_status,section,source_span,evidence_hash)
        values (${userId}::uuid,${text(row.id)}::uuid,'SKILL',${tx.json({ skill })},'DETERMINISTIC_PARSE','EXTRACTED','skills',${extractedText.slice(0, 500)},${evidenceHash}) on conflict (user_id,evidence_hash) do nothing`;
    }
    return {
      id: text(row.id),
      userId,
      documentId,
      versionNumber: version,
      textHash: text(row.text_hash),
      parserVersion: RESUME_PARSER_VERSION,
      skills,
    };
  });
}

export async function listResumeEvidence(
  userId: string,
  resumeVersionId?: string,
): Promise<ResumeEvidenceRecord[]> {
  const rows = resumeVersionId
    ? await getDatabase()`select * from public.candidate_evidence where user_id=${userId}::uuid and resume_version_id=${resumeVersionId}::uuid order by created_at,id`
    : await getDatabase()`select * from public.candidate_evidence where user_id=${userId}::uuid and superseded_at is null order by created_at,id`;
  return rows.map(evidenceRecord);
}

export async function reviewResumeEvidence(
  userId: string,
  evidenceId: string,
  disposition: "CONFIRMED" | "REJECTED",
  reasonCode?: string,
) {
  return getDatabase().begin(async (tx) => {
    const [row] =
      await tx`select * from public.candidate_evidence where id=${evidenceId}::uuid and user_id=${userId}::uuid`;
    if (!row) throw new ResumeNotFoundError("Evidence not found");
    await tx`insert into public.evidence_confirmations (evidence_id,user_id,disposition,reason_code) values (${evidenceId}::uuid,${userId}::uuid,${disposition},${reasonCode ?? null})`;
    await tx`update public.candidate_evidence set review_status=${disposition}::public.evidence_review_status where id=${evidenceId}::uuid and user_id=${userId}::uuid`;
    return evidenceRecord({ ...row, review_status: disposition });
  });
}

export async function correctResumeEvidence(
  userId: string,
  evidenceId: string,
  normalizedValue: Record<string, unknown>,
  reasonCode?: string,
) {
  return getDatabase().begin(async (tx) => {
    const [rawOriginal] =
      await tx`select * from public.candidate_evidence where id=${evidenceId}::uuid and user_id=${userId}::uuid and superseded_at is null`;
    const original = rawOriginal as Row | undefined;
    if (!original) throw new ResumeNotFoundError("Evidence not found");
    const [latest] =
      await tx`select coalesce(max(revision),0)::int as revision from public.candidate_evidence where user_id=${userId}::uuid and coalesce(parent_evidence_id,id)=coalesce(${evidenceId}::uuid,${evidenceId}::uuid)`;
    const revision = Number(latest?.revision ?? 0) + 1;
    const evidenceHash = hash(`${evidenceId}\0${revision}\0${JSON.stringify(normalizedValue)}`);
    const [row] = await tx`insert into public.candidate_evidence
      (user_id,resume_version_id,evidence_type,normalized_value,source,review_status,page_number,section,source_span,parser_version,evidence_hash,revision,parent_evidence_id)
      values (${userId}::uuid,${nullableText(original.resume_version_id)},${text(original.evidence_type)},${tx.json(normalizedValue as never)},'USER_CORRECTED','CONFIRMED',${typeof original.page_number === "number" ? original.page_number : null},${nullableText(original.section)},${nullableText(original.source_span)},${Number(original.parser_version ?? 1)},${evidenceHash},${revision},${evidenceId}::uuid) returning *`;
    if (!row) throw new ResumeValidationError("Evidence correction could not be created");
    await tx`update public.candidate_evidence set superseded_at=now(), review_status='SUPERSEDED' where id=${evidenceId}::uuid and user_id=${userId}::uuid`;
    await tx`insert into public.evidence_confirmations (evidence_id,user_id,disposition,replacement_evidence_id,reason_code) values (${evidenceId}::uuid,${userId}::uuid,'SUPERSEDED',${text(row.id)}::uuid,${reasonCode ?? "USER_CORRECTION"})`;
    return evidenceRecord(row as Row);
  });
}

export async function materializeRequirementSet(opportunityId: string) {
  return getDatabase().begin(async (tx) => {
    const [opp] =
      await tx`select id, role_family::text as role_family, experience_level::text as experience_level from public.job_opportunities where id=${opportunityId}::uuid`;
    if (!opp) throw new ResumeNotFoundError("Opportunity not found");
    const requirementRows =
      await tx`select requirement_type::text as type, normalized_value, explicit from public.job_requirements r join public.job_opportunity_postings p on p.job_id=r.job_id where p.opportunity_id=${opportunityId}::uuid and p.valid_to is null order by r.id`;
    const requirements = requirementRows.map((value) => {
      const item = value as Row;
      return {
        type: text(item.type),
        normalized_value: item.normalized_value as object,
        explicit: Boolean(item.explicit),
      };
    });
    const roleFamily = text(opp.role_family);
    const experienceLevel = text(opp.experience_level);
    const [row] =
      await tx`insert into public.job_requirement_sets (opportunity_id,version,requirements,source_version,algorithm_version)
      values (${opportunityId}::uuid,coalesce((select max(version)+1 from public.job_requirement_sets where opportunity_id=${opportunityId}::uuid),1),${tx.json({ roleFamily, experienceLevel, requirements } as never)},'canonical-job-requirements','requirements-v1')
      on conflict (opportunity_id,version) do nothing returning *`;
    if (row) return row;
    const [latest] =
      await tx`select * from public.job_requirement_sets where opportunity_id=${opportunityId}::uuid order by version desc limit 1`;
    return latest;
  });
}

export async function materializeResumeJobMatch(
  userId: string,
  resumeVersionId: string,
  opportunityId: string,
): Promise<ResumeMatchRecord> {
  return getDatabase().begin(async (tx) => {
    const [version] =
      await tx`select id from public.resume_versions where id=${resumeVersionId}::uuid and user_id=${userId}::uuid`;
    if (!version) throw new ResumeNotFoundError("Resume version not found");
    const requirementSet = await materializeRequirementSet(opportunityId);
    if (!requirementSet)
      throw new ResumeValidationError("Requirement set could not be materialized");
    const [opp] =
      await tx`select status::text as status, experience_level::text as experience_level, role_family::text as role_family from public.job_opportunities where id=${opportunityId}::uuid`;
    const evidence =
      await tx`select normalized_value,review_status from public.candidate_evidence where user_id=${userId}::uuid and resume_version_id=${resumeVersionId}::uuid and review_status <> 'REJECTED'`;
    const skills = new Set(
      evidence
        .filter((e) => e.evidence_type === "SKILL")
        .map((e) => String((e.normalized_value as Row).skill).toLowerCase()),
    );
    const req = (requirementSet.requirements ?? {}) as Row;
    const required = Array.isArray(req.requirements) ? req.requirements : [];
    const skillReqs = required
      .filter((r: Row) => r.type === "SKILL" && r.explicit)
      .map((r: Row) => {
        const value = (r.normalized_value as Row).skill ?? (r.normalized_value as Row).value;
        return typeof value === "string" ? value.toLowerCase() : "";
      })
      .filter(Boolean);
    const missing = skillReqs.filter((s: string) => !skills.has(s));
    const unknown = skillReqs.length === 0;
    const eligibility: MatchEligibility =
      opp?.status !== "ACTIVE"
        ? "NOT_ELIGIBLE"
        : unknown
          ? "UNKNOWN"
          : missing.length
            ? "UNKNOWN"
            : "ELIGIBLE";
    const score = skillReqs.length
      ? Math.round(((skillReqs.length - missing.length) / skillReqs.length) * 100)
      : null;
    const reasons =
      opp?.status !== "ACTIVE"
        ? ["OPPORTUNITY_NOT_ACTIVE"]
        : unknown
          ? ["REQUIREMENTS_UNKNOWN"]
          : missing.length
            ? ["REQUIREMENTS_UNSUPPORTED"]
            : ["ALL_EXPLICIT_SKILLS_SUPPORTED"];
    const [rawRow] =
      await tx`insert into public.resume_job_matches (user_id,resume_version_id,opportunity_id,requirement_set_id,eligibility,score,reason_codes,algorithm_version,idempotency_key)
      values (${userId}::uuid,${resumeVersionId}::uuid,${opportunityId}::uuid,${text(requirementSet.id)}::uuid,${eligibility}::public.match_eligibility,${score},${tx.array(reasons)},${MATCH_ALGORITHM_VERSION},${`${resumeVersionId}:${opportunityId}:${text(requirementSet.id)}:${MATCH_ALGORITHM_VERSION}`})
      on conflict (user_id,resume_version_id,opportunity_id,requirement_set_id,algorithm_version) do update set generated_at=now() returning *`;
    const row = rawRow as Row | undefined;
    if (!row) throw new ResumeValidationError("Match could not be materialized");
    for (const key of skillReqs) {
      const matched = skills.has(key);
      await tx`insert into public.match_evidence (match_id,user_id,requirement_key,relation,reason_code,citation)
        values (${text(row.id)}::uuid,${userId}::uuid,${key},${matched ? "SATISFIES" : "UNKNOWN"}::public.match_relation,${matched ? "EXPLICIT_SKILL_EVIDENCE" : "NO_EXPLICIT_EVIDENCE"},${tx.json({ resumeVersionId })}) on conflict (match_id,requirement_key) do nothing`;
    }
    return matchRecord(row);
  });
}
