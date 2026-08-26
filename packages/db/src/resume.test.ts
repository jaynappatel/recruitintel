import { describe, expect, it } from "vitest";

import { deterministicSkillCoverage, extractResumeSkills } from "./resume";

describe("deterministic resume evidence", () => {
  it("extracts only explicit bounded skills", () => {
    expect(extractResumeSkills("Built services with Python and React.")).toEqual([
      "python",
      "react",
    ]);
    expect(extractResumeSkills("Python project; familiar with data tooling.")).toEqual(["python"]);
  });

  it("does not invent related skills", () => {
    const result = deterministicSkillCoverage("Python", ["Python", "PyTorch"]);
    expect(result.matched).toEqual(["python"]);
    expect(result.unknown).toEqual(["pytorch"]);
    expect(result.eligibility).toBe("UNKNOWN");
    expect(result.reasonCodes).toEqual(["NO_EXPLICIT_EVIDENCE"]);
  });

  it("is reproducible for identical inputs", () => {
    expect(deterministicSkillCoverage("TypeScript SQL", ["SQL", "TypeScript"])).toEqual(
      deterministicSkillCoverage("TypeScript SQL", ["SQL", "TypeScript"]),
    );
  });
});
