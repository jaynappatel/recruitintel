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
}
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
): { train: T[]; validation: T[]; test: T[] } {
  const sorted = [...rows].sort((a, b) => a.asOfTime.localeCompare(b.asOfTime));
  const trainEnd = Math.floor(sorted.length * 0.6),
    validationEnd = Math.floor(sorted.length * 0.8);
  return {
    train: sorted.slice(0, trainEnd),
    validation: sorted.slice(trainEnd, validationEnd),
    test: sorted.slice(validationEnd),
  };
}
export function readiness(
  input: Omit<ReadinessReport, "status" | "classImbalance" | "reasons">,
): ReadinessReport {
  const reasons: string[] = [];
  if (input.eligibleSampleCount < 100) reasons.push("INSUFFICIENT_SAMPLES");
  if (input.positiveLabelCount < 20 || input.negativeLabelCount < 20)
    reasons.push("INSUFFICIENT_LABEL_BALANCE");
  if (input.timeSpanDays < 90) reasons.push("INSUFFICIENT_TEMPORAL_COVERAGE");
  if (input.missingFeatureRate > 0.25) reasons.push("FEATURE_MISSINGNESS_HIGH");
  if (input.duplicateCount > 0) reasons.push("CORRELATED_EXAMPLES_REVIEW_REQUIRED");
  if (input.leakageRisks.length) reasons.push("LEAKAGE_RISK_REVIEW_REQUIRED");
  return {
    ...input,
    status: reasons.length ? "NOT_READY" : "READY",
    classImbalance: input.positiveLabelCount
      ? input.negativeLabelCount / input.positiveLabelCount
      : null,
    reasons,
  };
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
  if (taskType === "PERSONALIZED_RANKING") {
    const [r] =
      await sql`select count(*)::int eligible, count(distinct user_id)::int users, count(*) filter (where score is not null)::int scored, min(shown_at) first_at, max(shown_at) last_at from public.recommendation_impressions`;
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
      positiveLabelCount: 0,
      negativeLabelCount: 0,
      userCount: Number(r?.users ?? 0),
      companyCount: 0,
      timeSpanDays: span,
      missingFeatureRate: Number(r?.eligible ?? 0)
        ? 1 - Number(r?.scored ?? 0) / Number(r?.eligible ?? 1)
        : 1,
      outcomeDelayDays: null,
      duplicateCount: 0,
      leakageRisks: ["Position and selection bias require explicit impression/action joins"],
      labelConfidence: "LOW",
    });
  }
  return readiness({
    taskType,
    eligibleSampleCount: 0,
    positiveLabelCount: 0,
    negativeLabelCount: 0,
    userCount: 0,
    companyCount: 0,
    timeSpanDays: 0,
    missingFeatureRate: 1,
    outcomeDelayDays: null,
    duplicateCount: 0,
    leakageRisks: ["No M14 materialized labeled dataset"],
    labelConfidence: "LOW",
  });
}
