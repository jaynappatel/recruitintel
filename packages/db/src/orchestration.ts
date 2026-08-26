import { getDatabase } from "./index";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  throw new TypeError("Expected database text");
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" || typeof value === "bigint") return Number(value);
  return 0;
}

function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export interface SafeWorkItemRecord {
  id: string;
  workType: string;
  workClass: string;
  status: string;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  sourceId: string | null;
  sourceProvider: string | null;
  hasPrivateOwner: boolean;
  correlationId: string;
  scheduledAt: string;
  availableAt: string;
  firstStartedAt: string | null;
  completedAt: string | null;
  lastErrorClassification: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

export interface SafeWorkAttemptRecord {
  id: string;
  attemptNumber: number;
  status: string;
  workerInstance: string;
  queueDelayMs: number;
  durationMs: number | null;
  outcome: string | null;
  errorCode: string | null;
  coverageStatus: string;
  itemsDiscovered: number | null;
  itemsProcessed: number | null;
  itemsFailed: number | null;
  claimedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  safeDiagnostics: Record<string, unknown>;
}

export interface WorkItemDetailRecord extends SafeWorkItemRecord {
  attempts: SafeWorkAttemptRecord[];
}

function mapWork(row: Row): SafeWorkItemRecord {
  return {
    id: text(row.id),
    workType: text(row.work_type),
    workClass: text(row.work_class),
    status: text(row.status),
    priority: number(row.priority),
    attemptCount: number(row.attempt_count),
    maxAttempts: number(row.max_attempts),
    sourceId: row.user_id ? null : optionalText(row.source_id),
    sourceProvider: row.user_id ? null : optionalText(row.source_provider),
    hasPrivateOwner: Boolean(row.user_id),
    correlationId: text(row.correlation_id),
    scheduledAt: timestamp(row.scheduled_at) ?? "",
    availableAt: timestamp(row.available_at) ?? "",
    firstStartedAt: timestamp(row.first_started_at),
    completedAt: timestamp(row.completed_at),
    lastErrorClassification: optionalText(row.last_error_classification),
    lastErrorCode: optionalText(row.last_error_code),
    createdAt: timestamp(row.created_at) ?? "",
  };
}

const safeWorkSelect = `
  select work.id, work.work_type, work.work_class, work.status, work.priority,
    work.attempt_count, work.max_attempts, work.source_id, source.provider as source_provider,
    work.user_id, work.correlation_id, work.scheduled_at, work.available_at,
    work.first_started_at, work.completed_at, work.last_error_classification,
    work.last_error_code, work.created_at
  from public.work_items work
  left join public.sources source on source.id = work.source_id
`;

export async function listSafeWorkItems(options: {
  status?: string;
  workType?: string;
  limit: number;
  offset: number;
}): Promise<{ items: SafeWorkItemRecord[]; total: number }> {
  const sql = getDatabase();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (options.status) {
    values.push(options.status);
    where.push(`work.status = $${values.length}::public.work_status`);
  }
  if (options.workType) {
    values.push(options.workType);
    where.push(`work.work_type = $${values.length}::public.work_type`);
  }
  const predicate = where.length ? `where ${where.join(" and ")}` : "";
  values.push(options.limit, options.offset);
  const rows = await sql.unsafe(
    `${safeWorkSelect} ${predicate}
     order by work.created_at desc, work.id desc
     limit $${values.length - 1} offset $${values.length}`,
    values,
  );
  const [count] = await sql.unsafe(
    `select count(*)::int as total from public.work_items work ${predicate}`,
    values.slice(0, -2),
  );
  return { items: rows.map(mapWork), total: number(count?.total) };
}

export async function enqueueM11Work(input: {
  workType: "RESUME_PARSE" | "MATCH_MATERIALIZE";
  userId: string;
  resumeVersionId?: string;
  opportunityId?: string;
  parserVersion?: number;
  algorithmVersion?: string;
  idempotencyFingerprint: string;
}) {
  if (input.workType === "RESUME_PARSE" && !input.resumeVersionId)
    throw new Error("Resume parse work requires a resume version");
  if (input.workType === "MATCH_MATERIALIZE" && (!input.resumeVersionId || !input.opportunityId))
    throw new Error("Match work requires resume and opportunity targets");
  const [row] = await getDatabase()`insert into public.work_items
    (work_type,work_class,user_id,resume_version_id,opportunity_id,parser_version,algorithm_version,idempotency_fingerprint,safe_diagnostics)
    values (${input.workType}::public.work_type,'RESUME'::public.work_class,${input.userId}::uuid,${input.resumeVersionId ?? null}::uuid,${input.opportunityId ?? null}::uuid,${input.parserVersion ?? null},${input.algorithmVersion ?? null},${input.idempotencyFingerprint},${JSON.stringify({ resumeVersionId: input.resumeVersionId ?? null, opportunityId: input.opportunityId ?? null })}::jsonb)
    on conflict (idempotency_fingerprint) do update set updated_at=public.work_items.updated_at returning *`;
  return row;
}

export async function getSafeWorkItem(id: string): Promise<WorkItemDetailRecord | null> {
  const sql = getDatabase();
  const rows = await sql.unsafe(`${safeWorkSelect} where work.id = $1::uuid`, [id]);
  if (!rows[0]) return null;
  const attempts = await sql`
    select id, attempt_number, status, worker_instance, queue_delay_ms, duration_ms,
      outcome, error_code, coverage_status, items_discovered, items_processed,
      items_failed, claimed_at, started_at, finished_at, safe_diagnostics
    from public.work_attempts where work_item_id = ${id}::uuid
    order by attempt_number desc
  `;
  return {
    ...mapWork(rows[0]),
    attempts: attempts.map((row) => ({
      id: text(row.id),
      attemptNumber: number(row.attempt_number),
      status: text(row.status),
      workerInstance: text(row.worker_instance),
      queueDelayMs: number(row.queue_delay_ms),
      durationMs: row.duration_ms == null ? null : number(row.duration_ms),
      outcome: optionalText(row.outcome),
      errorCode: optionalText(row.error_code),
      coverageStatus: text(row.coverage_status),
      itemsDiscovered: row.items_discovered == null ? null : number(row.items_discovered),
      itemsProcessed: row.items_processed == null ? null : number(row.items_processed),
      itemsFailed: row.items_failed == null ? null : number(row.items_failed),
      claimedAt: timestamp(row.claimed_at) ?? "",
      startedAt: timestamp(row.started_at),
      finishedAt: timestamp(row.finished_at),
      safeDiagnostics: (row.safe_diagnostics ?? {}) as Record<string, unknown>,
    })),
  };
}

export async function requeueGlobalDeadLetter(id: string): Promise<string> {
  const sql = getDatabase();
  const [row] = await sql`
    select public.requeue_dead_letter(${id}::uuid) as id
  `;
  if (!row) throw new Error("Dead-letter requeue returned no row");
  return text(row.id);
}

export async function cancelGlobalWork(id: string): Promise<boolean> {
  const sql = getDatabase();
  const [row] = await sql`
    update public.work_items set
      status = case when status in ('READY', 'RETRY_WAIT')
        then 'CANCELLED'::public.work_status else status end,
      completed_at = case when status in ('READY', 'RETRY_WAIT') then now() else completed_at end,
      cancel_requested_at = case when status in ('LEASED', 'RUNNING')
        then now() else cancel_requested_at end
    where id = ${id}::uuid and user_id is null
      and status in ('READY', 'RETRY_WAIT', 'LEASED', 'RUNNING')
    returning id
  `;
  return Boolean(row);
}

export interface ScheduleRecord {
  id: string;
  name: string;
  workType: string;
  workClass: string;
  enabled: boolean;
  scheduleKind: string;
  intervalSeconds: number | null;
  dailyLocalTime: string | null;
  timezone: string | null;
  nextRunAt: string;
  lastEnqueuedFor: string | null;
  jitterSeconds: number;
  priority: number;
}

export async function listSchedules(): Promise<ScheduleRecord[]> {
  const rows = await getDatabase()`
    select id, name, work_type, work_class, enabled, schedule_kind,
      interval_seconds, daily_local_time::text, timezone, next_run_at,
      last_enqueued_for, jitter_seconds, priority
    from public.schedules order by name
  `;
  return rows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    workType: text(row.work_type),
    workClass: text(row.work_class),
    enabled: Boolean(row.enabled),
    scheduleKind: text(row.schedule_kind),
    intervalSeconds: row.interval_seconds == null ? null : number(row.interval_seconds),
    dailyLocalTime: optionalText(row.daily_local_time),
    timezone: optionalText(row.timezone),
    nextRunAt: timestamp(row.next_run_at) ?? "",
    lastEnqueuedFor: timestamp(row.last_enqueued_for),
    jitterSeconds: number(row.jitter_seconds),
    priority: number(row.priority),
  }));
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<boolean> {
  const [row] = await getDatabase()`
    update public.schedules set enabled = ${enabled}
    where id = ${id}::uuid returning id
  `;
  return Boolean(row);
}

export interface SourcePolicyRecord {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  collectionMethod: string;
  officialApiAvailable: boolean;
  robotsPolicy: string;
  termsStatus: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  policyVersion: number;
  notes: string | null;
}

export async function listSourcePolicies(): Promise<SourcePolicyRecord[]> {
  const rows = await getDatabase()`
    select id, provider, display_name, status, collection_method,
      official_api_available, robots_policy, terms_status, reviewed_at,
      reviewed_by, policy_version, notes
    from public.source_policies order by provider
  `;
  return rows.map((row) => ({
    id: text(row.id),
    provider: text(row.provider),
    displayName: text(row.display_name),
    status: text(row.status),
    collectionMethod: text(row.collection_method),
    officialApiAvailable: Boolean(row.official_api_available),
    robotsPolicy: text(row.robots_policy),
    termsStatus: text(row.terms_status),
    reviewedAt: timestamp(row.reviewed_at),
    reviewedBy: optionalText(row.reviewed_by),
    policyVersion: number(row.policy_version),
    notes: optionalText(row.notes),
  }));
}

export async function updateSourcePolicy(
  id: string,
  input: { status: string; reviewedBy?: string; notes?: string },
): Promise<boolean> {
  const approved = ["ALLOWED", "ALLOWED_WITH_LIMITS"].includes(input.status);
  const reviewedBy = input.reviewedBy?.trim() || null;
  if (approved && !reviewedBy) {
    throw new TypeError("Approved source policy requires a named reviewer");
  }
  const [row] = await getDatabase()`
    update public.source_policies set
      status = ${input.status}::public.source_policy_status,
      terms_status = ${approved ? "REVIEWED" : "NOT_REVIEWED"},
      reviewed_at = ${approved ? new Date() : null},
      reviewed_by = ${approved ? reviewedBy : null},
      notes = ${input.notes?.trim() || null},
      policy_version = policy_version + 1
    where id = ${id}::uuid returning id
  `;
  return Boolean(row);
}

export async function listSourceHealth(): Promise<Row[]> {
  const rows = await getDatabase()`
    select health.source_id, source.provider, source.name, health.last_success_at,
      health.last_failure_at, health.consecutive_failures,
      health.rolling_attempt_count, health.rolling_success_rate,
      health.average_latency_ms, health.average_discovery_delay_seconds,
      health.rate_limit_frequency,
      health.coverage_status, health.updated_at
    from public.source_health_state health
    join public.sources source on source.id = health.source_id
    order by health.consecutive_failures desc, source.provider, source.name
  `;
  return rows.map((row) => ({
    sourceId: text(row.source_id),
    provider: text(row.provider),
    sourceName: text(row.name),
    lastSuccessAt: timestamp(row.last_success_at),
    lastFailureAt: timestamp(row.last_failure_at),
    consecutiveFailures: number(row.consecutive_failures),
    rollingAttemptCount: number(row.rolling_attempt_count),
    rollingSuccessRate: row.rolling_success_rate == null ? null : number(row.rolling_success_rate),
    averageLatencyMs: row.average_latency_ms == null ? null : number(row.average_latency_ms),
    averageDiscoveryDelaySeconds:
      row.average_discovery_delay_seconds == null
        ? null
        : number(row.average_discovery_delay_seconds),
    rateLimitFrequency: row.rate_limit_frequency == null ? null : number(row.rate_limit_frequency),
    coverageStatus: text(row.coverage_status),
    updatedAt: timestamp(row.updated_at),
  }));
}

export interface SourceIncidentRecord {
  id: string;
  sourceId: string;
  provider: string;
  sourceName: string;
  incidentType: string;
  status: string;
  ruleVersion: number;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  safeEvidence: Record<string, unknown>;
}

export async function listSourceIncidents(status?: string): Promise<SourceIncidentRecord[]> {
  const rows = status
    ? await getDatabase()`
        select incident.id, incident.source_id, source.provider, source.name,
          incident.incident_type, incident.status, incident.rule_version,
          incident.opened_at, incident.acknowledged_at, incident.resolved_at,
          incident.safe_evidence
        from public.source_incidents incident
        join public.sources source on source.id = incident.source_id
        where incident.status = ${status}::public.source_incident_status
        order by incident.opened_at desc, incident.id desc
      `
    : await getDatabase()`
        select incident.id, incident.source_id, source.provider, source.name,
          incident.incident_type, incident.status, incident.rule_version,
          incident.opened_at, incident.acknowledged_at, incident.resolved_at,
          incident.safe_evidence
        from public.source_incidents incident
        join public.sources source on source.id = incident.source_id
        order by incident.opened_at desc, incident.id desc
      `;
  return rows.map((row) => ({
    id: text(row.id),
    sourceId: text(row.source_id),
    provider: text(row.provider),
    sourceName: text(row.name),
    incidentType: text(row.incident_type),
    status: text(row.status),
    ruleVersion: number(row.rule_version),
    openedAt: timestamp(row.opened_at) ?? "",
    acknowledgedAt: timestamp(row.acknowledged_at),
    resolvedAt: timestamp(row.resolved_at),
    safeEvidence: (row.safe_evidence ?? {}) as Record<string, unknown>,
  }));
}

export async function updateSourceIncidentStatus(
  id: string,
  status: "ACKNOWLEDGED" | "RESOLVED",
): Promise<boolean> {
  const [row] = await getDatabase()`
    update public.source_incidents set
      status = ${status}::public.source_incident_status,
      acknowledged_at = case when ${status} = 'ACKNOWLEDGED'
        then coalesce(acknowledged_at, now()) else acknowledged_at end,
      resolved_at = case when ${status} = 'RESOLVED' then now() else null end
    where id = ${id}::uuid and status <> 'RESOLVED'
    returning id
  `;
  return Boolean(row);
}
