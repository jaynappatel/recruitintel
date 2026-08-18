import { ArrowRight, BriefcaseBusiness } from "lucide-react";
import Link from "next/link";

import type { CompanyRecord } from "@recruitintel/db";
import { formatCompactDate } from "@recruitintel/shared";

export function CompanyCard({ company }: { company: CompanyRecord }) {
  return (
    <Link
      className="surface group block p-5 transition hover:-translate-y-0.5 hover:border-[var(--forest-bright)] hover:shadow-lg"
      href={`/companies/${company.slug}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-[var(--surface-soft)] font-serif text-lg font-bold text-[var(--forest)]">
          {company.canonicalName.charAt(0)}
        </div>
        <ArrowRight className="size-4 text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-[var(--forest)]" />
      </div>
      <h2 className="mt-5 mb-1 font-serif text-2xl font-semibold tracking-[-0.02em]">
        {company.canonicalName}
      </h2>
      <p className="m-0 min-h-10 text-sm leading-5 text-[var(--muted)]">
        {company.industry ?? "Industry not classified"}
      </p>
      <div className="mt-5 flex items-end justify-between border-t border-[var(--line)] pt-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--forest)]">
            <BriefcaseBusiness className="size-3.5" />
            {company.openJobCount} open
          </div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            {company.earlyCareerJobCount} early-career
          </div>
        </div>
        <div className="text-right text-[0.7rem] text-[var(--muted)]">
          Latest signal
          <br />
          <span className="font-semibold text-[var(--ink)]">
            {formatCompactDate(company.latestEventAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
