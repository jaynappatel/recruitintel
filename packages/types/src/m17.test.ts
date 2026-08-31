import { describe, expect, it } from "vitest";

import { dailyWorkflowItemSchema } from "./index";

describe("M17 daily workflow contract", () => {
  it("accepts an owner-scoped actionable item", () => {
    expect(
      dailyWorkflowItemSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        source: "APPLICATION",
        kind: "FOLLOW_UP",
        title: "Follow up",
        reason: "No update yet",
        dueAt: null,
        urgency: "TODAY",
        href: "/applications/00000000-0000-4000-8000-000000000001",
        alertId: null,
        completed: false,
      }).source,
    ).toBe("APPLICATION");
  });

  it("rejects malformed workflow state", () => {
    expect(() => dailyWorkflowItemSchema.parse({ source: "UNKNOWN" })).toThrow();
  });
});
