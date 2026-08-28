import { ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";

import { getOpportunity } from "@recruitintel/db";
import { humanizeEnum } from "@recruitintel/shared";

import { DatabaseError } from "@/components/database-error";
import { PageHeader } from "@/components/page-header";
import { WatchButton } from "@/components/personalization/watch-button";
import { OpportunityActions } from "@/components/opportunity-actions";

export const dynamic = "force-dynamic";

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let opportunity;
  try {
    opportunity = await getOpportunity(id, true);
  } catch (error) {
    return <DatabaseError message={error instanceof Error ? error.message : undefined} />;
  }
  if (!opportunity) notFound();
  return (
    <>
      <PageHeader
        action={<WatchButton entityId={opportunity.id} entityType="OPPORTUNITY" />}
        description={`${opportunity.company.name} · ${opportunity.location || "Location not specified"}`}
        eyebrow="Canonical opportunity"
        title={opportunity.title}
      />
      <section className="surface p-6">
        <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Lifecycle", humanizeEnum(opportunity.lifecycleStatus)],
            ["Role family", humanizeEnum(opportunity.roleFamily)],
            ["Experience", humanizeEnum(opportunity.experienceLevel)],
            ["Workplace", humanizeEnum(opportunity.workplaceMode)],
            ["Source postings", String(opportunity.sourceCount)],
            [
              "Deadline",
              opportunity.deadlineAt
                ? new Date(opportunity.deadlineAt).toLocaleString()
                : "Unknown",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
                {label}
              </dt>
              <dd className="mt-1 ml-0 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {opportunity.status === "SUPERSEDED" && opportunity.supersededById && (
          <p className="mt-5 mb-0 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            This historical opportunity was superseded. Your original watch remains traceable; the
            resolved successor is {opportunity.supersededById}.
          </p>
        )}
        {opportunity.applicationUrl && (
          <a
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white"
            href={opportunity.applicationUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open authoritative application <ArrowUpRight className="size-4" />
          </a>
        )}
        <OpportunityActions opportunityId={opportunity.id} />
      </section>
    </>
  );
}
