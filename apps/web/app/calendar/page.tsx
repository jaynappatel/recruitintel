import { Suspense } from "react";

import { CalendarApp } from "@/components/calendar/calendar-app";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/ui/spinner";

export const metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        description="Confirmed dates, estimated windows, and the prep you've scheduled — always shown so you can tell which is which."
        eyebrow="Recruiting timeline"
        title="Calendar"
      />
      <Suspense
        fallback={
          <div className="surface grid h-64 place-items-center">
            <Spinner label="Loading calendar…" />
          </div>
        }
      >
        <CalendarApp />
      </Suspense>
    </>
  );
}
