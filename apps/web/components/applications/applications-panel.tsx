"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { humanizeEnum } from "@recruitintel/shared";

type Application = {
  id: string;
  currentStatus: string;
  currentStage: string;
  createdAt: string;
  nextActionAt: string | null;
  nextActionReason: string | null;
  resolvedOpportunity: { id: string; title: string } | null;
  targetSnapshot: { companyName?: string; title?: string };
};
type Event = {
  id: string;
  eventType: string;
  toStatus: string | null;
  toStage: string | null;
  occurredAt: string;
  reasonCode: string | null;
};

export function ApplicationsPanel() {
  const router = useRouter();
  const [items, setItems] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/applications?limit=100", { cache: "no-store" });
      if (response.status === 401) throw new Error("Sign in to view your applications.");
      if (!response.ok) throw new Error("Applications are temporarily unavailable.");
      setItems((await response.json()).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Applications are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function open(item: Application) {
    setSelected(item);
    setEvents([]);
    const response = await fetch(`/api/applications/${item.id}/timeline`, { cache: "no-store" });
    if (response.ok) setEvents((await response.json()).data);
    else setError("The application history could not be loaded.");
  }

  async function transition(status: string, stage?: string) {
    if (!selected) return;
    const response = await fetch(`/api/applications/${selected.id}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, stage, idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) {
      setError("That lifecycle transition is not available from the current state.");
      return;
    }
    const updated = (await response.json()).data as Application;
    setSelected(updated);
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    await open(updated);
  }

  async function createAssessment() {
    if (!selected) return;
    const response = await fetch(`/api/applications/${selected.id}/assessments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "ONLINE_ASSESSMENT",
        dueAt: null,
        providerName: null,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) return setError("The OA record could not be created.");
    await transition("IN_PROCESS", "OA");
  }

  async function createInterview() {
    if (!selected) return;
    const response = await fetch(`/api/applications/${selected.id}/interviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interviewType: "INTERVIEW",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) return setError("The interview could not be created.");
    const interview = (await response.json()).data as { id: string };
    await transition("IN_PROCESS", "TECHNICAL_INTERVIEW");
    router.push(`/interviews/${interview.id}/prepare`);
  }

  if (loading)
    return (
      <div className="surface p-6 text-sm text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        Loading applications…
      </div>
    );
  if (error && !items.length)
    return (
      <div className="surface p-6 text-sm text-red-800">
        <p>{error}</p>
        <button className="font-bold underline" onClick={() => void load()} type="button">
          Try again
        </button>
      </div>
    );
  if (!items.length)
    return (
      <div className="surface p-6">
        <h2 className="m-0 font-serif text-xl">No applications yet</h2>
        <p className="mb-0 text-sm text-[var(--muted)]">
          Start from a canonical opportunity after reviewing its match and application source.
        </p>
      </div>
    );

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="surface overflow-hidden" aria-label="Application board">
        <div className="flex items-center justify-between border-b border-[var(--line)] p-4">
          <h2 className="m-0 font-serif text-xl">Your board</h2>
          <button
            aria-label="Refresh applications"
            className="rounded p-2"
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <button
              className="w-full p-4 text-left hover:bg-black/3"
              key={item.id}
              onClick={() => void open(item)}
              type="button"
            >
              <div className="font-semibold">
                {item.resolvedOpportunity?.title ??
                  item.targetSnapshot.title ??
                  "Historical opportunity"}
              </div>
              <div className="mt-1 text-sm text-[var(--muted)]">
                {humanizeEnum(item.currentStatus)} · {humanizeEnum(item.currentStage)}
              </div>
              {item.nextActionAt ? (
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Next: {new Date(item.nextActionAt).toLocaleDateString()}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      </section>
      <section className="surface p-5" aria-live="polite">
        {!selected ? (
          <p className="text-sm text-[var(--muted)]">
            Select an application to see its immutable timeline and allowed next steps.
          </p>
        ) : (
          <>
            <div className="eyebrow">{humanizeEnum(selected.currentStatus)}</div>
            <h2 className="mt-1 font-serif text-2xl">
              {selected.resolvedOpportunity?.title ??
                selected.targetSnapshot.title ??
                "Historical opportunity"}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              Current stage: {humanizeEnum(selected.currentStage)}
              {selected.nextActionReason ? ` · ${selected.nextActionReason}` : ""}
            </p>
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-[var(--panel)] px-3 py-2 text-sm font-bold text-white"
                onClick={() => void transition("APPLIED")}
                type="button"
              >
                Mark applied
              </button>
              <button
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
                onClick={() => void createAssessment()}
                type="button"
              >
                Add OA
              </button>
              <button
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
                onClick={() => void createInterview()}
                type="button"
              >
                Add interview
              </button>
              <button
                className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold"
                onClick={() => void transition("OFFER")}
                type="button"
              >
                Record offer
              </button>
            </div>
            <h3 className="text-sm font-bold">Timeline</h3>
            <ol className="m-0 space-y-3 pl-5 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="font-semibold">{humanizeEnum(event.eventType)}</span>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {new Date(event.occurredAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {error ? <p className="mt-4 text-sm text-red-800">{error}</p> : null}
      </section>
    </div>
  );
}
