"use client";

import clsx from "clsx";

import {
  calendarCategories,
  calendarStatuses,
  type CalendarCategory,
  type CalendarStatus,
} from "@/lib/types/calendar";

import { categoryLabels, statusLabels } from "./labels";

export function CalendarFilterBar({
  activeCategories,
  activeStatuses,
  onToggleCategory,
  onToggleStatus,
  onReset,
}: {
  activeCategories: Set<CalendarCategory>;
  activeStatuses: Set<CalendarStatus>;
  onToggleCategory: (category: CalendarCategory) => void;
  onToggleStatus: (status: CalendarStatus) => void;
  onReset: () => void;
}) {
  const isFiltered =
    activeCategories.size < calendarCategories.length ||
    activeStatuses.size < calendarStatuses.length;

  return (
    <div className="surface flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
          Show
        </span>
        {calendarCategories.map((category) => (
          <button
            className={clsx(
              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
              activeCategories.has(category)
                ? "border-[var(--panel)] bg-[var(--panel)] text-white"
                : "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--panel)]",
            )}
            key={category}
            onClick={() => onToggleCategory(category)}
            type="button"
          >
            {categoryLabels[category]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
          Status
        </span>
        {calendarStatuses.map((status) => (
          <button
            className={clsx(
              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
              activeStatuses.has(status)
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-[var(--line)] bg-white text-[var(--muted)] hover:border-[var(--accent)]",
            )}
            key={status}
            onClick={() => onToggleStatus(status)}
            type="button"
          >
            {statusLabels[status]}
          </button>
        ))}
      </div>
      {isFiltered && (
        <button
          className="ml-auto text-xs font-bold text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          onClick={onReset}
          type="button"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
