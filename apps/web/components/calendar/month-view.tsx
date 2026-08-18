"use client";

import clsx from "clsx";

import type { CalendarItem } from "@/lib/types/calendar";

import { CategoryDot } from "./category-badge";
import { buildMonthGrid, isSameIsoMonth } from "./date-grid";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({
  year,
  month,
  items,
  today,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  items: CalendarItem[];
  today: string;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
}) {
  const grid = buildMonthGrid(year, month);
  const itemsByDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const start = item.date;
    const end = item.endDate ?? item.date;
    for (const iso of grid) {
      if (iso >= start && iso <= end) {
        itemsByDate.set(iso, [...(itemsByDate.get(iso) ?? []), item]);
      }
    }
  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-xl border border-b-0 border-[var(--line)] bg-[var(--line)] text-center">
        {WEEKDAYS.map((day) => (
          <div
            className="bg-[var(--surface-soft)] py-2 text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase"
            key={day}
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-xl border border-[var(--line)] bg-[var(--line)]">
        {grid.map((iso) => {
          const dayItems = itemsByDate.get(iso) ?? [];
          const inMonth = isSameIsoMonth(iso, year, month);
          const isToday = iso === today;
          const isSelected = iso === selectedDate;
          const dayNumber = Number(iso.slice(-2));
          return (
            <button
              className={clsx(
                "flex min-h-24 flex-col items-start gap-1.5 bg-white p-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
                !inMonth && "bg-[var(--surface-soft)] text-[var(--muted)]",
                isSelected && "ring-2 ring-inset ring-[var(--accent)]",
              )}
              key={iso}
              onClick={() => onSelectDate(iso)}
              type="button"
            >
              <span
                className={clsx(
                  "grid size-6 place-items-center rounded-full text-xs font-bold",
                  isToday && "bg-[var(--panel)] text-white",
                )}
              >
                {dayNumber}
              </span>
              <div className="flex flex-wrap gap-1">
                {dayItems.slice(0, 4).map((item) => (
                  <CategoryDot category={item.category} key={item.id} />
                ))}
                {dayItems.length > 4 && (
                  <span className="text-[0.6rem] font-bold text-[var(--muted)]">
                    +{dayItems.length - 4}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
