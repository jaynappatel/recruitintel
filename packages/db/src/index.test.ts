import { describe, expect, it } from "vitest";

import { mapCompany, mapEvent, mapJob } from "./index";

describe("database row mappers", () => {
  it("maps PostgreSQL counts and timestamps to API-safe values", () => {
    const company = mapCompany({
      id: "10000000-0000-0000-0000-000000000001",
      canonical_name: "Example",
      slug: "example",
      website: null,
      careers_url: null,
      description: null,
      industry: null,
      ats_type: null,
      ats_identifier: null,
      open_job_count: "2",
      early_career_job_count: 1,
      latest_event_at: new Date("2026-01-01T00:00:00Z"),
    });
    expect(company.openJobCount).toBe(2);
    expect(company.latestEventAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not expose raw payloads in a job projection", () => {
    const job = mapJob({
      id: "40000000-0000-0000-0000-000000000001",
      company_id: "10000000-0000-0000-0000-000000000001",
      company_name: "Example",
      company_slug: "example",
      title: "Software Engineer Intern",
      location: "Remote",
      role_family: "SOFTWARE_ENGINEERING",
      experience_level: "INTERNSHIP",
      employment_type: "INTERNSHIP",
      is_internship: true,
      is_new_grad: false,
      application_url: "https://example.com/jobs/1",
      source_url: "https://example.com/jobs/1",
      source_name: "Example source",
      published_at: null,
      first_seen_at: new Date("2026-01-01T00:00:00Z"),
      last_seen_at: new Date("2026-01-01T00:00:00Z"),
      changed_at: new Date("2026-01-01T00:00:00Z"),
      closed_at: null,
      is_demo: false,
      raw_payload: { dangerous: "not exposed" },
    });
    expect(job).not.toHaveProperty("rawPayload");
  });

  it("normalizes numeric confidence", () => {
    const event = mapEvent({
      id: "70000000-0000-0000-0000-000000000001",
      company_id: "10000000-0000-0000-0000-000000000001",
      company_name: "Example",
      company_slug: "example",
      job_id: null,
      job_title: null,
      event_type: "HIRING_SIGNAL",
      occurred_at: new Date("2026-01-01T00:00:00Z"),
      discovered_at: new Date("2026-01-01T00:00:00Z"),
      source_name: "Example source",
      source_url: "https://example.com",
      confidence: "0.750",
      payload: {},
      is_demo: false,
    });
    expect(event.confidence).toBe(0.75);
  });
});
