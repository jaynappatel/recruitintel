"use client";

import { formatCompactDate } from "@recruitintel/shared";
import Link from "next/link";

import type { CalendarItemView } from "@/lib/types/calendar";

import { CalendarStatusBadge } from "./status-badge";

function formatWindow(item: CalendarItemView): string {
  if (!item.endDate || item.endDate === item.date) return formatCompactDate(item.date);
  return `${formatCompactDate(item.date)} – ${formatCompactDate(item.endDate)}`;
}

export function UpcomingRecruitingWindows({
  items,
  onSelectItem,
}: {
  items: CalendarItemView[];
  onSelectItem: (id: string) => void;
}) {
  const windows = items.filter((item) => item.category === "RECRUITING_DATE").slice(0, 8);

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <div className="eyebrow mb-1">Recruiting windows</div>
        <h2 className="m-0 font-serif text-xl font-semibold">Upcoming recruiting windows</h2>
      </div>
      {windows.length === 0 ? (
        <p className="m-0 p-5 text-sm text-[var(--muted)]">No recruiting dates in range.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
          {windows.map((item) => (
            <li key={item.id}>
              <button
                className="flex w-full items-start justify-between gap-3 p-4 text-left transition hover:bg-[var(--surface-soft)]"
                onClick={() => onSelectItem(item.id)}
                type="button"
              >
                <div className="min-w-0">
                  {item.companySlug ? (
                    <Link
                      className="text-sm font-bold text-[var(--ink)] hover:underline"
                      href={`/companies/${item.companySlug}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.companyName}
                    </Link>
                  ) : (
                    <div className="text-sm font-bold text-[var(--ink)]">{item.companyName}</div>
                  )}
                  <p className="m-0 mt-0.5 text-sm text-[var(--muted)]">{item.title}</p>
                  <p className="m-0 mt-1 text-xs font-semibold text-[var(--muted)]">
                    {formatWindow(item)}
                  </p>
                </div>
                <CalendarStatusBadge status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
