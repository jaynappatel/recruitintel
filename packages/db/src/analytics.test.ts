import { describe, expect, it } from "vitest";
import {
  assertPointInTime,
  assertSafeFeatures,
  assessPromotionEvidence,
  binaryMetrics,
  datasetFingerprint,
  datasetPseudonym,
  readiness,
  temporalSplit,
} from "./analytics";

describe("M14 analytics safeguards", () => {
  it("creates stable dataset-scoped pseudonyms and fingerprints", () => {
    expect(datasetFingerprint({ b: 2, a: 1 })).toBe(datasetFingerprint({ b: 2, a: 1 }));
    expect(datasetPseudonym("a", "u")).not.toBe(datasetPseudonym("b", "u"));
  });
  it("rejects protected fields and future features", () => {
    expect(() => assertSafeFeatures({ gender: "x" })).toThrow("PROHIBITED_FEATURE");
    expect(() => assertPointInTime(new Date("2025-01-01"), new Date("2025-01-02"))).toThrow(
      "FUTURE_FEATURE_LEAKAGE",
    );
  });
  it("splits only chronologically and reports no fabricated readiness", () => {
    const split = temporalSplit(
      ["2024-03-01", "2024-01-01", "2024-02-01", "2024-04-01", "2024-05-01"].map((asOfTime) => ({
        asOfTime,
      })),
    );
    expect(split.train[0]?.asOfTime).toBe("2024-01-01");
    const grouped = temporalSplit(
      [
        { asOfTime: "2024-01-01", user: "a" },
        { asOfTime: "2024-04-01", user: "a" },
        { asOfTime: "2024-02-01", user: "b" },
        { asOfTime: "2024-03-01", user: "c" },
        { asOfTime: "2024-05-01", user: "d" },
      ],
      (row) => row.user,
    );
    expect(grouped.excluded.map((row) => row.user)).toEqual(["a", "a"]);
    expect(new Set(grouped.train.map((row) => row.user))).not.toContain("a");
    const report = readiness({
      taskType: "PERSONALIZED_RANKING",
      eligibleSampleCount: 3,
      positiveLabelCount: 0,
      negativeLabelCount: 0,
      userCount: 1,
      companyCount: 0,
      timeSpanDays: 2,
      missingFeatureRate: 1,
      outcomeDelayDays: null,
      duplicateCount: 0,
      leakageRisks: [],
      labelConfidence: "LOW",
    });
    expect(report.status).toBe("NOT_READY");
  });
  it("keeps every deferred M14 task NOT_READY without real evidence gates", () => {
    for (const taskType of [
      "PERSONALIZED_RANKING",
      "OPENING_FORECAST",
      "SOURCE_ANOMALY",
      "RESUME_OUTCOME",
      "INTERVIEW_TOPIC",
    ] as const) {
      expect(
        readiness({
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
        }).status,
      ).toBe("NOT_READY");
    }
  });
  it("calculates bounded binary metrics for offline comparisons", () => {
    expect(
      binaryMetrics([
        { label: 1, prediction: 0.9 },
        { label: 0, prediction: 0.1 },
      ]).brier,
    ).toBeCloseTo(0.01);
  });
  it("requires every M21 promotion gate and keeps synthetic proof separate from live readiness", () => {
    const incomplete = assessPromotionEvidence({
      gates: { REAL_CONSENTED_LABELS: true },
      baselineReference: "deterministic baseline",
      datasetFingerprint: null,
      shadowHistoryDays: 0,
    });
    expect(incomplete.reasons).toContain("PROMOTION_GATE_SHADOW_HISTORY_FAILED");
    expect(incomplete.gates.REPRODUCIBLE_DATASET).toBe(false);

    const syntheticSystemProof = assessPromotionEvidence({
      gates: {
        REAL_CONSENTED_LABELS: true,
        REPRODUCIBLE_DATASET: true,
        POINT_IN_TIME_FEATURES: true,
        CHRONOLOGICAL_HOLDOUT: true,
        ENTITY_LEAKAGE_CONTROL: true,
        DETERMINISTIC_BASELINE_WIN: true,
        CALIBRATION: true,
        PRIVACY_REVIEW: true,
        PROTECTED_FEATURE_EXCLUSION: true,
        SHADOW_HISTORY: true,
        MODEL_CARD: true,
        ROLLBACK: true,
        MONITORING: true,
        ZERO_COST: true,
      },
      baselineReference: "synthetic deterministic baseline",
      datasetFingerprint: "a".repeat(64),
      shadowHistoryDays: 30,
    });
    expect(syntheticSystemProof.reasons).toEqual([]);
    // This proves gate evaluation only; it is never loaded by getDataReadiness as beta evidence.
  });
});
