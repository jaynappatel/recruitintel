"use client";

import { CalendarDays, CheckCircle2, CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { Spinner } from "@/components/ui/spinner";

type Item = {
  id: string;
  source: string;
  kind: string;
  title: string;
  reason: string;
  dueAt: string | null;
  urgency: "OVERDUE" | "TODAY" | "UPCOMING";
  href: string;
  alertId: string | null;
  completed: boolean;
};

const urgencyTone: Record<Item["urgency"], BadgeTone> = {
  OVERDUE: "danger",
  TODAY: "accent",
  UPCOMING: "neutral",
};

const urgencyLabel: Record<Item["urgency"], string> = {
  OVERDUE: "Overdue",
  TODAY: "Due today",
  UPCOMING: "Upcoming",
};

export function DailyWorkflowPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/daily-workflow", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Sign in to see your workflow"
              : "Your daily workflow is temporarily unavailable",
          );
        setItems(((await response.json()) as { data: Item[] }).data);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Your daily workflow is unavailable"),
      );
  }, []);
  if (error)
    return (
      <NoticeBanner tone="error">
        {error}
        {" — try refreshing the page."}
      </NoticeBanner>
    );
  if (!items) return <Spinner className="surface p-6" label="Loading today's priorities…" />;
  return (
    <section aria-label="Daily priorities" className="surface overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <div className="eyebrow mb-1">Now · next 7 days</div>
        <h2 className="m-0 font-serif text-2xl font-semibold">Your priority queue</h2>
      </div>
      {items.length === 0 ? (
        <div className="p-5">
          <EmptyState
            copy="Once something needs your attention — an alert, a follow-up, an upcoming interview — it will show up here."
            title="Nothing due right now"
          />
        </div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <article className="flex items-start gap-3 p-5" key={`${item.source}:${item.id}`}>
              {item.urgency === "OVERDUE" ? (
                <CircleAlert aria-hidden="true" className="mt-0.5 size-5 text-[var(--danger)]" />
              ) : item.source === "CALENDAR" ? (
                <CalendarDays aria-hidden="true" className="mt-0.5 size-5 text-[var(--accent)]" />
              ) : (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 text-[var(--accent)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={urgencyTone[item.urgency]}>{urgencyLabel[item.urgency]}</Badge>
                  <span className="text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
                    {item.source}
                  </span>
                </div>
                <h3 className="mt-2 mb-0 font-semibold">{item.title}</h3>
                <p className="mt-1 mb-0 text-sm text-[var(--muted)]">{item.reason}</p>
                {item.dueAt && (
                  <time className="mt-2 block text-xs text-[var(--muted)]" dateTime={item.dueAt}>
                    {new Date(item.dueAt).toLocaleString()}
                  </time>
                )}
                <Link
                  className="mt-3 inline-block text-sm font-bold text-[var(--accent)] underline"
                  href={item.href}
                >
                  Open action
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
