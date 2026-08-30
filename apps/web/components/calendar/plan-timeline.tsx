"use client";

import { useState } from "react";

import { formatCompactDate } from "@recruitintel/shared";

import type { ApplicationPlan } from "@/lib/types/calendar";

function offsetLabel(offsetDays: number | null): string {
  if (offsetDays === null) return "Planned task";
  if (offsetDays === 0) return "Target day";
  if (offsetDays < 0) return `${Math.abs(offsetDays)} day${offsetDays === -1 ? "" : "s"} before`;
  return `${offsetDays} day${offsetDays === 1 ? "" : "s"} afterward`;
}

export function ApplicationPlanTimeline({
  plan,
  onActivate,
}: {
  plan: ApplicationPlan;
  onActivate: (sync: boolean) => Promise<void>;
}) {
  const [sync, setSync] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <p className="m-0 text-sm text-[var(--muted)]">
        Plan built around <strong className="text-[var(--ink)]">{plan.title}</strong> on{" "}
        {formatCompactDate(plan.targetDate)}.
      </p>
      <ol className="m-0 mt-4 list-none space-y-4 border-l border-[var(--line)] p-0 pl-5">
        {plan.tasks.map((task) => (
          <li className="relative" key={task.id}>
            <span className="absolute top-1.5 -left-[1.65rem] size-2.5 rounded-full border-2 border-white bg-[var(--panel)]" />
            <div className="text-[0.65rem] font-bold tracking-wide text-[var(--accent)] uppercase">
              {offsetLabel(task.relativeDayOffset)}
            </div>
            <div className="text-sm font-bold">{task.calendarItem.title}</div>
            <div className="text-xs text-[var(--muted)]">
              {formatCompactDate(
                task.calendarItem.startsOn ?? task.calendarItem.startsAt.slice(0, 10),
              )}
            </div>
          </li>
        ))}
      </ol>

      {plan.status === "DRAFT" ? (
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <label className="mb-3 flex items-start gap-2 text-sm font-semibold">
            <input
              checked={sync}
              className="mt-0.5 size-4 accent-[var(--panel)]"
              onChange={(event) => setSync(event.target.checked)}
              type="checkbox"
            />
            <span>
              Sync these tasks to Google Calendar
              <span className="block text-xs font-normal text-[var(--muted)]">
                Off by default. Activation never silently enables calendar sync.
              </span>
            </span>
          </label>
          {error && <p className="mb-3 text-sm font-semibold text-[var(--danger)]">{error}</p>}
          <button
            className="rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)] disabled:opacity-60"
            disabled={activating}
            onClick={async () => {
              setActivating(true);
              setError(null);
              try {
                await onActivate(sync);
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : "The plan could not be activated.",
                );
              } finally {
                setActivating(false);
              }
            }}
            type="button"
          >
            {activating ? "Activating…" : "Activate plan"}
          </button>
        </div>
      ) : (
        <p className="mt-5 mb-0 text-xs font-bold tracking-wide text-[var(--success)] uppercase">
          {plan.status === "ACTIVE" ? "Plan active" : plan.status.toLowerCase()}
        </p>
      )}
    </div>
  );
}
