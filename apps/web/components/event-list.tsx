import { CircleDot } from "lucide-react";
import Link from "next/link";

import type { EventRecord } from "@recruitintel/db";
import { formatCompactDate } from "@recruitintel/shared";

import { DemoBadge, EventBadge } from "./badges";

export function EventList({
  events,
  compact = false,
}: {
  events: EventRecord[];
  compact?: boolean;
}) {
  return (
    <div className="divide-y divide-[var(--line)]">
      {events.map((event) => (
        <article className={compact ? "relative py-4 pl-8" : "relative p-5 pl-12"} key={event.id}>
          <CircleDot
            aria-hidden="true"
            className={`absolute text-[var(--accent)] ${compact ? "top-5 left-0 size-4" : "top-6 left-5 size-4"}`}
          />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <EventBadge value={event.eventType} />
                {event.isDemo && <DemoBadge />}
              </div>
              <h3 className="m-0 text-sm leading-5 font-bold md:text-base">
                {event.jobTitle ?? event.eventType}
              </h3>
              <div className="mt-1 text-sm text-[var(--muted)]">
                <Link
                  className="font-semibold text-[var(--ink)] hover:underline"
                  href={`/companies/${event.companySlug}`}
                >
                  {event.companyName}
                </Link>
                <span className="mx-2">·</span>
                {event.sourceName}
              </div>
            </div>
            <div className="text-right text-xs text-[var(--muted)]">
              <div>{formatCompactDate(event.occurredAt)}</div>
              <div className="mt-1">Confidence: {Math.round(event.confidence * 100)}%</div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
