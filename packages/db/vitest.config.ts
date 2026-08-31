import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one physical PostgreSQL database (TEST_DATABASE_URL) with
    // global, non-test-scoped fixture data (companies, sources, observations). Running test
    // files in parallel races materializeRecruitingDates and similar upsert-based sync logic
    // across files, intermittently violating unique constraints. Run files sequentially.
    fileParallelism: false,
  },
});
