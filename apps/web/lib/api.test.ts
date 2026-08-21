import { describe, expect, it, vi } from "vitest";

import { apiError, databaseApiError } from "./api";

describe("API error redaction", () => {
  it("never exposes secrets or email addresses in envelopes", async () => {
    const response = apiError(
      400,
      "PROVIDER_ERROR",
      "access_token=secret for owner@example.com at https://app.test/cb?code=secret",
    );
    expect(await response.json()).toEqual({
      error: {
        code: "PROVIDER_ERROR",
        message: "access_token=[REDACTED] for [REDACTED_EMAIL] at https://app.test/cb",
      },
    });
  });

  it("logs a redacted structured exception and returns a generic database error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = databaseApiError(new Error("refresh_token=secret owner@example.com"));
    expect(response.status).toBe(503);
    expect(spy).toHaveBeenCalledOnce();
    const serialized = String(spy.mock.calls[0]?.[0]);
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("refresh_token=secret");
    spy.mockRestore();
  });
});
