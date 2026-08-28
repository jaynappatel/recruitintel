import { describe, expect, it, vi } from "vitest";

vi.mock("@recruitintel/db", () => ({
  getOperationalDiagnostics: vi.fn(),
}));
vi.mock("@/lib/server/authorization", () => ({
  requireAdmin: vi.fn(),
  authorizationApiError: vi.fn(
    () => new Response(JSON.stringify({ error: "denied" }), { status: 403 }),
  ),
}));

import { getOperationalDiagnostics } from "@recruitintel/db";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";
import { GET } from "./route";

describe("M15 admin operations diagnostic", () => {
  it("requires existing admin authorization before returning aggregate diagnostics", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({} as never);
    vi.mocked(getOperationalDiagnostics).mockResolvedValue({
      database: "READY",
      migrationCount: 35,
      latestMigration: "0035_m15_operations.sql",
      work: { READY: 2 },
      deadLetters: 0,
    });
    const response = await GET(new Request("http://localhost/api/admin/operations"));
    expect(response.status).toBe(200);
    expect(getOperationalDiagnostics).toHaveBeenCalledOnce();
  });

  it("does not query diagnostics after authorization fails", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("denied"));
    const response = await GET(new Request("http://localhost/api/admin/operations"));
    expect(response.status).toBe(403);
    expect(getOperationalDiagnostics).toHaveBeenCalledTimes(1);
    expect(authorizationApiError).toHaveBeenCalledOnce();
  });
});
