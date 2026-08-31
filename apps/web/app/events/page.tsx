import { listEvents } from "@recruitintel/db";

import { DatabaseError } from "@/components/database-error";
import { EmptyState } from "@/components/empty-state";
import { EventList } from "@/components/event-list";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  let events;
  let errorMessage: string | undefined;
  try {
    events = await listEvents({ limit: 100 });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : undefined;
  }

  if (!events) {
    return (
      <>
        <PageHeader
          description="Every job opening, change, and closure we've tracked, each linked to its source."
          eyebrow="Recruiting timeline"
          title="Event stream"
        />
        <DatabaseError message={errorMessage} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="Job openings, changes, and closures as we detect them, each linked to its source."
        eyebrow="Recruiting timeline"
        title="Event stream"
      />
      {events.items.length ? (
        <section className="surface overflow-hidden">
          <EventList events={events.items} />
        </section>
      ) : (
        <EmptyState
          copy="Nothing to show yet — this fills in as tracked companies post, change, or close roles."
          title="No events recorded"
        />
      )}
    </>
  );
}
