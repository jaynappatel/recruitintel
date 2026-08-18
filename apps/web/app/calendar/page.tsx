import { Suspense } from "react";

import { CalendarApp } from "@/components/calendar/calendar-app";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        description="Confirmed dates, estimated windows, and the actions and prep sessions you've scheduled around them — never rendered as the same thing."
        eyebrow="Recruiting timeline"
        title="Calendar"
      />
      <Suspense
        fallback={
          <div className="surface grid h-64 place-items-center text-sm text-[var(--muted)]">
            Loading calendar…
          </div>
        }
      >
        <CalendarApp />
      </Suspense>
    </>
  );
}
