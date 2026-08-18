"use client";

import clsx from "clsx";

import type { CalendarItem } from "@/lib/types/calendar";

import { CalendarStatusBadge } from "./status-badge";
import { buildWeekRow, formatDayLabel } from "./date-grid";

export function WeekView({
  anchorDate,
  items,
  today,
  selectedDate,
  onSelectDate,
  onSelectItem,
}: {
  anchorDate: string;
  items: CalendarItem[];
  today: string;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
  onSelectItem: (id: string) => void;
}) {
  const week = buildWeekRow(anchorDate);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
      {week.map((iso) => {
        const dayItems = items
          .filter((item) => iso >= item.date && iso <= (item.endDate ?? item.date))
          .sort((a, b) => a.title.localeCompare(b.title));
        return (
          <div
            className={clsx(
              "surface flex min-h-40 flex-col gap-2 p-3",
              iso === selectedDate && "ring-2 ring-[var(--accent)]",
            )}
            key={iso}
          >
            <button
              className="flex items-center justify-between text-left"
              onClick={() => onSelectDate(iso)}
              type="button"
            >
              <span className="text-xs font-bold text-[var(--muted)]">{formatDayLabel(iso)}</span>
              {iso === today && (
                <span className="rounded-full bg-[var(--panel)] px-2 py-0.5 text-[0.6rem] font-bold text-white">
                  Today
                </span>
              )}
            </button>
            <div className="flex flex-col gap-1.5">
              {dayItems.length === 0 && (
                <p className="m-0 text-xs text-[var(--muted)]">Nothing scheduled.</p>
              )}
              {dayItems.map((item) => (
                <button
                  className="rounded-lg border border-[var(--line)] bg-white/70 px-2 py-1.5 text-left text-xs font-semibold transition hover:border-[var(--accent)]"
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  type="button"
                >
                  <span className="line-clamp-2">{item.title}</span>
                  <CalendarStatusBadge className="mt-1.5" status={item.status} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
