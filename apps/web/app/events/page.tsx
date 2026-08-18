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
          description="Immutable recruiting transitions with provenance."
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
        description="Append-only job openings, meaningful changes, and source-confirmed closures with confidence and provenance."
        eyebrow="Recruiting timeline"
        title="Event stream"
      />
      {events.items.length ? (
        <section className="surface overflow-hidden">
          <EventList events={events.items} />
        </section>
      ) : (
        <EmptyState
          copy="Events are emitted only when normalized state changes."
          title="No events recorded"
        />
      )}
    </>
  );
}
