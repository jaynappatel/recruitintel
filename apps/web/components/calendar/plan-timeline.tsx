import { formatCompactDate } from "@recruitintel/shared";

import type { ApplicationPlan } from "@/lib/types/calendar";

function offsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return "Opening day";
  if (offsetDays < 0) return `${Math.abs(offsetDays)} day${offsetDays === -1 ? "" : "s"} before`;
  return `${offsetDays} day${offsetDays === 1 ? "" : "s"} afterward`;
}

export function ApplicationPlanTimeline({ plan }: { plan: ApplicationPlan }) {
  return (
    <div>
      <p className="m-0 text-sm text-[var(--muted)]">
        Plan built around <strong className="text-[var(--ink)]">{plan.targetLabel}</strong> on{" "}
        {formatCompactDate(plan.targetDate)}.
      </p>
      <ol className="m-0 mt-4 list-none space-y-4 border-l border-[var(--line)] p-0 pl-5">
        {plan.tasks.map((task) => (
          <li className="relative" key={task.id}>
            <span className="absolute top-1.5 -left-[1.65rem] size-2.5 rounded-full border-2 border-white bg-[var(--panel)]" />
            <div className="text-[0.65rem] font-bold tracking-wide text-[var(--accent)] uppercase">
              {offsetLabel(task.offsetDays)}
            </div>
            <div className="text-sm font-bold">{task.title}</div>
            <div className="text-xs text-[var(--muted)]">{formatCompactDate(task.date)}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
