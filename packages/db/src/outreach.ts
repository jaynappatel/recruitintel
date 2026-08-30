import { getDatabase } from "./index";

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v);
const time = (v: unknown) =>
  v instanceof Date
    ? v.toISOString()
    : typeof v === "string" || typeof v === "number"
      ? String(v)
      : null;

export class OutreachNotFoundError extends Error {}
export class OutreachConflictError extends Error {}
export class OutreachValidationError extends Error {}
export type ContactTruth = "VERIFIED_PUBLIC" | "USER_PROVIDED" | "UNVERIFIED" | "UNKNOWN";
export type OutreachStatus =
  | "DRAFT"
  | "REVIEW"
  | "APPROVED"
  | "SEND_ELIGIBLE"
  | "SENT"
  | "FAILED"
  | "CANCELLED";
export interface OutreachContact {
  id: string;
  userId: string;
  recruiterProfileId: string | null;
  applicationId: string | null;
  displayName: string;
  companyName: string | null;
  title: string | null;
  email: string;
  contactTruth: ContactTruth;
  provenanceClass: string;
  sourceUrl: string | null;
  sourceLabel: string;
  consentAt: string;
  lastSeenAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OutreachDraft {
  id: string;
  userId: string;
  contactId: string;
  applicationId: string | null;
  subject: string;
  body: string;
  grounding: Array<{ kind: string; text: string; sourceUrl?: string }>;
  status: OutreachStatus;
  version: number;
  approvedVersion: number | null;
  approvedAt: string | null;
  sentAt: string | null;
  followUpDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}
function contact(r: Row): OutreachContact {
  return {
    id: s(r.id),
    userId: s(r.user_id),
    recruiterProfileId: r.recruiter_profile_id ? s(r.recruiter_profile_id) : null,
    applicationId: r.application_id ? s(r.application_id) : null,
    displayName: s(r.display_name),
    companyName: r.company_name ? s(r.company_name) : null,
    title: r.title ? s(r.title) : null,
    email: s(r.email),
    contactTruth: s(r.contact_truth) as ContactTruth,
    provenanceClass: s(r.provenance_class),
    sourceUrl: r.source_url ? s(r.source_url) : null,
    sourceLabel: s(r.source_label),
    consentAt: s(time(r.consent_at)),
    lastSeenAt: time(r.last_seen_at),
    version: Number(r.version),
    createdAt: s(time(r.created_at)),
    updatedAt: s(time(r.updated_at)),
  };
}
function draft(r: Row): OutreachDraft {
  return {
    id: s(r.id),
    userId: s(r.user_id),
    contactId: s(r.contact_id),
    applicationId: r.application_id ? s(r.application_id) : null,
    subject: s(r.subject),
    body: s(r.body),
    grounding: Array.isArray(r.grounding) ? (r.grounding as OutreachDraft["grounding"]) : [],
    status: s(r.status) as OutreachStatus,
    version: Number(r.version),
    approvedVersion: r.approved_version == null ? null : Number(r.approved_version),
    approvedAt: time(r.approved_at),
    sentAt: time(r.sent_at),
    followUpDueAt: time(r.follow_up_due_at),
    createdAt: s(time(r.created_at)),
    updatedAt: s(time(r.updated_at)),
  };
}
const cleanEmail = (email: string) => email.trim().toLowerCase();
const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export async function listOutreachContacts(userId: string) {
  return (
    await getDatabase()`select * from public.outreach_contacts where user_id=${userId}::uuid order by updated_at desc,id`
  ).map(contact);
}
export async function createOutreachContact(
  userId: string,
  input: {
    recruiterProfileId?: string | null;
    applicationId?: string | null;
    displayName: string;
    companyName?: string | null;
    title?: string | null;
    email: string;
    contactTruth: ContactTruth;
    provenanceClass: string;
    sourceUrl?: string | null;
    sourceLabel: string;
    consentAt: string;
    lastSeenAt?: string | null;
  },
) {
  const email = cleanEmail(input.email);
  if (!validEmail(email) || input.contactTruth === "UNKNOWN")
    throw new OutreachValidationError("A sendable contact requires a valid, known email");
  const [r] =
    await getDatabase()`insert into public.outreach_contacts (user_id,recruiter_profile_id,application_id,display_name,company_name,title,email,contact_truth,provenance_class,source_url,source_label,consent_at,last_seen_at) values (${userId}::uuid,${input.recruiterProfileId ?? null}::uuid,${input.applicationId ?? null}::uuid,${input.displayName.trim()},${input.companyName ?? null},${input.title ?? null},${email},${input.contactTruth},${input.provenanceClass},${input.sourceUrl ?? null},${input.sourceLabel.trim()},${input.consentAt}::timestamptz,${input.lastSeenAt ?? null}::timestamptz) on conflict (user_id,email) do nothing returning *`;
  if (!r) throw new OutreachConflictError("A private contact with this email already exists");
  return contact(r);
}
async function ownedContact(userId: string, id: string) {
  const [r] =
    await getDatabase()`select * from public.outreach_contacts where id=${id}::uuid and user_id=${userId}::uuid`;
  if (!r) throw new OutreachNotFoundError("Contact not found");
  return contact(r);
}
export async function updateOutreachContact(
  userId: string,
  id: string,
  input: Partial<
    Pick<
      OutreachContact,
      "displayName" | "companyName" | "title" | "email" | "sourceUrl" | "sourceLabel" | "lastSeenAt"
    >
  >,
) {
  await ownedContact(userId, id);
  const email = input.email === undefined ? null : cleanEmail(input.email);
  if (email !== null && !validEmail(email)) throw new OutreachValidationError("Email is invalid");
  const [r] =
    await getDatabase()`update public.outreach_contacts set display_name=coalesce(${input.displayName?.trim() ?? null},display_name),company_name=coalesce(${input.companyName ?? null},company_name),title=coalesce(${input.title ?? null},title),email=coalesce(${email},email),source_url=coalesce(${input.sourceUrl ?? null},source_url),source_label=coalesce(${input.sourceLabel?.trim() ?? null},source_label),last_seen_at=coalesce(${input.lastSeenAt ?? null}::timestamptz,last_seen_at),version=version+1 where id=${id}::uuid and user_id=${userId}::uuid returning *`;
  if (!r) throw new OutreachNotFoundError("Contact not found");
  return contact(r);
}
export async function deleteOutreachContact(userId: string, id: string) {
  const r =
    await getDatabase()`delete from public.outreach_contacts where id=${id}::uuid and user_id=${userId}::uuid returning id`;
  if (!r[0]) throw new OutreachNotFoundError("Contact not found");
}
export async function listOutreachDrafts(userId: string) {
  return (
    await getDatabase()`select * from public.outreach_drafts where user_id=${userId}::uuid order by updated_at desc,id`
  ).map(draft);
}
export async function createOutreachDraft(
  userId: string,
  input: { contactId: string; applicationId?: string | null; subject?: string; body?: string },
) {
  const c = await ownedContact(userId, input.contactId);
  const subject =
    input.subject?.trim() || `Interest in opportunities at ${c.companyName ?? "your team"}`;
  const body =
    input.body?.trim() ||
    `Hi ${c.displayName},\n\nI am interested in opportunities at ${c.companyName ?? "your company"}. I found your contact information through ${c.sourceLabel}. If there is an appropriate role or recruiting process to review, I would appreciate any guidance.\n\nThank you,`;
  if (subject.length > 200 || body.length > 5000)
    throw new OutreachValidationError("Draft is too long");
  const grounding = [
    {
      kind: "CONTACT_PROVENANCE",
      text: `Contact provided via ${c.sourceLabel}`,
      sourceUrl: c.sourceUrl ?? undefined,
    },
  ];
  const [r] =
    await getDatabase()`insert into public.outreach_drafts (user_id,contact_id,application_id,subject,body,grounding,status) values (${userId}::uuid,${c.id}::uuid,${input.applicationId ?? null}::uuid,${subject},${body},${JSON.stringify(grounding)}::jsonb,'DRAFT') returning *`;
  if (!r) throw new OutreachConflictError("Draft could not be created");
  return draft(r);
}
export async function updateOutreachDraft(
  userId: string,
  id: string,
  input: { subject: string; body: string; version: number },
) {
  if (
    !input.subject.trim() ||
    !input.body.trim() ||
    input.subject.length > 200 ||
    input.body.length > 5000
  )
    throw new OutreachValidationError("Draft content is invalid");
  return getDatabase().begin(async (tx) => {
    const [r] =
      await tx`update public.outreach_drafts set subject=${input.subject.trim()},body=${input.body.trim()},status='DRAFT',approved_version=null,approved_at=null,version=version+1 where id=${id}::uuid and user_id=${userId}::uuid and version=${input.version} and status not in ('SENT','CANCELLED') returning *`;
    if (!r) throw new OutreachConflictError("Draft changed, was sent, or was cancelled");
    return draft(r);
  });
}
export async function approveOutreachDraft(userId: string, id: string, version: number) {
  const [r] =
    await getDatabase()`update public.outreach_drafts set status='SEND_ELIGIBLE',approved_version=version,approved_at=now() where id=${id}::uuid and user_id=${userId}::uuid and version=${version} and status in ('DRAFT','REVIEW','APPROVED') returning *`;
  if (!r) throw new OutreachConflictError("Draft approval is stale or unavailable");
  return draft(r);
}
export async function recordManualOutreachSend(userId: string, id: string, idempotencyKey: string) {
  if (!idempotencyKey.trim()) throw new OutreachValidationError("Idempotency key is required");
  return getDatabase().begin(async (tx) => {
    const [existing] =
      await tx`select id,status from public.outreach_attempts where user_id=${userId}::uuid and idempotency_key=${idempotencyKey.trim()} for update`;
    if (existing) return { attemptId: s(existing.id), status: s(existing.status) as "RECORDED" };
    const [r] =
      await tx`select d.*,c.email,c.contact_truth from public.outreach_drafts d join public.outreach_contacts c on c.id=d.contact_id and c.user_id=d.user_id where d.id=${id}::uuid and d.user_id=${userId}::uuid for update`;
    if (!r) throw new OutreachNotFoundError("Draft not found");
    if (r.status !== "SEND_ELIGIBLE" || Number(r.approved_version) !== Number(r.version))
      throw new OutreachConflictError("Draft requires current explicit approval");
    const [attempt] =
      await tx`insert into public.outreach_attempts (user_id,draft_id,draft_version,recipient_email,idempotency_key,channel,status,recorded_at) values (${userId}::uuid,${id}::uuid,${Number(r.version)}::int,${s(r.email)},${idempotencyKey.trim()},'MANUAL_COPY','RECORDED',now()) returning *`;
    if (!attempt) throw new OutreachConflictError("Unable to record manual send");
    await tx`update public.outreach_drafts set status='SENT',sent_at=coalesce(sent_at,now()),follow_up_due_at=coalesce(follow_up_due_at,now()+interval '7 days') where id=${id}::uuid and user_id=${userId}::uuid`;
    return { attemptId: s(attempt.id), status: "RECORDED" as const };
  });
}
