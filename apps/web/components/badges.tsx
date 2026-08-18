import clsx from "clsx";

import { humanizeEnum } from "@recruitintel/shared";

const eventColors: Record<string, string> = {
  JOB_OPENED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  JOB_CHANGED: "bg-amber-100 text-amber-800 border-amber-200",
  JOB_CLOSED: "bg-slate-100 text-slate-700 border-slate-200",
};

export function EventBadge({ value }: { value: string }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full border px-2.5 py-1 text-[0.68rem] font-extrabold tracking-wide uppercase",
        eventColors[value] ?? "border-violet-200 bg-violet-100 text-violet-800",
      )}
    >
      {humanizeEnum(value)}
    </span>
  );
}

export function RoleBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-soft)] px-2.5 py-1 text-[0.68rem] font-bold text-[var(--forest)]">
      {humanizeEnum(value)}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span className="inline-flex rounded-full border border-dashed border-amber-400 bg-amber-50 px-2 py-0.5 text-[0.65rem] font-bold text-amber-800 uppercase">
      Demo record
    </span>
  );
}
