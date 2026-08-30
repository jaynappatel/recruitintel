import { describe, expect, it, vi } from "vitest";

vi.mock("@recruitintel/db", () => ({
  getDataReadiness: vi.fn(),
}));
vi.mock("@/lib/server/authorization", () => ({
  authenticatedUserOrResponse: vi.fn(),
}));

import { getDataReadiness } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { GET } from "./route";

const report = {
  taskType: "PERSONALIZED_RANKING" as const,
  status: "NOT_READY" as const,
  eligibleSampleCount: 0,
  positiveLabelCount: 0,
  negativeLabelCount: 0,
  userCount: 0,
  companyCount: 0,
  timeSpanDays: 0,
  missingFeatureRate: 1,
  classImbalance: null,
  outcomeDelayDays: null,
  duplicateCount: 0,
  leakageRisks: ["No M14 materialized labeled dataset"],
  labelConfidence: "LOW" as const,
  reasons: ["PROMOTION_GATE_REAL_CONSENTED_LABELS_FAILED"],
  authoritativeMode: "DETERMINISTIC" as const,
  baselineReference: "M9 versioned weighted deterministic score",
  datasetFingerprint: null,
  shadowHistoryDays: 0,
  promotionGates: {
    REAL_CONSENTED_LABELS: false,
    REPRODUCIBLE_DATASET: false,
    POINT_IN_TIME_FEATURES: false,
    CHRONOLOGICAL_HOLDOUT: false,
    ENTITY_LEAKAGE_CONTROL: false,
    DETERMINISTIC_BASELINE_WIN: false,
    CALIBRATION: false,
    PRIVACY_REVIEW: false,
    PROTECTED_FEATURE_EXCLUSION: false,
    SHADOW_HISTORY: false,
    MODEL_CARD: false,
    ROLLBACK: false,
    MONITORING: false,
    ZERO_COST: false,
  },
};

describe("M21 admin readiness", () => {
  it("denies a regular beta user without querying readiness", async () => {
    vi.mocked(authenticatedUserOrResponse).mockResolvedValue({ user: { isAdmin: false } } as never);
    const response = await GET(new Request("http://localhost/api/admin/analytics/readiness"));
    expect(response.status).toBe(403);
    expect(getDataReadiness).not.toHaveBeenCalled();
  });

  it("returns aggregate gate status only to an admin", async () => {
    vi.mocked(authenticatedUserOrResponse).mockResolvedValue({ user: { isAdmin: true } } as never);
    vi.mocked(getDataReadiness).mockResolvedValue(report);
    const response = await GET(
      new Request("http://localhost/api/admin/analytics/readiness?taskType=PERSONALIZED_RANKING"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: report });
    expect(getDataReadiness).toHaveBeenCalledWith("PERSONALIZED_RANKING");
  });
});
