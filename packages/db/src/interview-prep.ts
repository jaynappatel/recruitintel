import { getDatabase } from "./index";

type Row = Record<string, unknown>;
const text = (value: unknown) => String(value);
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));

export class InterviewPrepNotFoundError extends Error {}
export class InterviewPrepConflictError extends Error {}

export interface InterviewPrepItem {
  id: string;
  key: string;
  title: string;
  rationale: string;
  kind: string;
  completed: boolean;
  version: number;
}
export interface InterviewPrepPlan {
  id: string;
  applicationId: string;
  interview: { id: string; type: string; status: string; startsAt: string; timezone: string };
  company: { name: string; description: string | null; website: string | null };
  roleTitle: string | null;
  stage: string;
  requirements: Array<{
    key: string;
    type: string;
    value: Record<string, unknown>;
    status: "CONFIRMED" | "UNKNOWN";
    evidence: string | null;
    action: string;
  }>;
  questionIntelligence: { items: Array<Record<string, unknown>>; excludedReason: string };
  items: InterviewPrepItem[];
  progress: { completed: number; total: number };
}

function displayRequirement(value: Record<string, unknown>) {
  const candidate = value.value ?? value.skill ?? value.level ?? value.minimum;
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : "this requirement";
}
function stageTopic(stage: string) {
  return stage === "OA"
    ? "Practice the assessment format"
    : stage === "RECRUITER_SCREEN"
      ? "Prepare role and motivation discussion"
      : stage === "TECHNICAL_INTERVIEW"
        ? "Review role-relevant technical concepts"
        : stage === "ONSITE" || stage === "FINAL_ROUND"
          ? "Review role, collaboration, and technical examples"
          : "Prepare general role and experience discussion";
}

async function context(userId: string, interviewId: string) {
  const sql = getDatabase();
  const [row] = await sql`
    select p.id as prep_plan_id, a.id as application_id, a.current_stage::text as stage,
      i.id as interview_id, i.interview_type, i.status::text as interview_status, i.starts_at, i.timezone,
      c.id as company_id, c.canonical_name, c.description, c.website, j.title as role_title, a.opportunity_id, a.match_id
    from public.application_interviews i
    join public.applications a on a.id=i.application_id and a.user_id=i.user_id
    join public.companies c on c.id=a.company_id
    left join public.job_opportunities o on o.id=a.opportunity_id
    left join public.jobs j on j.id=o.canonical_source_posting_id
    left join public.interview_prep_plans p on p.interview_id=i.id and p.user_id=i.user_id
    where i.id=${interviewId}::uuid and i.user_id=${userId}::uuid
  `;
  if (!row) throw new InterviewPrepNotFoundError("Interview not found");
  return row as Row;
}

async function requirementsFor(opportunityId: string) {
  const [row] =
    await getDatabase()`select requirements from public.job_requirement_sets where opportunity_id=${opportunityId}::uuid order by version desc limit 1`;
  const values = (row?.requirements as { requirements?: unknown[] } | undefined)?.requirements;
  return Array.isArray(values)
    ? values.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
}

async function confirmedEvidenceFor(userId: string, matchId: string | null) {
  if (!matchId) return new Map<string, string>();
  const rows = await getDatabase()`select match_evidence.requirement_key, evidence.evidence_type
    from public.match_evidence match_evidence join public.candidate_evidence evidence on evidence.id=match_evidence.evidence_id
    where match_evidence.user_id=${userId}::uuid and match_evidence.match_id=${matchId}::uuid
      and match_evidence.relation='SATISFIES' and evidence.review_status='CONFIRMED' and evidence.superseded_at is null`;
  return new Map(rows.map((row) => [text(row.requirement_key), text(row.evidence_type)]));
}

async function readPlan(userId: string, interviewId: string): Promise<InterviewPrepPlan> {
  const base = await context(userId, interviewId);
  const requirements = await requirementsFor(text(base.opportunity_id));
  const evidence = await confirmedEvidenceFor(
    userId,
    base.match_id == null ? null : text(base.match_id),
  );
  const items = base.prep_plan_id
    ? await getDatabase()`select id,item_key,title,rationale,item_kind,completed_at,version from public.interview_prep_items where prep_plan_id=${text(base.prep_plan_id)}::uuid and user_id=${userId}::uuid order by created_at,id`
    : [];
  const mapped = items.map((item) => ({
    id: text(item.id),
    key: text(item.item_key),
    title: text(item.title),
    rationale: text(item.rationale),
    kind: text(item.item_kind),
    completed: item.completed_at != null,
    version: Number(item.version),
  }));
  return {
    id: base.prep_plan_id ? text(base.prep_plan_id) : "",
    applicationId: text(base.application_id),
    interview: {
      id: text(base.interview_id),
      type: text(base.interview_type),
      status: text(base.interview_status),
      startsAt: iso(base.starts_at),
      timezone: text(base.timezone),
    },
    company: {
      name: text(base.canonical_name),
      description: base.description == null ? null : text(base.description),
      website: base.website == null ? null : text(base.website),
    },
    roleTitle: base.role_title == null ? null : text(base.role_title),
    stage: text(base.stage),
    requirements: requirements.map((r, index) => {
      const value = (r.normalizedValue ?? {}) as Record<string, unknown>;
      const key = text(r.key ?? index);
      const matchedEvidence = evidence.get(key) ?? null;
      const status =
        r.evidenceStatus === "UNKNOWN" || !matchedEvidence ? "UNKNOWN" : ("CONFIRMED" as const);
      return {
        key,
        type: text(r.type ?? "REQUIREMENT"),
        value,
        status,
        evidence: matchedEvidence,
        action:
          status === "UNKNOWN"
            ? "Prepare to discuss this requirement without claiming unsupported experience."
            : `Review your confirmed ${matchedEvidence} evidence for ${displayRequirement(value)}.`,
      };
    }),
    questionIntelligence: {
      items: [],
      excludedReason:
        "No license-approved public question source is available. Historical GitHub observations are excluded from preparation until their licenses are verified.",
    },
    items: mapped,
    progress: { completed: mapped.filter((item) => item.completed).length, total: mapped.length },
  };
}

export async function createInterviewPrepPlan(
  userId: string,
  interviewId: string,
): Promise<InterviewPrepPlan> {
  const sql = getDatabase();
  await sql.begin(async (tx) => {
    const base = await context(userId, interviewId);
    if (
      text(base.interview_status) !== "SCHEDULED" &&
      text(base.interview_status) !== "RESCHEDULED"
    )
      throw new InterviewPrepConflictError(
        "Preparation is available for scheduled interviews only",
      );
    const [plan] =
      await tx`insert into public.interview_prep_plans (user_id,application_id,interview_id) values (${userId}::uuid,${text(base.application_id)}::uuid,${interviewId}::uuid) on conflict (user_id,interview_id) do update set updated_at=now() returning id`;
    const requirements = await requirementsFor(text(base.opportunity_id));
    const definitions = [
      {
        key: "review-company",
        title: `Review ${text(base.canonical_name)}`,
        rationale: "Review the existing company context and source-linked public information.",
        kind: "COMPANY",
      },
      {
        key: "review-role",
        title: "Review the role context",
        rationale: base.role_title
          ? `Review the canonical role: ${text(base.role_title)}.`
          : "No canonical role title is available; use the application context.",
        kind: "ROLE",
      },
      {
        key: "stage-topic",
        title: stageTopic(text(base.stage)),
        rationale: `Derived from the recorded application stage: ${text(base.stage)}.`,
        kind: "TOPIC",
      },
      ...requirements.slice(0, 5).map((r, index) => {
        const value = (r.normalizedValue ?? {}) as Record<string, unknown>;
        const unknown = r.evidenceStatus === "UNKNOWN";
        return {
          key: `requirement-${index}`,
          title: unknown
            ? `Prepare to discuss: ${displayRequirement(value)}`
            : `Review experience: ${displayRequirement(value)}`,
          rationale: unknown
            ? "Job evidence is UNKNOWN; do not make unsupported claims."
            : `Derived from the job requirement (${text(r.type ?? "REQUIREMENT")}).`,
          kind: unknown ? "GAP" : "REQUIREMENT",
        };
      }),
    ];
    for (const [index, item] of definitions.entries()) {
      const [prepItem] =
        await tx`insert into public.interview_prep_items (user_id,prep_plan_id,item_key,title,rationale,item_kind)
        values (${userId}::uuid,${text(plan?.id)}::uuid,${item.key},${item.title},${item.rationale},${item.kind})
        on conflict (prep_plan_id,item_key) do update set updated_at=public.interview_prep_items.updated_at
        returning id,calendar_item_id`;
      if (prepItem?.calendar_item_id) continue;
      const taskAt = new Date(
        new Date(text(base.starts_at)).getTime() - (definitions.length - index) * 86_400_000,
      );
      const [calendarItem] = await tx`insert into public.calendar_items
        (user_id,company_id,opportunity_id,application_id,type,title,description,starts_at,all_day,timezone,status,source,sync_enabled,metadata)
        values (${userId}::uuid,${text(base.company_id)}::uuid,${text(base.opportunity_id)}::uuid,${text(base.application_id)}::uuid,'INTERVIEW_PREP',${item.title},${item.rationale},${taskAt.toISOString()}::timestamptz,false,${text(base.timezone)},'TODO','USER',false,${tx.json({ interviewId, interviewPrepPlanId: text(plan?.id), interviewPrepItemKey: item.key })}) returning id`;
      await tx`update public.interview_prep_items set calendar_item_id=${text(calendarItem?.id)}::uuid where id=${text(prepItem?.id)}::uuid and user_id=${userId}::uuid`;
    }
  });
  return readPlan(userId, interviewId);
}

export async function getInterviewPrepPlan(userId: string, interviewId: string) {
  const plan = await readPlan(userId, interviewId);
  if (!plan.id) throw new InterviewPrepNotFoundError("Preparation plan not found");
  return plan;
}
export async function setInterviewPrepItemCompletion(
  userId: string,
  interviewId: string,
  itemId: string,
  completed: boolean,
  expectedVersion: number,
) {
  const plan = await getInterviewPrepPlan(userId, interviewId);
  const [row] =
    await getDatabase()`update public.interview_prep_items set completed_at=case when ${completed} then coalesce(completed_at,now()) else null end, version=version+1 where id=${itemId}::uuid and prep_plan_id=${plan.id}::uuid and user_id=${userId}::uuid and version=${expectedVersion} returning id,calendar_item_id`;
  if (!row)
    throw new InterviewPrepConflictError("Checklist item was not found or was updated elsewhere");
  if (row.calendar_item_id)
    await getDatabase()`update public.calendar_items set status=${completed ? "DONE" : "TODO"}::public.calendar_item_status, completed_at=case when ${completed} then coalesce(completed_at,now()) else null end where id=${text(row.calendar_item_id)}::uuid and user_id=${userId}::uuid and deleted_at is null`;
  return getInterviewPrepPlan(userId, interviewId);
}
