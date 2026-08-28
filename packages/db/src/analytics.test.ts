import { describe, expect, it } from "vitest";
import {
  assertPointInTime,
  assertSafeFeatures,
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
  it("calculates bounded binary metrics for offline comparisons", () => {
    expect(
      binaryMetrics([
        { label: 1, prediction: 0.9 },
        { label: 0, prediction: 0.1 },
      ]).brier,
    ).toBeCloseTo(0.01);
  });
});
