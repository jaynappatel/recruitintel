import { ArrowRight, Building2, BriefcaseBusiness, RadioTower, Sparkles } from "lucide-react";
import Link from "next/link";

import { getDashboardSummary, listCompanies, listEvents, listJobs } from "@recruitintel/db";

import { CompanyCard } from "@/components/company-card";
import { DatabaseError } from "@/components/database-error";
import { DemoNotice } from "@/components/demo-notice";
import { EmptyState } from "@/components/empty-state";
import { EventList } from "@/components/event-list";
import { JobList } from "@/components/job-list";
import { PageHeader } from "@/components/page-header";
import { RecommendationsPanel } from "@/components/personalization/recommendations-panel";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let data;
  let errorMessage: string | undefined;
  try {
    const [summary, companies, jobs, events] = await Promise.all([
      getDashboardSummary(),
      listCompanies(4, 0),
      listJobs({ earlyCareerOnly: true, limit: 5 }),
      listEvents({ limit: 6 }),
    ]);
    data = { summary, companies, jobs, events };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (!data) {
    return (
      <>
        <PageHeader
          description="Monitor source-backed recruiting changes without confusing activity with prediction."
          eyebrow="Intelligence overview"
          title="Recruiting signal desk"
        />
        <DatabaseError message={errorMessage} />
      </>
    );
  }

  const metrics = [
    { label: "Tracked companies", value: data.summary.companies, icon: Building2 },
    { label: "Open jobs", value: data.summary.openJobs, icon: BriefcaseBusiness },
    { label: "Early-career roles", value: data.summary.earlyCareerJobs, icon: Sparkles },
    { label: "Signals · 7 days", value: data.summary.eventsSevenDays, icon: RadioTower },
  ];

  return (
    <>
      <PageHeader
        action={
          <div className="flex items-center gap-3">
            <Link className={buttonVariants({ size: "sm" })} href="/today">
              Open today&apos;s queue
            </Link>
            <Badge tone="neutral">Ranked by your settings, not ML</Badge>
          </div>
        }
        description="Monitor source-backed recruiting changes without confusing activity with prediction."
        eyebrow="Intelligence overview"
        title="Recruiting signal desk"
      />
      <DemoNotice />
      <OnboardingChecklist />

      <section
        aria-label="Summary metrics"
        className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {metrics.map(({ label, value, icon: Icon }) => (
          <div className="surface p-5" key={label}>
            <div className="flex items-center justify-between text-[var(--muted)]">
              <span className="text-xs font-bold tracking-wide uppercase">{label}</span>
              <Icon className="size-4" />
            </div>
            <div className="metric-number mt-4 text-4xl font-semibold text-[var(--ink)]">
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-8">
        <div className="mb-4">
          <div className="eyebrow mb-1">For you</div>
          <h2 className="m-0 font-serif text-2xl font-semibold">Opportunities to review</h2>
          <p className="mt-1 mb-0 text-sm text-[var(--muted)]">
            Ranked using the preferences you set — not a prediction of who gets hired.
          </p>
        </div>
        <RecommendationsPanel compact />
      </section>

      <section className="mb-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">Coverage</div>
            <h2 className="m-0 font-serif text-2xl font-semibold">Companies in focus</h2>
          </div>
          <Link
            className="flex items-center gap-1 text-sm font-bold text-[var(--accent)]"
            href="/companies"
          >
            View all <ArrowRight className="size-4" />
          </Link>
        </div>
        {data.companies.items.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {data.companies.items.map((company) => (
              <CompanyCard company={company} key={company.id} />
            ))}
          </div>
        ) : (
          <EmptyState
            copy="Companies appear here automatically as recruiting sources are connected."
            title="No companies yet"
          />
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] p-5">
            <div>
              <div className="eyebrow mb-1">Open now</div>
              <h2 className="m-0 font-serif text-2xl font-semibold">New target jobs</h2>
            </div>
            <Link className="text-xs font-bold text-[var(--accent)]" href="/jobs">
              All jobs
            </Link>
          </div>
          {data.jobs.items.length ? (
            <div className="px-5">
              <JobList compact jobs={data.jobs.items} />
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                copy="New roles show up here as soon as tracked companies post them."
                title="No open target jobs"
              />
            </div>
          )}
        </section>

        <section className="surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--line)] p-5">
            <div>
              <div className="eyebrow mb-1">Signal history</div>
              <h2 className="m-0 font-serif text-2xl font-semibold">Latest recruiting signals</h2>
            </div>
            <Link className="text-xs font-bold text-[var(--accent)]" href="/events">
              Full stream
            </Link>
          </div>
          {data.events.items.length ? (
            <div className="px-5">
              <EventList compact events={data.events.items} />
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                copy="Open, change, and close events will appear here."
                title="No events yet"
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
