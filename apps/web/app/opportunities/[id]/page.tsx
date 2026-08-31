import { ArrowUpRight } from "lucide-react";
import { notFound } from "next/navigation";

import { getOpportunity } from "@recruitintel/db";
import { humanizeEnum } from "@recruitintel/shared";

import { DatabaseError } from "@/components/database-error";
import { PageHeader } from "@/components/page-header";
import { WatchButton } from "@/components/personalization/watch-button";
import { OpportunityActions } from "@/components/opportunity-actions";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { buttonVariants } from "@/components/ui/button";

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
        eyebrow="Opportunity"
        title={opportunity.title}
      />
      <section className="surface p-6">
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
          <NoticeBanner className="mt-5" compact tone="warning">
            This listing has been replaced by a newer posting. Your watch history is kept, and the
            new posting is {opportunity.supersededById}.
          </NoticeBanner>
        )}
        {opportunity.applicationUrl && (
          <a
            className={buttonVariants({ className: "mt-6" })}
            href={opportunity.applicationUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open application <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        )}
        <OpportunityActions opportunityId={opportunity.id} />
      </section>
    </>
  );
}
