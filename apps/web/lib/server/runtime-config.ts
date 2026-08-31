type Environment = Record<string, string | undefined>;

function isThirtyTwoByteKey(value: string | undefined): boolean {
  if (!value) return false;
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return decoded.length === 32;
}

function validProductionUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

/** Production-only launch gate. Optional integrations deliberately remain optional. */
export function productionConfigurationIssues(env: Environment = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const issues: string[] = [];
  if (!env.DATABASE_URL?.startsWith("postgres")) issues.push("DATABASE_URL");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    issues.push("BETTER_AUTH_SECRET");
  if (!validProductionUrl(env.BETTER_AUTH_URL)) issues.push("BETTER_AUTH_URL");
  if (!isThirtyTwoByteKey(env.RESUME_STORAGE_KEY)) issues.push("RESUME_STORAGE_KEY");
  if (env.ZERO_COST_MODE !== "true") issues.push("ZERO_COST_MODE");
  if (env.PRIVATE_BETA_MODE !== "true") issues.push("PRIVATE_BETA_MODE");
  return issues;
}
