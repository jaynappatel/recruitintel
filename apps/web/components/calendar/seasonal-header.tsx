"use client";

import { useMemo } from "react";

const seasons = [
  {
    name: "January",
    mark: "✦",
    accent: "#7894a0",
    soft: "#e7edf0",
    line: "#c5d4da",
    note: "fresh starts",
  },
  {
    name: "February",
    mark: "♡",
    accent: "#a66768",
    soft: "#f2e3de",
    line: "#ddc1b8",
    note: "small brave steps",
  },
  {
    name: "March",
    mark: "✿",
    accent: "#718b6d",
    soft: "#e8eee3",
    line: "#c9d8c1",
    note: "new growth",
  },
  {
    name: "April",
    mark: "✧",
    accent: "#7e9c9c",
    soft: "#e3eeee",
    line: "#c2d9d8",
    note: "open windows",
  },
  {
    name: "May",
    mark: "☼",
    accent: "#a97954",
    soft: "#f2ead7",
    line: "#dccba8",
    note: "longer days",
  },
  {
    name: "June",
    mark: "☀",
    accent: "#b87861",
    soft: "#f5e5d6",
    line: "#e1c5b0",
    note: "make room",
  },
  {
    name: "July",
    mark: "∿",
    accent: "#648d9a",
    soft: "#e1edf0",
    line: "#c0d6dc",
    note: "wide open",
  },
  {
    name: "August",
    mark: "⋒",
    accent: "#76906b",
    soft: "#e8ede0",
    line: "#cad6bd",
    note: "gather your people",
  },
  {
    name: "September",
    mark: "✎",
    accent: "#9b6b62",
    soft: "#f0e2d9",
    line: "#dbc3b5",
    note: "begin again",
  },
  {
    name: "October",
    mark: "✺",
    accent: "#a36b4d",
    soft: "#f2e4d2",
    line: "#dfc4a6",
    note: "follow the signal",
  },
  {
    name: "November",
    mark: "❋",
    accent: "#7c8875",
    soft: "#e8ebe0",
    line: "#cbd2c0",
    note: "steady work",
  },
  {
    name: "December",
    mark: "✧",
    accent: "#718b92",
    soft: "#e4ecec",
    line: "#c5d6d6",
    note: "soft landing",
  },
] as const;

export function SeasonalCalendarHeader({ month }: { month: number }) {
  const season = useMemo(() => seasons[month] ?? seasons[0], [month]);
  return (
    <div
      className="seasonal-calendar flex items-end justify-between px-6 py-5 md:px-8"
      style={
        {
          "--season-accent": season.accent,
          "--season-soft": season.soft,
          "--season-line": season.line,
        } as React.CSSProperties
      }
    >
      <div className="relative z-10">
        <div className="eyebrow" style={{ color: season.accent }}>
          monthly field notes
        </div>
        <div className="mt-1 font-serif text-5xl font-semibold tracking-[-0.045em] text-[var(--ink)]">
          {season.name}
        </div>
        <div className="mt-1 text-sm text-[var(--muted)]">
          {season.note} · your recruiting rhythm
        </div>
      </div>
      <div
        aria-hidden="true"
        className="seasonal-calendar-mark relative z-10 hidden rotate-[-8deg] md:block"
      >
        {season.mark}
      </div>
    </div>
  );
}
