import { describe, expect, it } from "vitest";
import { productionConfigurationIssues } from "./runtime-config";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:password@db.example/recruitintel",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://beta.example",
  RESUME_STORAGE_KEY: "ab".repeat(32),
  ZERO_COST_MODE: "true",
  PRIVATE_BETA_MODE: "true",
};

describe("private-beta production configuration", () => {
  it("accepts core configuration without optional Google or extension values", () => {
    expect(productionConfigurationIssues(valid)).toEqual([]);
  });
  it("reports only safe required-key names and never values", () => {
    const issues = productionConfigurationIssues({ ...valid, BETTER_AUTH_SECRET: "short" });
    expect(issues).toEqual(["BETTER_AUTH_SECRET"]);
    expect(JSON.stringify(issues)).not.toContain("short");
  });
  it("permits local built-runtime origins while requiring valid production configuration", () => {
    expect(
      productionConfigurationIssues({ ...valid, BETTER_AUTH_URL: "http://127.0.0.1:3210" }),
    ).toEqual([]);
    expect(productionConfigurationIssues({ ...valid, ZERO_COST_MODE: "false" })).toContain(
      "ZERO_COST_MODE",
    );
  });
});
