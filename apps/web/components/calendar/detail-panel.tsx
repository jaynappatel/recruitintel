"use client";

import { CalendarPlus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatCompactDate } from "@recruitintel/shared";

import type {
  ApplicationPlan,
  CalendarItem,
  CreateApplicationPlanInput,
} from "@/lib/types/calendar";

import { CategoryLabel } from "./category-badge";
import { formatItemType, statusDescriptions } from "./labels";
import { ApplicationPlanTimeline } from "./plan-timeline";
import { CalendarStatusBadge } from "./status-badge";

const SUGGESTED_PREP_ACTIONS = [
  "Review resume",
  "Review company interview questions",
  "Practice LeetCode",
  "Prepare recruiter outreach",
  "Apply when the opening is confirmed",
];

export function CalendarDetailPanel({
  item,
  pendingPlanTarget,
  existingPlan,
  onClose,
  onCreatePlan,
}: {
  item: CalendarItem | null;
  pendingPlanTarget: { companyName: string; companySlug?: string; companyId?: string } | null;
  existingPlan: ApplicationPlan | null;
  onClose: () => void;
  onCreatePlan: (input: CreateApplicationPlanInput) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [targetDate, setTargetDate] = useState(item?.date ?? nextWeekIso());

  if (!item && !pendingPlanTarget) {
    return (
      <section className="surface p-6 text-center">
        <p className="m-0 text-sm text-[var(--muted)]">
          Select a date, a recruiting window, or an agenda item to see details here — or start an
          application plan from a company page.
        </p>
      </section>
    );
  }

  const companyName = item?.companyName ?? pendingPlanTarget?.companyName ?? "This company";
  const companySlug = item?.companySlug ?? pendingPlanTarget?.companySlug;
  const companyId = item?.companyId ?? pendingPlanTarget?.companyId;
  const targetLabel = item ? item.title : `${companyName} internship opening`;
  const effectiveTargetDate = item?.date ?? targetDate;

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] p-5">
        <div>
          <div className="eyebrow mb-1">{item ? "Selected" : "New plan"}</div>
          <h2 className="m-0 font-serif text-xl font-semibold">
            {item ? item.title : "Create application plan"}
          </h2>
        </div>
        <button
          aria-label="Close details"
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-soft)]"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-4 p-5">
        {item && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryLabel category={item.category} />
              <CalendarStatusBadge status={item.status} />
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">{statusDescriptions[item.status]}</p>
            <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Type
                </dt>
                <dd className="m-0 font-semibold">{formatItemType(item.type)}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Date
                </dt>
                <dd className="m-0 font-semibold">
                  {formatCompactDate(item.date)}
                  {item.endDate && item.endDate !== item.date
                    ? ` – ${formatCompactDate(item.endDate)}`
                    : ""}
                </dd>
              </div>
              {companyName && (
                <div>
                  <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                    Company
                  </dt>
                  <dd className="m-0 font-semibold">
                    {companySlug ? (
                      <Link
                        className="text-[var(--ink)] hover:underline"
                        href={`/companies/${companySlug}`}
                      >
                        {companyName}
                      </Link>
                    ) : (
                      companyName
                    )}
                  </dd>
                </div>
              )}
              {item.source && (
                <div>
                  <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                    Source
                  </dt>
                  <dd className="m-0 font-semibold">
                    {item.source.url ? (
                      <a
                        className="text-[var(--ink)] hover:underline"
                        href={item.source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.source.name}
                      </a>
                    ) : (
                      item.source.name
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </>
        )}

        {existingPlan ? (
          <div className="border-t border-[var(--line)] pt-4">
            <ApplicationPlanTimeline plan={existingPlan} />
          </div>
        ) : item?.category === "RECRUITING_DATE" || pendingPlanTarget ? (
          <div className="border-t border-[var(--line)] pt-4">
            <h3 className="m-0 mb-2 text-sm font-bold">Build a preparation plan</h3>
            <ul className="m-0 mb-4 list-none space-y-1.5 p-0 text-sm text-[var(--muted)]">
              {SUGGESTED_PREP_ACTIONS.map((action) => (
                <li className="flex items-start gap-2" key={action}>
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--muted)]" />
                  {action}
                </li>
              ))}
            </ul>
            {!item && (
              <label className="mb-3 flex flex-col gap-1.5 text-sm font-semibold">
                Target date
                <input
                  className="w-40 rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                  onChange={(event) => setTargetDate(event.target.value)}
                  type="date"
                  value={targetDate}
                />
              </label>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)] disabled:opacity-60"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                await onCreatePlan({
                  companyId,
                  companySlug,
                  companyName,
                  targetLabel,
                  targetDate: effectiveTargetDate,
                });
                setCreating(false);
              }}
              type="button"
            >
              <CalendarPlus className="size-4" />
              {creating ? "Building plan…" : "Create application plan"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function nextWeekIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}
