import clsx from "clsx";
import {
  CalendarCheck,
  CircleDashed,
  History,
  MessageCircleQuestion,
  UserRound,
} from "lucide-react";

import type { CalendarStatus } from "@/lib/types/calendar";

import { statusLabels } from "./labels";

/**
 * Visually distinct treatment per certainty level. CONFIRMED is the only
 * solid/filled state on purpose — ESTIMATED and HISTORICAL must never read
 * as confidently as a confirmed, source-verified date.
 */
const styles: Record<CalendarStatus, { className: string; icon: typeof CalendarCheck }> = {
  CONFIRMED: {
    className: "border-emerald-300 bg-emerald-600 text-white",
    icon: CalendarCheck,
  },
  ESTIMATED: {
    className: "border-dashed border-[var(--accent)] bg-[var(--accent-soft)] text-[#8a611f]",
    icon: CircleDashed,
  },
  HISTORICAL: {
    className: "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]",
    icon: History,
  },
  CLAIMED: {
    className: "border-dashed border-violet-400 bg-violet-50 text-violet-800",
    icon: MessageCircleQuestion,
  },
  USER_SCHEDULED: {
    className: "border-[var(--panel)] bg-[var(--panel)] text-white",
    icon: UserRound,
  },
};

export function CalendarStatusBadge({
  status,
  className,
}: {
  status: CalendarStatus;
  className?: string;
}) {
  const { className: styleClassName, icon: Icon } = styles[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.66rem] font-extrabold tracking-wide uppercase",
        styleClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {statusLabels[status]}
    </span>
  );
}
