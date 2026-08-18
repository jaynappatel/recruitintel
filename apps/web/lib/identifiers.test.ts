import { describe, expect, it } from "vitest";

import { isCompanyIdentifier } from "./identifiers";

describe("company identifier validation", () => {
  it("accepts canonical slugs and UUIDs", () => {
    expect(isCompanyIdentifier("cloudflare")).toBe(true);
    expect(isCompanyIdentifier("10000000-0000-4000-8000-000000000001")).toBe(true);
  });

  it("rejects SQL-like and path-like input before querying", () => {
    expect(isCompanyIdentifier("' or true --")).toBe(false);
    expect(isCompanyIdentifier("../companies")).toBe(false);
  });
});
