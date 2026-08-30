import { createHash } from "node:crypto";

import { getDatabase } from "./index";

export const M14_FEATURE_VERSION = "m14-pit-v1";
export const M14_LABEL_VERSION = "m14-observed-v1";
export const M14_PRIVACY_POLICY_VERSION = "m14-private-v1";
export const PROHIBITED_FEATURES = new Set([
  "race",
  "ethnicity",
  "religion",
  "sex",
  "gender",
  "sexual_orientation",
  "disability",
  "veteran_status",
  "health",
  "political_affiliation",
  "name",
  "school",
  "address",
  "resume_text",
]);
export type DatasetType =
  | "PERSONALIZED_RANKING"
  | "OPENING_FORECAST"
  | "SOURCE_ANOMALY"
  | "RESUME_OUTCOME"
  | "INTERVIEW_TOPIC";
export interface ReadinessReport {
  taskType: DatasetType;
  status: "READY" | "NOT_READY";
  eligibleSampleCount: number;
  positiveLabelCount: number;
  negativeLabelCount: number;
  userCount: number;
  companyCount: number;
  timeSpanDays: number;
  missingFeatureRate: number;
  classImbalance: number | null;
  outcomeDelayDays: number | null;
  duplicateCount: number;
  leakageRisks: string[];
  labelConfidence: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  authoritativeMode: "DETERMINISTIC";
  baselineReference: string;
  datasetFingerprint: string | null;
  shadowHistoryDays: number;
  promotionGates: Record<M21PromotionGate, boolean>;
}
export const M21_PROMOTION_GATES = [
  "REAL_CONSENTED_LABELS",
  "REPRODUCIBLE_DATASET",
  "POINT_IN_TIME_FEATURES",
  "CHRONOLOGICAL_HOLDOUT",
  "ENTITY_LEAKAGE_CONTROL",
  "DETERMINISTIC_BASELINE_WIN",
  "CALIBRATION",
  "PRIVACY_REVIEW",
  "PROTECTED_FEATURE_EXCLUSION",
  "SHADOW_HISTORY",
  "MODEL_CARD",
  "ROLLBACK",
  "MONITORING",
  "ZERO_COST",
] as const;
export type M21PromotionGate = (typeof M21_PROMOTION_GATES)[number];
export interface PromotionEvidence {
  gates: Partial<Record<M21PromotionGate, boolean>>;
  baselineReference: string;
  datasetFingerprint: string | null;
  shadowHistoryDays: number;
}
export const M21_CANDIDATES: Record<DatasetType, { baselineReference: string }> = {
  PERSONALIZED_RANKING: { baselineReference: "M9 versioned weighted deterministic score" },
  OPENING_FORECAST: { baselineReference: "Historical median window and seasonal frequency" },
  SOURCE_ANOMALY: { baselineReference: "M7 rolling median/MAD source-health rules" },
  RESUME_OUTCOME: { baselineReference: "M11 hard constraints and evidence-weighted coverage" },
  INTERVIEW_TOPIC: { baselineReference: "M19 recency-weighted independent-observation frequency" },
};
export interface TemporalSplit {
  trainEnd: string;
  validationEnd: string;
  testEnd: string;
}
const stable = (value: unknown): string => JSON.stringify(value) ?? "null";
export const sha256 = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
export function datasetFingerprint(input: Record<string, unknown>) {
  return sha256(input);
}
export function datasetPseudonym(datasetId: string, userId: string) {
  return sha256({ datasetId, userId, scope: "m14" });
}
export function assertSafeFeatures(features: Record<string, unknown>) {
  for (const key of Object.keys(features))
    if (PROHIBITED_FEATURES.has(key.toLowerCase())) throw new Error("PROHIBITED_FEATURE");
  return features;
}
export function assertPointInTime(asOf: Date, observed: Date) {
  if (observed.getTime() > asOf.getTime()) throw new Error("FUTURE_FEATURE_LEAKAGE");
}
/** Chronological split; entities with the same group key must stay in a single partition. */
export function temporalSplit<T extends { asOfTime: string }>(
  rows: T[],
  groupKey: (row: T) => string = (row) => row.asOfTime,
): { train: T[]; validation: T[]; test: T[]; excluded: T[] } {
  const sorted = [...rows].sort((a, b) => a.asOfTime.localeCompare(b.asOfTime));
  const trainEnd = Math.floor(sorted.length * 0.6),
    validationEnd = Math.floor(sorted.length * 0.8);
  const trainCutoff = sorted[trainEnd - 1]?.asOfTime;
  const validationCutoff = sorted[validationEnd - 1]?.asOfTime;
  const partition = (row: T) =>
    !trainCutoff || row.asOfTime <= trainCutoff
      ? "train"
      : !validationCutoff || row.asOfTime <= validationCutoff
        ? "validation"
        : "test";
  const groups = new Map<string, T[]>();
  for (const row of sorted) groups.set(groupKey(row), [...(groups.get(groupKey(row)) ?? []), row]);
  const result: { train: T[]; validation: T[]; test: T[]; excluded: T[] } = {
    train: [],
    validation: [],
    test: [],
    excluded: [],
  };
  for (const group of groups.values()) {
    const partitions = new Set(group.map(partition));
    if (partitions.size !== 1) result.excluded.push(...group);
    else result[[...partitions][0]!].push(...group);
  }
  return {
    ...result,
  };
}
export function readiness(
  input: Omit<
    ReadinessReport,
    | "status"
    | "classImbalance"
    | "reasons"
    | "authoritativeMode"
    | "baselineReference"
    | "datasetFingerprint"
    | "shadowHistoryDays"
    | "promotionGates"
  > &
    Partial<PromotionEvidence>,
): ReadinessReport {
  const reasons: string[] = [];
  if (input.eligibleSampleCount < 100) reasons.push("INSUFFICIENT_SAMPLES");
  if (input.positiveLabelCount < 20 || input.negativeLabelCount < 20)
    reasons.push("INSUFFICIENT_LABEL_BALANCE");
  if (input.timeSpanDays < 90) reasons.push("INSUFFICIENT_TEMPORAL_COVERAGE");
  if (input.missingFeatureRate > 0.25) reasons.push("FEATURE_MISSINGNESS_HIGH");
  if (input.duplicateCount > 0) reasons.push("CORRELATED_EXAMPLES_REVIEW_REQUIRED");
  if (input.leakageRisks.length) reasons.push("LEAKAGE_RISK_REVIEW_REQUIRED");
  const evidence = assessPromotionEvidence({
    gates: input.gates ?? {},
    baselineReference: input.baselineReference ?? M21_CANDIDATES[input.taskType].baselineReference,
    datasetFingerprint: input.datasetFingerprint ?? null,
    shadowHistoryDays: input.shadowHistoryDays ?? 0,
  });
  for (const reason of evidence.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  return {
    ...input,
    status: reasons.length ? "NOT_READY" : "READY",
    classImbalance: input.positiveLabelCount
      ? input.negativeLabelCount / input.positiveLabelCount
      : null,
    reasons,
    authoritativeMode: "DETERMINISTIC",
    baselineReference: evidence.baselineReference,
    datasetFingerprint: evidence.datasetFingerprint,
    shadowHistoryDays: evidence.shadowHistoryDays,
    promotionGates: evidence.gates,
  };
}
export function assessPromotionEvidence(input: PromotionEvidence): {
  gates: Record<M21PromotionGate, boolean>;
  reasons: string[];
  baselineReference: string;
  datasetFingerprint: string | null;
  shadowHistoryDays: number;
} {
  const gates = Object.fromEntries(
    M21_PROMOTION_GATES.map((gate) => [gate, input.gates[gate] === true]),
  ) as Record<M21PromotionGate, boolean>;
  if (!input.datasetFingerprint) gates.REPRODUCIBLE_DATASET = false;
  const reasons = M21_PROMOTION_GATES.filter((gate) => !gates[gate]).map(
    (gate) => `PROMOTION_GATE_${gate}_FAILED`,
  );
  return { ...input, gates, reasons };
}
export function binaryMetrics(rows: Array<{ label: number; prediction: number }>) {
  const n = rows.length || 1;
  const logLoss =
    rows.reduce(
      (sum, r) =>
        sum -
        (r.label * Math.log(Math.max(r.prediction, 1e-15)) +
          (1 - r.label) * Math.log(Math.max(1 - r.prediction, 1e-15))),
      0,
    ) / n;
  const brier = rows.reduce((sum, r) => sum + (r.label - r.prediction) ** 2, 0) / n;
  return { count: rows.length, logLoss, brier };
}
export async function getPersonalAnalytics(userId: string) {
  const sql = getDatabase();
  const [row] = await sql`select
    (select count(*)::int from public.recommendation_impressions where user_id=${userId}::uuid) impressions,
    (select count(*)::int from public.applications where user_id=${userId}::uuid) applications,
    (select count(*)::int from public.application_events where user_id=${userId}::uuid and to_stage='OA') oa_progressions,
    (select count(*)::int from public.application_events where user_id=${userId}::uuid and to_stage in ('TECHNICAL_INTERVIEW','ONSITE','FINAL_ROUND')) interview_progressions,
    (select count(*)::int from public.applications where user_id=${userId}::uuid and current_status='OFFER') offers`;
  return {
    impressions: Number(row?.impressions ?? 0),
    applications: Number(row?.applications ?? 0),
    oaProgressions: Number(row?.oa_progressions ?? 0),
    interviewProgressions: Number(row?.interview_progressions ?? 0),
    offers: Number(row?.offers ?? 0),
  };
}
export async function getDataReadiness(taskType: DatasetType): Promise<ReadinessReport> {
  const sql = getDatabase();
  // A dataset is evidence only when its builder explicitly records consent and a real origin.
  // Recommendation impressions alone are denominators, not labels, and seed/test rows cannot
  // satisfy this query.
  const [r] = await sql`
    select count(member.row_fingerprint)::int as eligible,
      count(member.row_fingerprint) filter (where member.label_value = 1)::int as positive,
      count(member.row_fingerprint) filter (where member.label_value = 0)::int as negative,
      count(distinct member.user_id)::int as users,
      min(member.as_of_time) as first_at, max(member.as_of_time) as last_at,
      min(dataset.fingerprint) as fingerprint
    from public.training_dataset_versions dataset
    left join public.dataset_members member on member.dataset_id = dataset.id
    where dataset.dataset_type=${taskType}
      and dataset.status='READY'
      and dataset.filtering_rules->>'data_origin'='REAL_CONSENTED'
      and dataset.filtering_rules->>'consent_recorded'='true'
      and coalesce(dataset.exclusion_counts->>'fixture_rows', '0')='0'`;
  const span =
    r?.first_at && r?.last_at
      ? Math.floor(
          (new Date(r.last_at as string).getTime() - new Date(r.first_at as string).getTime()) /
            86400000,
        )
      : 0;
  return readiness({
    taskType,
    eligibleSampleCount: Number(r?.eligible ?? 0),
    positiveLabelCount: Number(r?.positive ?? 0),
    negativeLabelCount: Number(r?.negative ?? 0),
    userCount: Number(r?.users ?? 0),
    companyCount: 0,
    timeSpanDays: span,
    missingFeatureRate: 1,
    outcomeDelayDays: null,
    duplicateCount: 0,
    leakageRisks: ["No M14 materialized labeled dataset"],
    labelConfidence: "LOW",
    datasetFingerprint: (r?.fingerprint as string | undefined) ?? null,
  });
}
