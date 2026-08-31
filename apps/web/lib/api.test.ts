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

  it("maps governance and privilege failures without exposing database details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const policyError = Object.assign(new Error("SOURCE_POLICY_NOT_EXECUTABLE"), {
      code: "P0001",
    });
    const policyResponse = databaseApiError(policyError);
    expect(policyResponse.status).toBe(409);
    expect(await policyResponse.json()).toEqual({
      error: {
        code: "SOURCE_POLICY_REVIEW_REQUIRED",
        message: "Source policy does not allow execution",
      },
    });
    const privilegeResponse = databaseApiError(
      Object.assign(new Error("private database detail"), { code: "42501" }),
    );
    expect(privilegeResponse.status).toBe(403);
    expect(await privilegeResponse.json()).toEqual({
      error: { code: "FORBIDDEN", message: "This operation is not permitted" },
    });
    spy.mockRestore();
  });
});
