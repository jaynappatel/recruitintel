import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { redactText, redactValue } from "./redaction";

interface Fixture {
  textCases: Array<{ input: string; expected: string; forbidden: string[] }>;
  objectCase: { input: unknown; expected: unknown; forbidden: string[] };
}

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../test-fixtures/redaction/golden.json"), "utf8"),
) as Fixture;

describe("redaction golden contract", () => {
  for (const testCase of fixture.textCases) {
    it(`redacts ${testCase.expected}`, () => {
      const result = redactText(testCase.input);
      expect(result).toBe(testCase.expected);
      for (const forbidden of testCase.forbidden) expect(result).not.toContain(forbidden);
    });
  }

  it("recursively redacts structured provider diagnostics", () => {
    const result = redactValue(fixture.objectCase.input);
    expect(result).toEqual(fixture.objectCase.expected);
    const serialized = JSON.stringify(result);
    for (const forbidden of fixture.objectCase.forbidden)
      expect(serialized).not.toContain(forbidden);
  });
});
