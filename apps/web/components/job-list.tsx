import { ArrowUpRight, MapPin } from "lucide-react";
import Link from "next/link";

import type { JobRecord } from "@recruitintel/db";
import { formatCompactDate } from "@recruitintel/shared";

import { DemoBadge, RoleBadge } from "./badges";
import { TrackedExternalLink } from "./tracked-external-link";

export function JobList({ jobs, compact = false }: { jobs: JobRecord[]; compact?: boolean }) {
  return (
    <div className="divide-y divide-[var(--line)]">
      {jobs.map((job) => (
        <article className={compact ? "py-4" : "p-5"} key={job.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <RoleBadge value={job.roleFamily} />
                {job.isInternship && (
                  <span className="text-xs font-bold text-[var(--forest-bright)]">Internship</span>
                )}
                {job.isNewGrad && (
                  <span className="text-xs font-bold text-[var(--forest-bright)]">New grad</span>
                )}
                {job.isDemo && <DemoBadge />}
              </div>
              <h3 className="m-0 text-base leading-6 font-bold md:text-lg">{job.title}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
                <Link
                  className="font-semibold text-[var(--forest)] hover:underline"
                  href={`/companies/${job.companySlug}`}
                >
                  {job.companyName}
                </Link>
                <span className="inline-flex items-center gap-1">
                  <MapPin aria-hidden="true" className="size-3.5" />
                  {job.location || "Location not listed"}
                </span>
                <span>Seen {formatCompactDate(job.firstSeenAt)}</span>
              </div>
            </div>
            {job.isDemo ? (
              <span className="rounded-xl border border-dashed border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]">
                No live application
              </span>
            ) : (
              <TrackedExternalLink
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--forest)] px-3 py-2 text-xs font-bold text-white transition hover:bg-[var(--forest-bright)]"
                entityId={job.id}
                href={job.applicationUrl}
              >
                View source <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </TrackedExternalLink>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
