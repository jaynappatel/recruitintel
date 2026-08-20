"use client";

import { Check } from "lucide-react";
import Link from "next/link";

import type { CalendarItemView } from "@/lib/types/calendar";
import { formatCompactDate } from "@recruitintel/shared";

import { CategoryLabel } from "./category-badge";
import { formatItemType } from "./labels";
import { CalendarStatusBadge } from "./status-badge";

export function UpcomingAgenda({
  items,
  onSelectItem,
  onToggleComplete,
}: {
  items: CalendarItemView[];
  onSelectItem: (id: string) => void;
  onToggleComplete: (item: CalendarItemView) => void;
}) {
  const actionable = items.filter((item) => item.category !== "RECRUITING_DATE");

  return (
    <section className="surface overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <div className="eyebrow mb-1">Next up</div>
        <h2 className="m-0 font-serif text-xl font-semibold">Upcoming agenda</h2>
      </div>
      {items.length === 0 ? (
        <p className="m-0 p-5 text-sm text-[var(--muted)]">
          Nothing scheduled in this window. Add a task or adjust your filters.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
          {items.slice(0, 10).map((item) => {
            const canComplete = actionable.includes(item);
            return (
              <li className="flex items-start gap-3 p-4" key={item.id}>
                {canComplete ? (
                  <button
                    aria-label={item.completed ? "Mark as not done" : "Mark as done"}
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition ${
                      item.completed
                        ? "border-[var(--panel)] bg-[var(--panel)] text-white"
                        : "border-[var(--line)] text-transparent hover:border-[var(--accent)]"
                    }`}
                    onClick={() => onToggleComplete(item)}
                    type="button"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </button>
                ) : (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-600" />
                )}
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onSelectItem(item.id)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryLabel category={item.category} />
                    <CalendarStatusBadge status={item.status} />
                  </div>
                  <p
                    className={`m-0 mt-1 text-sm leading-5 font-semibold ${item.completed ? "text-[var(--muted)] line-through" : ""}`}
                  >
                    {item.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                    <span>{formatItemType(item.type)}</span>
                    <span>·</span>
                    <span>{formatCompactDate(item.date)}</span>
                    {!item.allDay && item.time && <span>{item.time}</span>}
                    {item.companyName &&
                      (item.companySlug ? (
                        <Link
                          className="font-semibold text-[var(--ink)] hover:underline"
                          href={`/companies/${item.companySlug}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {item.companyName}
                        </Link>
                      ) : (
                        <span className="font-semibold">{item.companyName}</span>
                      ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
