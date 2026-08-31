import { describe, expect, it, vi } from "vitest";

vi.mock("@recruitintel/db", () => ({
  getOperationalDiagnostics: vi.fn(),
}));

import { getOperationalDiagnostics } from "@recruitintel/db";
import { GET } from "./route";

describe("M15 health endpoint", () => {
  it("returns only safe liveness information", async () => {
    vi.mocked(getOperationalDiagnostics).mockResolvedValue({
      database: "READY",
      migrationCount: 35,
      latestMigration: "0035_m15_operations.sql",
      work: { READY: 1 },
      deadLetters: 0,
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "READY" });
  });

  it("does not expose database errors", async () => {
    vi.mocked(getOperationalDiagnostics).mockRejectedValue(new Error("password=secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
