import type { Sql, TransactionSql } from "postgres";

import { getDatabase } from "./index";

type QuerySql = Sql | TransactionSql;
type Row = Record<string, unknown>;

export class OpportunityNotFoundError extends Error {}
export class OpportunityConflictError extends Error {}

export interface OpportunityRecord {
  id: string;
  company: { id: string; name: string; slug: string };
  title: string;
  normalizedTitle: string;
  roleFamily: string;
  experienceLevel: string;
  employmentType: string;
  isInternship: boolean;
  isNewGrad: boolean;
  season: string | null;
  graduationYears: number[];
  location: string;
  workplaceMode: string;
  applicationUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  publishedAt: string | null;
  deadlineAt: string | null;
  lifecycleStatus: "OPEN" | "CLOSED" | "UNKNOWN";
  status: "ACTIVE" | "SUPERSEDED";
  supersededById: string | null;
  sourceCount: number;
  mergeConfidence: number;
  canonicalizationVersion: number;
  lifecycleReason: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunitySourcePostingRecord {
  id: string;
  source: { id: string; name: string; type: string; provider: string };
  externalId: string;
  title: string;
  description: string;
  location: string;
  employmentType: string;
  roleFamily: string;
  experienceLevel: string;
  isInternship: boolean;
  isNewGrad: boolean;
  season: string | null;
  graduationYears: number[];
  applicationUrl: string;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  sourceContentHash: string;
  sourceContentVersion: number;
  derivationHash: string;
  derivationVersion: number;
  membership: {
    method: string;
    pinned: boolean;
    validFrom: string;
  };
  authority: {
    level: string;
    reviewed: boolean;
    capabilityVersion: number;
  };
  skills: Array<{ canonicalName: string | null; rawMention: string; requirement: string }>;
  constraints: Array<{ type: string; value: Record<string, unknown>; evidence: string }>;
}

export interface OpportunityDetailRecord extends OpportunityRecord {
  sources: OpportunitySourcePostingRecord[];
  resolutionHistory: Array<{
    id: string;
    action: string;
    outcome: string;
    decisionSource: string;
    reasonCodes: string[];
    algorithmVersion: number;
    fromOpportunityId: string | null;
    toOpportunityId: string | null;
    createdAt: string;
  }>;
}

export interface OpportunityReviewRecord {
  id: string;
  companyId: string;
  leftJobId: string;
  rightJobId: string;
  status: "PENDING" | "RESOLVED" | "DISMISSED";
  algorithmVersion: number;
  reasonCodes: string[];
  evidence: Record<string, unknown>;
  resolutionDecisionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface OpportunityListOptions {
  companyId?: string;
  roleFamily?: string;
  earlyCareerOnly?: boolean;
  lifecycleStatus?: "OPEN" | "CLOSED" | "UNKNOWN";
  includeSuperseded?: boolean;
  limit?: number;
  cursor?: string;
}

export interface OpportunityPage {
  items: OpportunityRecord[];
  nextCursor: string | null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected database text");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function integer(value: unknown): number {
  return Number(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number) : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapOpportunity(row: Row): OpportunityRecord {
  return {
    id: text(row.id),
    company: {
      id: text(row.company_id),
      name: text(row.company_name),
      slug: text(row.company_slug),
    },
    title: text(row.canonical_title),
    normalizedTitle: text(row.normalized_title),
    roleFamily: text(row.role_family),
    experienceLevel: text(row.experience_level),
    employmentType: text(row.employment_type),
    isInternship: Boolean(row.is_internship),
    isNewGrad: Boolean(row.is_new_grad),
    season: nullableText(row.season),
    graduationYears: numberArray(row.graduation_years),
    location: text(row.location_summary),
    workplaceMode: text(row.workplace_mode),
    applicationUrl: nullableText(row.canonical_application_url),
    firstSeenAt: timestamp(row.earliest_first_seen_at),
    lastSeenAt: timestamp(row.latest_last_seen_at),
    publishedAt: nullableTimestamp(row.published_at),
    deadlineAt: nullableTimestamp(row.deadline_at),
    lifecycleStatus: text(row.lifecycle_status) as OpportunityRecord["lifecycleStatus"],
    status: text(row.status) as OpportunityRecord["status"],
    supersededById: nullableText(row.superseded_by_id),
    sourceCount: integer(row.source_count),
    mergeConfidence: Number(row.merge_confidence),
    canonicalizationVersion: integer(row.canonicalization_version),
    lifecycleReason: object(row.lifecycle_reason),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

const opportunitySelect = `
  select opportunity.*, company.canonical_name as company_name,
    company.slug as company_slug, canonical.title as canonical_title,
    count(membership.id) filter (where membership.valid_to is null)::int as source_count
  from public.job_opportunities opportunity
  join public.companies company on company.id = opportunity.company_id
  join public.jobs canonical on canonical.id = opportunity.canonical_source_posting_id
  left join public.job_opportunity_postings membership
    on membership.opportunity_id = opportunity.id
`;

function encodeCursor(value: { at: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value?: string): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("at" in parsed) ||
      !("id" in parsed) ||
      typeof parsed.at !== "string" ||
      typeof parsed.id !== "string"
    ) {
      throw new TypeError("Invalid opportunity cursor");
    }
    if (Number.isNaN(Date.parse(parsed.at))) throw new TypeError("Invalid opportunity cursor");
    return { at: parsed.at, id: parsed.id };
  } catch {
    throw new OpportunityConflictError("Opportunity cursor is invalid");
  }
}

export async function listOpportunities(
  options: OpportunityListOptions = {},
): Promise<OpportunityPage> {
  const sql = getDatabase();
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const cursor = decodeCursor(options.cursor);
  const rows = await sql.unsafe(
    `${opportunitySelect}
     where ($1::uuid is null or opportunity.company_id = $1::uuid)
       and ($2::text is null or opportunity.role_family::text = $2::text)
       and ($3::boolean = false or opportunity.is_internship or opportunity.is_new_grad)
       and ($4::text is null or opportunity.lifecycle_status::text = $4::text)
       and ($5::boolean = true or opportunity.status = 'ACTIVE')
       and ($6::timestamptz is null or
         (opportunity.latest_last_seen_at, opportunity.id) < ($6::timestamptz, $7::uuid))
     group by opportunity.id, company.id, canonical.id
     order by opportunity.latest_last_seen_at desc, opportunity.id desc
     limit $8`,
    [
      options.companyId ?? null,
      options.roleFamily ?? null,
      options.earlyCareerOnly ?? false,
      options.lifecycleStatus ?? null,
      options.includeSuperseded ?? false,
      cursor?.at ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapOpportunity);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ at: last.lastSeenAt, id: last.id }) : null,
  };
}

async function getOpportunityWith(
  sql: QuerySql,
  id: string,
  includeSuperseded = true,
): Promise<OpportunityRecord | null> {
  const rows = await sql.unsafe(
    `${opportunitySelect}
     where opportunity.id = $1::uuid
       and ($2::boolean or opportunity.status = 'ACTIVE')
     group by opportunity.id, company.id, canonical.id limit 1`,
    [id, includeSuperseded],
  );
  return rows[0] ? mapOpportunity(rows[0]) : null;
}

export async function getOpportunity(id: string, includeSuperseded = true) {
  return getOpportunityWith(getDatabase(), id, includeSuperseded);
}

export async function listOpportunitySources(
  opportunityId: string,
): Promise<OpportunitySourcePostingRecord[]> {
  const sql = getDatabase();
  const rows = await sql`
    select job.*, source.id as source_record_id, source.name as source_name,
      source.source_type::text, source.provider, membership.membership_method::text,
      membership.pinned, membership.valid_from,
      coalesce(capability.authority::text, 'UNREVIEWED') as authority,
      coalesce(capability.reviewed, false) as authority_reviewed,
      coalesce(capability.capability_version, 1) as capability_version,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'canonicalName', skill.canonical_name,
          'rawMention', job_skill.raw_mention,
          'requirement', job_skill.requirement::text
        ) order by coalesce(skill.canonical_name, job_skill.raw_mention))
        from public.job_skills job_skill
        left join public.skills skill on skill.id = job_skill.skill_id
        where job_skill.job_id = job.id
      ), '[]'::jsonb) as skills,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', constraint_row.constraint_type::text,
          'value', constraint_row.value,
          'evidence', constraint_row.raw_evidence
        ) order by constraint_row.constraint_type::text)
        from public.job_constraints constraint_row where constraint_row.job_id = job.id
      ), '[]'::jsonb) as constraints
    from public.job_opportunity_postings membership
    join public.jobs job on job.id = membership.job_id
    join public.sources source on source.id = job.source_id
    left join public.source_job_capabilities capability on capability.source_id = source.id
    where membership.opportunity_id = ${opportunityId}::uuid and membership.valid_to is null
    order by job.first_seen_at, job.id
  `;
  return rows.map((row) => ({
    id: text(row.id),
    source: {
      id: text(row.source_record_id),
      name: text(row.source_name),
      type: text(row.source_type),
      provider: text(row.provider),
    },
    externalId: text(row.external_id),
    title: text(row.title),
    description: text(row.description),
    location: text(row.location),
    employmentType: text(row.employment_type),
    roleFamily: text(row.role_family),
    experienceLevel: text(row.experience_level),
    isInternship: Boolean(row.is_internship),
    isNewGrad: Boolean(row.is_new_grad),
    season: nullableText(row.season),
    graduationYears: numberArray(row.graduation_years),
    applicationUrl: text(row.application_url),
    sourceUrl: text(row.source_url),
    firstSeenAt: timestamp(row.first_seen_at),
    lastSeenAt: timestamp(row.last_seen_at),
    publishedAt: nullableTimestamp(row.published_at),
    closedAt: nullableTimestamp(row.closed_at),
    sourceContentHash: text(row.source_content_hash),
    sourceContentVersion: integer(row.source_content_version),
    derivationHash: text(row.derivation_hash),
    derivationVersion: integer(row.derivation_version),
    membership: {
      method: text(row.membership_method),
      pinned: Boolean(row.pinned),
      validFrom: timestamp(row.valid_from),
    },
    authority: {
      level: text(row.authority),
      reviewed: Boolean(row.authority_reviewed),
      capabilityVersion: integer(row.capability_version),
    },
    skills: Array.isArray(row.skills)
      ? (row.skills as OpportunitySourcePostingRecord["skills"])
      : [],
    constraints: Array.isArray(row.constraints)
      ? (row.constraints as OpportunitySourcePostingRecord["constraints"])
      : [],
  }));
}

export async function getOpportunityDetail(id: string): Promise<OpportunityDetailRecord | null> {
  const sql = getDatabase();
  const opportunity = await getOpportunityWith(sql, id);
  if (!opportunity) return null;
  const [sources, decisions] = await Promise.all([
    listOpportunitySources(id),
    sql`
      select id, action::text, outcome::text, decision_source::text, reason_codes,
        algorithm_version, from_opportunity_id, to_opportunity_id, created_at
      from public.job_resolution_decisions
      where from_opportunity_id = ${id}::uuid or to_opportunity_id = ${id}::uuid
      order by created_at desc, id desc
    `,
  ]);
  return {
    ...opportunity,
    sources,
    resolutionHistory: decisions.map((row) => ({
      id: text(row.id),
      action: text(row.action),
      outcome: text(row.outcome),
      decisionSource: text(row.decision_source),
      reasonCodes: stringArray(row.reason_codes),
      algorithmVersion: integer(row.algorithm_version),
      fromOpportunityId: nullableText(row.from_opportunity_id),
      toOpportunityId: nullableText(row.to_opportunity_id),
      createdAt: timestamp(row.created_at),
    })),
  };
}

export async function resolveOpportunityForJob(jobId: string): Promise<OpportunityRecord | null> {
  const sql = getDatabase();
  const [row] = await sql`
    select opportunity_id from public.job_opportunity_postings
    where job_id = ${jobId}::uuid and valid_to is null
  `;
  return row ? getOpportunityWith(sql, text(row.opportunity_id)) : null;
}

function mapOpportunityReview(row: Row): OpportunityReviewRecord {
  return {
    id: text(row.id),
    companyId: text(row.company_id),
    leftJobId: text(row.left_job_id),
    rightJobId: text(row.right_job_id),
    status: text(row.status) as OpportunityReviewRecord["status"],
    algorithmVersion: integer(row.algorithm_version),
    reasonCodes: stringArray(row.reason_codes),
    evidence: object(row.evidence),
    resolutionDecisionId: nullableText(row.resolution_decision_id),
    createdAt: timestamp(row.created_at),
    resolvedAt: nullableTimestamp(row.resolved_at),
  };
}

export async function listOpportunityReviews(
  status: "PENDING" | "RESOLVED" | "DISMISSED" = "PENDING",
  limit = 50,
): Promise<OpportunityReviewRecord[]> {
  const sql = getDatabase();
  const rows = await sql`
    select * from public.job_resolution_reviews where status = ${status}
    order by created_at, id limit ${Math.min(Math.max(limit, 1), 100)}
  `;
  return rows.map(mapOpportunityReview);
}

async function existingManualDecision(sql: QuerySql, idempotencyKey: string): Promise<Row | null> {
  const [row] = await sql`
    select id, action::text, subject_job_id, from_opportunity_id, to_opportunity_id
    from public.job_resolution_decisions
    where decision_source = 'MANUAL' and idempotency_key = ${idempotencyKey}
  `;
  return row ?? null;
}

export async function mergeOpportunities(input: {
  winnerId: string;
  loserId: string;
  reason: string;
  idempotencyKey: string;
  actorUserId: string;
  reviewId?: string;
}): Promise<OpportunityRecord> {
  if (input.winnerId === input.loserId) throw new OpportunityConflictError("Merge targets differ");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const prior = await existingManualDecision(transaction, input.idempotencyKey);
    if (prior) {
      if (
        text(prior.action) !== "MANUAL_MERGE" ||
        nullableText(prior.from_opportunity_id) !== input.loserId ||
        nullableText(prior.to_opportunity_id) !== input.winnerId
      ) {
        throw new OpportunityConflictError("Idempotency key belongs to another correction");
      }
      const existing = await getOpportunityWith(transaction, input.winnerId);
      if (!existing) throw new OpportunityNotFoundError("Opportunity not found");
      return existing;
    }
    const rows = await transaction`
      select id, company_id, status::text from public.job_opportunities
      where id in (${input.winnerId}::uuid, ${input.loserId}::uuid)
      order by id for update
    `;
    if (rows.length !== 2) throw new OpportunityNotFoundError("Opportunity not found");
    const winner = rows.find((row) => text(row.id) === input.winnerId);
    const loser = rows.find((row) => text(row.id) === input.loserId);
    if (!winner || !loser) throw new OpportunityNotFoundError("Opportunity not found");
    if (text(winner.company_id) !== text(loser.company_id)) {
      throw new OpportunityConflictError("Cross-company opportunities cannot be merged");
    }
    if (text(winner.status) !== "ACTIVE" || text(loser.status) !== "ACTIVE") {
      throw new OpportunityConflictError("Only active opportunities can be merged");
    }
    if (input.reviewId) {
      const [review] = await transaction`
        select review.id from public.job_resolution_reviews review
        join public.job_opportunity_postings left_membership
          on left_membership.job_id = review.left_job_id
         and left_membership.valid_to is null
        join public.job_opportunity_postings right_membership
          on right_membership.job_id = review.right_job_id
         and right_membership.valid_to is null
        where review.id = ${input.reviewId}::uuid and review.status = 'PENDING'
          and left_membership.opportunity_id in (
            ${input.winnerId}::uuid, ${input.loserId}::uuid
          )
          and right_membership.opportunity_id in (
            ${input.winnerId}::uuid, ${input.loserId}::uuid
          )
          and left_membership.opportunity_id <> right_membership.opportunity_id
        for update of review
      `;
      if (!review) throw new OpportunityConflictError("Review no longer matches merge targets");
    }
    await transaction`select pg_advisory_xact_lock(hashtextextended(${`opportunity-company:${text(winner.company_id)}`}, 0))`;
    const [decision] = await transaction`
      insert into public.job_resolution_decisions (
        company_id, from_opportunity_id, to_opportunity_id, action, outcome,
        decision_source, algorithm_version, reason_codes, evidence, manual_reason,
        idempotency_key, actor_kind, actor_user_id
      ) values (
        ${text(winner.company_id)}::uuid, ${input.loserId}::uuid, ${input.winnerId}::uuid,
        'MANUAL_MERGE', 'MATCH', 'MANUAL', 1, array['MANUAL_EXACT_CORRECTION'],
        '{}', ${input.reason}, ${input.idempotencyKey}, 'ADMIN', ${input.actorUserId}::uuid
      ) returning id
    `;
    if (!decision) throw new Error("Manual merge decision was not persisted");
    await transaction`
      update public.job_opportunity_postings set pinned = true
      where opportunity_id = ${input.winnerId}::uuid and valid_to is null
    `;
    const memberships = await transaction`
      update public.job_opportunity_postings set valid_to = now()
      where opportunity_id = ${input.loserId}::uuid and valid_to is null
      returning job_id, company_id
    `;
    for (const membership of memberships) {
      await transaction`
        insert into public.job_opportunity_postings (
          opportunity_id, job_id, company_id, decision_id, membership_method, pinned
        ) values (
          ${input.winnerId}::uuid, ${text(membership.job_id)}::uuid,
          ${text(membership.company_id)}::uuid, ${text(decision.id)}::uuid,
          'MANUAL_MERGE', true
        )
      `;
    }
    await transaction`
      update public.job_opportunities set status = 'SUPERSEDED',
        superseded_by_id = ${input.winnerId}::uuid
      where id = ${input.loserId}::uuid
    `;
    if (input.reviewId) {
      await transaction`
        update public.job_resolution_reviews set status = 'RESOLVED', resolved_at = now(),
          resolution_decision_id = ${text(decision.id)}::uuid
        where id = ${input.reviewId}::uuid and status = 'PENDING'
      `;
    }
    await transaction`select public.recompute_job_opportunity(${input.winnerId}::uuid)`;
    await transaction`
      insert into public.audit_events (
        actor_kind, actor_user_id, action, resource_type, resource_id, outcome, metadata
      ) values (
        'ADMIN', ${input.actorUserId}::uuid, 'OPPORTUNITY_MERGED', 'JOB_OPPORTUNITY',
        ${input.winnerId}::uuid, 'SUCCEEDED',
        ${transaction.json({ loserId: input.loserId, decisionId: text(decision.id) } as never)}
      )
    `;
    await transaction`
      insert into public.product_events (
        user_id, event_type, source, entity_type, entity_id, context
      ) values (
        ${input.actorUserId}::uuid, 'OPPORTUNITY_MERGED', 'SERVER', 'OPPORTUNITY',
        ${input.winnerId}::uuid,
        ${transaction.json({ loserId: input.loserId, canonicalizationVersion: 1 } as never)}
      )
    `;
    const merged = await getOpportunityWith(transaction, input.winnerId);
    if (!merged) throw new Error("Merged opportunity could not be read");
    return merged;
  });
}

export async function splitOpportunity(input: {
  opportunityId: string;
  sourcePostingId: string;
  reason: string;
  idempotencyKey: string;
  actorUserId: string;
}): Promise<OpportunityRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const prior = await existingManualDecision(transaction, input.idempotencyKey);
    if (prior) {
      if (
        text(prior.action) !== "MANUAL_SPLIT" ||
        nullableText(prior.subject_job_id) !== input.sourcePostingId ||
        nullableText(prior.from_opportunity_id) !== input.opportunityId
      ) {
        throw new OpportunityConflictError("Idempotency key belongs to another correction");
      }
      const [membership] = await transaction`
        select opportunity_id from public.job_opportunity_postings
        where job_id = ${input.sourcePostingId}::uuid and valid_to is null
      `;
      if (!membership) throw new OpportunityNotFoundError("Source posting not found");
      const resolved = await getOpportunityWith(transaction, text(membership.opportunity_id));
      if (!resolved) throw new OpportunityNotFoundError("Opportunity not found");
      return resolved;
    }
    const [membership] = await transaction`
      select membership.*, job.company_id, origin.id as origin_opportunity_id
      from public.job_opportunity_postings membership
      join public.jobs job on job.id = membership.job_id
      join public.job_opportunities origin on origin.origin_job_id = membership.job_id
      where membership.opportunity_id = ${input.opportunityId}::uuid
        and membership.job_id = ${input.sourcePostingId}::uuid
        and membership.valid_to is null
      for update of membership, origin
    `;
    if (!membership) throw new OpportunityNotFoundError("Active source membership not found");
    const targetId = text(membership.origin_opportunity_id);
    await transaction`select pg_advisory_xact_lock(hashtextextended(${`opportunity-company:${text(membership.company_id)}`}, 0))`;
    const [decision] = await transaction`
      insert into public.job_resolution_decisions (
        company_id, subject_job_id, from_opportunity_id, to_opportunity_id,
        action, outcome, decision_source, algorithm_version, reason_codes,
        evidence, manual_reason, idempotency_key, actor_kind, actor_user_id
      ) values (
        ${text(membership.company_id)}::uuid, ${input.sourcePostingId}::uuid,
        ${input.opportunityId}::uuid, ${targetId}::uuid, 'MANUAL_SPLIT', 'NO_MATCH',
        'MANUAL', 1, array['MANUAL_FALSE_MERGE_CORRECTION'], '{}', ${input.reason},
        ${input.idempotencyKey}, 'ADMIN', ${input.actorUserId}::uuid
      ) returning id
    `;
    if (!decision) throw new Error("Manual split decision was not persisted");
    await transaction`
      update public.job_opportunity_postings set valid_to = now()
      where id = ${text(membership.id)}::uuid
    `;
    await transaction`
      update public.job_opportunities set status = 'ACTIVE', superseded_by_id = null
      where id = ${targetId}::uuid
    `;
    await transaction`
      insert into public.job_opportunity_postings (
        opportunity_id, job_id, company_id, decision_id, membership_method, pinned
      ) values (
        ${targetId}::uuid, ${input.sourcePostingId}::uuid,
        ${text(membership.company_id)}::uuid, ${text(decision.id)}::uuid,
        'MANUAL_SPLIT', true
      )
    `;
    await transaction`select public.recompute_job_opportunity(${targetId}::uuid)`;
    if (targetId !== input.opportunityId) {
      const [remaining] = await transaction`
        select count(*)::int as count from public.job_opportunity_postings
        where opportunity_id = ${input.opportunityId}::uuid and valid_to is null
      `;
      if (remaining && integer(remaining.count) > 0) {
        await transaction`select public.recompute_job_opportunity(${input.opportunityId}::uuid)`;
      } else {
        await transaction`
          update public.job_opportunities set status = 'SUPERSEDED',
            superseded_by_id = ${targetId}::uuid
          where id = ${input.opportunityId}::uuid and id <> ${targetId}::uuid
        `;
      }
    }
    await transaction`
      insert into public.audit_events (
        actor_kind, actor_user_id, action, resource_type, resource_id, outcome, metadata
      ) values (
        'ADMIN', ${input.actorUserId}::uuid, 'OPPORTUNITY_SPLIT', 'JOB_OPPORTUNITY',
        ${targetId}::uuid, 'SUCCEEDED',
        ${transaction.json({
          fromOpportunityId: input.opportunityId,
          sourcePostingId: input.sourcePostingId,
          decisionId: text(decision.id),
        } as never)}
      )
    `;
    await transaction`
      insert into public.product_events (
        user_id, event_type, source, entity_type, entity_id, context
      ) values (
        ${input.actorUserId}::uuid, 'OPPORTUNITY_SPLIT', 'SERVER', 'OPPORTUNITY',
        ${targetId}::uuid,
        ${transaction.json({
          fromOpportunityId: input.opportunityId,
          sourcePostingId: input.sourcePostingId,
          canonicalizationVersion: 1,
        } as never)}
      )
    `;
    const split = await getOpportunityWith(transaction, targetId);
    if (!split) throw new Error("Split opportunity could not be read");
    return split;
  });
}

export async function dismissOpportunityReview(input: {
  reviewId: string;
  reason: string;
  idempotencyKey: string;
  actorUserId: string;
}): Promise<OpportunityReviewRecord> {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const prior = await existingManualDecision(transaction, input.idempotencyKey);
    if (prior) {
      if (text(prior.action) !== "MANUAL_NO_MATCH") {
        throw new OpportunityConflictError("Idempotency key belongs to another correction");
      }
      const [existing] = await transaction`
        select * from public.job_resolution_reviews where id = ${input.reviewId}::uuid
      `;
      if (!existing) throw new OpportunityNotFoundError("Opportunity review not found");
      if (nullableText(prior.subject_job_id) !== text(existing.left_job_id)) {
        throw new OpportunityConflictError("Idempotency key belongs to another correction");
      }
      return mapOpportunityReview(existing);
    }
    const [review] = await transaction`
      select review.*, left_membership.opportunity_id as left_opportunity_id,
        right_membership.opportunity_id as right_opportunity_id
      from public.job_resolution_reviews review
      join public.job_opportunity_postings left_membership
        on left_membership.job_id = review.left_job_id and left_membership.valid_to is null
      join public.job_opportunity_postings right_membership
        on right_membership.job_id = review.right_job_id and right_membership.valid_to is null
      where review.id = ${input.reviewId}::uuid and review.status = 'PENDING'
      for update of review, left_membership, right_membership
    `;
    if (!review) throw new OpportunityNotFoundError("Pending opportunity review not found");
    if (text(review.left_opportunity_id) === text(review.right_opportunity_id)) {
      throw new OpportunityConflictError("Merged postings must be split before marking no-match");
    }
    const [decision] = await transaction`
      insert into public.job_resolution_decisions (
        company_id, subject_job_id, from_opportunity_id, to_opportunity_id,
        action, outcome, decision_source, algorithm_version, reason_codes,
        evidence, manual_reason, idempotency_key, actor_kind, actor_user_id
      ) values (
        ${text(review.company_id)}::uuid, ${text(review.left_job_id)}::uuid,
        ${text(review.left_opportunity_id)}::uuid, ${text(review.right_opportunity_id)}::uuid,
        'MANUAL_NO_MATCH', 'NO_MATCH', 'MANUAL', 1,
        array['MANUAL_DISTINCT_OPPORTUNITIES'], '{}', ${input.reason},
        ${input.idempotencyKey}, 'ADMIN', ${input.actorUserId}::uuid
      ) returning id
    `;
    if (!decision) throw new Error("Manual no-match decision was not persisted");
    await transaction`
      update public.job_opportunity_postings set pinned = true
      where job_id in (${text(review.left_job_id)}::uuid, ${text(review.right_job_id)}::uuid)
        and valid_to is null
    `;
    const [updated] = await transaction`
      update public.job_resolution_reviews set status = 'DISMISSED', resolved_at = now(),
        resolution_decision_id = ${text(decision.id)}::uuid
      where id = ${input.reviewId}::uuid returning *
    `;
    if (!updated) throw new Error("Opportunity review was not updated");
    await transaction`
      insert into public.audit_events (
        actor_kind, actor_user_id, action, resource_type, resource_id, outcome, metadata
      ) values (
        'ADMIN', ${input.actorUserId}::uuid, 'OPPORTUNITY_NO_MATCH_CONFIRMED',
        'JOB_RESOLUTION_REVIEW', ${input.reviewId}::uuid, 'SUCCEEDED',
        ${transaction.json({ decisionId: text(decision.id) } as never)}
      )
    `;
    return mapOpportunityReview(updated);
  });
}
