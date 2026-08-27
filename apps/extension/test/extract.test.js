import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, cleanUrl, deduplicateCandidates } from "../extract.js";

test("sanitizes invisible hostile text and strips URL query/fragment", () => {
  assert.equal(cleanText("\u202e Senior\u200b Engineer  ", 300), "Senior Engineer");
  assert.equal(
    cleanUrl("https://jobs.example.test/opening?token=nope#section", "https://example.test"),
    "https://jobs.example.test/opening",
  );
  assert.equal(cleanUrl("javascript:alert(1)", "https://example.test"), null);
});

test("deduplicates a 40-job rendered fixture without retaining more than the cap", () => {
  const jobs = Array.from({ length: 40 }, (_, index) => ({
    kind: "GRID",
    url: `https://jobs.example.test/${index}`,
    title: `Engineer ${index}`,
  }));
  jobs.push({ kind: "JSON_LD", url: "https://jobs.example.test/1", title: "Engineer 1" });
  const result = deduplicateCandidates(jobs);
  assert.equal(result.length, 40);
  assert.equal(result.find((job) => job.url.endsWith("/1")).kind, "JSON_LD");
});
