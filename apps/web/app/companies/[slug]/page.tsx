import { ArrowUpRight, Building2, CalendarPlus, Link2, RadioTower } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCompany, listEvents, listJobs } from "@recruitintel/db";
import { humanizeEnum } from "@recruitintel/shared";

import { DatabaseError } from "@/components/database-error";
import { EmptyState } from "@/components/empty-state";
import { EventList } from "@/components/event-list";
import { JobList } from "@/components/job-list";
import { WatchButton } from "@/components/personalization/watch-button";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let companyResult;
  let errorMessage: string | undefined;
  try {
    companyResult = await getCompany(slug);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (errorMessage) return <DatabaseError message={errorMessage} />;
  if (!companyResult) notFound();
  const company = companyResult;

  let relatedData;
  try {
    const [jobs, events] = await Promise.all([
      listJobs({ companyId: company.id, limit: 20 }),
      listEvents({ companyId: company.id, limit: 20 }),
    ]);
    relatedData = { jobs, events };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (!relatedData) return <DatabaseError message={errorMessage} />;
  const { jobs, events } = relatedData;

  return (
    <>
      <header className="surface mb-6 overflow-hidden">
        <div className="glass-dark p-6 text-white md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="grid size-16 place-items-center rounded-2xl bg-[var(--accent)] font-serif text-3xl font-semibold text-white">
                {company.canonicalName.charAt(0)}
              </div>
              <div>
                <div className="mb-1 text-xs font-bold tracking-[0.14em] text-white/55 uppercase">
                  Company intelligence
                </div>
                <h1 className="m-0 font-serif text-4xl font-semibold tracking-[-0.035em] md:text-5xl">
                  {company.canonicalName}
                </h1>
                <p className="mt-2 mb-0 text-sm text-white/65">
                  {company.industry ?? "Industry not classified"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <WatchButton entityId={company.id} entityType="COMPANY" />
              <Link
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/14"
                href={`/calendar?plan=1&companySlug=${company.slug}&companyName=${encodeURIComponent(company.canonicalName)}`}
              >
                <CalendarPlus className="size-4" />
                Create application plan
              </Link>
              {company.careersUrl && (
                <a
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[var(--ink)]"
                  href={company.careersUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Careers site <ArrowUpRight className="size-4" />
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-px bg-[var(--line)] sm:grid-cols-3">
          {[
            { label: "Open jobs", value: company.openJobCount, icon: Building2 },
            { label: "Early-career", value: company.earlyCareerJobCount, icon: RadioTower },
            {
              label: "ATS",
              value: company.atsType ? humanizeEnum(company.atsType) : "Unmapped",
              icon: Link2,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div className="flex items-center gap-3 bg-white p-5" key={label}>
              <Icon aria-hidden="true" className="size-4 text-[var(--accent)]" />
              <div>
                <div className="text-[0.67rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  {label}
                </div>
                <div className="mt-0.5 text-lg font-bold">{value}</div>
              </div>
            </div>
          ))}
        </div>
      </header>

      <div className="mb-6 flex gap-2 overflow-x-auto">
        {[
          { label: "Jobs", href: "#jobs" },
          { label: "Signals", href: "#signals" },
        ].map((tab) => (
          <a
            className="shrink-0 rounded-full border border-[var(--line)] bg-white px-4 py-2 text-xs font-bold text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--ink)]"
            href={tab.href}
            key={tab.label}
          >
            {tab.label}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="surface overflow-hidden" id="jobs">
          <div className="border-b border-[var(--line)] p-5">
            <div className="eyebrow mb-1">Current state</div>
            <h2 className="m-0 font-serif text-2xl font-semibold">Open roles</h2>
          </div>
          {jobs.items.length ? (
            <JobList jobs={jobs.items} />
          ) : (
            <div className="p-5">
              <EmptyState
                copy="No active jobs are recorded for this company."
                title="No open roles"
              />
            </div>
          )}
        </section>

        <section className="surface overflow-hidden" id="signals">
          <div className="border-b border-[var(--line)] p-5">
            <div className="eyebrow mb-1">Historical evidence</div>
            <h2 className="m-0 font-serif text-2xl font-semibold">Latest signals</h2>
          </div>
          {events.items.length ? (
            <EventList events={events.items} />
          ) : (
            <div className="p-5">
              <EmptyState copy="No recruiting transitions are recorded yet." title="No signals" />
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 text-sm text-[var(--muted)]">
        <Link className="font-bold text-[var(--accent)] hover:underline" href="/companies">
          ← All companies
        </Link>
      </div>
    </>
  );
}
