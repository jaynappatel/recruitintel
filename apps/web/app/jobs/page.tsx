import { listJobs } from "@recruitintel/db";

import { DatabaseError } from "@/components/database-error";
import { EmptyState } from "@/components/empty-state";
import { JobList } from "@/components/job-list";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  let jobs;
  let errorMessage: string | undefined;
  try {
    jobs = await listJobs({ limit: 100 });
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
