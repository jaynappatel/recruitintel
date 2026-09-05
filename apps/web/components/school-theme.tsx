"use client";

import { Building2, GraduationCap, Shield, Sparkles, Star } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type ThemeName = "auto" | "ut-austin";
type MarkName = "tower" | "cap" | "shield" | "star";

const themes: Record<ThemeName, { label: string; values: CSSProperties }> = {
  auto: {
    label: "Auto · light blue",
    values: {
      "--accent": "#3d88a5",
      "--accent-bright": "#68abc1",
      "--accent-soft": "rgb(61 136 165 / 15%)",
      "--tint-rose": "#dceff4",
      "--tint-rose-line": "#b8d8e2",
      "--paper": "#edf7fa",
      "--background": "#edf7fa",
      "--ink": "#173040",
    } as CSSProperties,
  },
  "ut-austin": {
    label: "UT Austin · burnt orange",
    values: {
      "--accent": "#bf5700",
      "--accent-bright": "#d87926",
      "--accent-soft": "rgb(191 87 0 / 14%)",
      "--tint-rose": "#fff0e3",
      "--tint-rose-line": "#edc9a8",
      "--paper": "#fbf7f1",
      "--background": "#fbf7f1",
      "--ink": "#2d2119",
    } as CSSProperties,
  },
};

const marks: Record<MarkName, { label: string; icon: typeof Building2 }> = {
  tower: { label: "Tower", icon: Building2 },
  cap: { label: "Cap", icon: GraduationCap },
  shield: { label: "Shield", icon: Shield },
  star: { label: "Star", icon: Star },
};

function suggestedTheme(name: string): ThemeName {
  return /texas|austin/i.test(name) ? "ut-austin" : "auto";
}

export function SchoolTheme({
  schoolName,
  schoolSlug,
  children,
}: {
  schoolName: string;
  schoolSlug: string;
  children: ReactNode;
}) {
  const storageKey = `recruitintel-school-theme:${schoolSlug}`;
  const defaultTheme = useMemo(() => suggestedTheme(schoolName), [schoolName]);
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return defaultTheme;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        theme?: ThemeName;
      } | null;
      return saved?.theme && saved.theme in themes ? saved.theme : defaultTheme;
    } catch {
      return defaultTheme;
    }
  });
  const [mark, setMark] = useState<MarkName>(() => {
    if (typeof window === "undefined") return "tower";
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as {
        mark?: MarkName;
      } | null;
      return saved?.mark && saved.mark in marks ? saved.mark : "tower";
    } catch {
      return "tower";
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ theme, mark }));
  }, [mark, storageKey, theme]);

  const Mark = marks[mark].icon;
  return (
    <div className="school-theme" style={themes[theme].values}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-semibold text-[var(--ink)]">
          <Sparkles aria-hidden="true" className="size-4 text-[var(--accent)]" />
          Make this school page yours
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="school-theme">
            School color theme
          </label>
          <select
            className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-2 text-xs font-semibold text-[var(--ink)]"
            id="school-theme"
            onChange={(event) => setTheme(event.target.value as ThemeName)}
            value={theme}
          >
            {Object.entries(themes).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white p-1">
            {Object.entries(marks).map(([value, option]) => {
              const Icon = option.icon;
              return (
                <button
                  aria-label={`Use ${option.label} mark`}
                  aria-pressed={mark === value}
                  className={`grid size-8 place-items-center rounded-md transition ${mark === value ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--accent-soft)]"}`}
                  key={value}
                  onClick={() => setMark(value as MarkName)}
                  title={option.label}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="school-theme-mark mb-5 flex items-center gap-4 rounded-2xl border border-[var(--tint-rose-line)] bg-[var(--tint-rose)] px-5 py-4">
        <div className="grid size-14 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-sm">
          <Mark aria-hidden="true" className="size-7" />
        </div>
        <div>
          <div className="eyebrow">{theme === "auto" ? "Campus profile" : themes[theme].label}</div>
          <div className="mt-1 font-serif text-2xl font-semibold text-[var(--ink)]">
            {schoolName}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
