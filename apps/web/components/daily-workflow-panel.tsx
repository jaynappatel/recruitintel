"use client";

import { CalendarDays, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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
              : "Workflow is temporarily unavailable",
          );
        setItems(((await response.json()) as { data: Item[] }).data);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Workflow is unavailable"),
      );
  }, []);
  if (error) return <div className="surface p-6 text-sm text-red-800">{error}</div>;
  if (!items)
    return (
      <div className="surface p-6 text-sm text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        Loading today&apos;s priorities
      </div>
    );
  return (
    <section aria-label="Daily priorities" className="surface overflow-hidden">
      <div className="border-b border-[var(--line)] p-5">
        <div className="eyebrow mb-1">Now · next 7 days</div>
        <h2 className="m-0 font-serif text-2xl font-semibold">Your priority queue</h2>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-sm text-[var(--muted)]">
          No due work or active alerts. Check back after your next recruiting signal.
        </div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <article className="flex items-start gap-3 p-5" key={`${item.source}:${item.id}`}>
              {item.urgency === "OVERDUE" ? (
                <CircleAlert className="mt-0.5 size-5 text-red-700" />
              ) : item.source === "CALENDAR" ? (
                <CalendarDays className="mt-0.5 size-5 text-[var(--forest)]" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-5 text-[var(--forest)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
                  {item.urgency} · {item.source}
                </div>
                <h3 className="mt-1 mb-0 font-semibold">{item.title}</h3>
                <p className="mt-1 mb-0 text-sm text-[var(--muted)]">{item.reason}</p>
                {item.dueAt && (
                  <time className="mt-2 block text-xs text-[var(--muted)]" dateTime={item.dueAt}>
                    {new Date(item.dueAt).toLocaleString()}
                  </time>
                )}
                <Link
                  className="mt-3 inline-block text-sm font-bold text-[var(--forest)] underline"
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
