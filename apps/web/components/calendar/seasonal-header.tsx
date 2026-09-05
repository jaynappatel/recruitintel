"use client";

import { useMemo } from "react";

import { MonthIllustration } from "./month-illustrations";

const seasons = [
  { name: "January", note: "fresh starts" },
  { name: "February", note: "small brave steps" },
  { name: "March", note: "new growth" },
  { name: "April", note: "open windows" },
  { name: "May", note: "longer days" },
  { name: "June", note: "make room" },
  { name: "July", note: "wide open" },
  { name: "August", note: "gather your people" },
  { name: "September", note: "begin again" },
  { name: "October", note: "follow the signal" },
  { name: "November", note: "steady work" },
  { name: "December", note: "soft landing" },
] as const;

export function SeasonalCalendarHeader({ month }: { month: number }) {
  const season = useMemo(() => seasons[month] ?? seasons[0], [month]);
  return (
    <div className="seasonal-calendar">
      <div className="window-bar">
        <div className="window-bar-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="window-bar-label">Monthly field notes</div>
      </div>
      <div className="flex items-end justify-between gap-4 px-6 py-6 md:px-8">
        <div>
          <div className="text-5xl leading-[0.95] font-extrabold tracking-tight text-[var(--ink)] md:text-6xl">
            {season.name}
          </div>
          <div className="mt-2 text-sm text-[var(--muted)]">
            {season.note} · your recruiting rhythm
          </div>
        </div>
        <MonthIllustration
          className="hidden size-16 shrink-0 text-[var(--accent)] md:block"
          month={month}
        />
      </div>
    </div>
  );
}
