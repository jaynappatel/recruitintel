import { describe, expect, it } from "vitest";

import { formatRelativeTime, humanizeEnum } from "./index";

describe("shared display helpers", () => {
  it("humanizes stable enum values", () => {
    expect(humanizeEnum("SOFTWARE_ENGINEERING")).toBe("Software Engineering");
  });

  it("formats relative time against an explicit clock", () => {
    expect(formatRelativeTime("2026-08-16T12:00:00Z", new Date("2026-08-17T12:00:00Z"))).toBe(
      "yesterday",
    );
  });
});
