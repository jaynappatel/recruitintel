import clsx from "clsx";
import { BookOpenCheck, CalendarRange, ListChecks } from "lucide-react";

import type { CalendarCategory } from "@/lib/types/calendar";

import { categoryLabels } from "./labels";

const styles: Record<CalendarCategory, { className: string; icon: typeof CalendarRange }> = {
  RECRUITING_DATE: { className: "text-sky-700", icon: CalendarRange },
  ACTION: { className: "text-[var(--ink)]", icon: ListChecks },
  PREP_SESSION: { className: "text-violet-700", icon: BookOpenCheck },
};

export function CategoryDot({ category }: { category: CalendarCategory }) {
  const dotColor = {
    RECRUITING_DATE: "bg-sky-600",
    ACTION: "bg-[var(--ink)]",
    PREP_SESSION: "bg-violet-600",
  }[category];
  return <span aria-hidden="true" className={clsx("size-1.5 shrink-0 rounded-full", dotColor)} />;
}

export function CategoryLabel({ category }: { category: CalendarCategory }) {
  const { className, icon: Icon } = styles[category];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-xs font-bold", className)}>
      <Icon aria-hidden="true" className="size-3.5" />
      {categoryLabels[category]}
    </span>
  );
}
