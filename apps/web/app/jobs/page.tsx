import { listJobs } from "@recruitintel/db";
import { jobsQuerySchema } from "@recruitintel/types";

import { DatabaseError } from "@/components/database-error";
import { EmptyState } from "@/components/empty-state";
import { JobList } from "@/components/job-list";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query : undefined;
  const roleFamily = typeof params.roleFamily === "string" ? params.roleFamily : undefined;
  const parsed = jobsQuerySchema.safeParse({
    query,
    roleFamily,
    earlyCareerOnly: params.earlyCareerOnly,
    limit: 100,
  });
  let jobs;
  let errorMessage: string | undefined;
  try {
    jobs = await listJobs(parsed.success ? parsed.data : { limit: 100 });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (!jobs) {
    return (
      <>
        <PageHeader
          description="Normalized, source-backed current job state."
          eyebrow="Opportunity index"
          title="Open jobs"
        />
        <DatabaseError message={errorMessage} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Current normalized job state from configured sources. Unchanged source polls refresh liveness without creating noisy events."
        eyebrow="Opportunity index"
        title="Open jobs"
      />
      <form className="surface mb-6 flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="min-w-56 flex-1 text-sm font-semibold">
          Search jobs, companies or locations
          <input
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 font-normal"
            name="query"
            placeholder="e.g. software Austin"
            defaultValue={query ?? ""}
          />
        </label>
        <label className="text-sm font-semibold">
          Early career
          <select
            className="mt-1 rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 font-normal"
            name="earlyCareerOnly"
            defaultValue={params.earlyCareerOnly === "true" ? "true" : "false"}
          >
            <option value="false">All roles</option>
            <option value="true">Internship / new grad</option>
          </select>
        </label>
        <button
          className="rounded-lg bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white"
          type="submit"
        >
          Search
        </button>
      </form>
      {jobs.items.length ? (
        <section className="surface overflow-hidden">
          <JobList jobs={jobs.items} />
        </section>
      ) : (
        <EmptyState
          copy="Run a configured Greenhouse or Lever source to populate jobs."
          title="No open jobs"
        />
      )}
    </>
  );
}
