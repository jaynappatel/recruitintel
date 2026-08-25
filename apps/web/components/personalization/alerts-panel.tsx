"use client";

import { Bell, CheckCheck, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

type Alert = {
  id: string;
  type: string;
  title: string;
  body: string;
  reasonCodes: string[];
  state: "UNREAD" | "READ" | "DISMISSED" | "EXPIRED";
  entity: { href: string } | null;
  createdAt: string;
};

export function AlertsPanel() {
  const [items, setItems] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/alerts?limit=100", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) throw new Error("Sign in to see private alerts");
      if (!response.ok) throw new Error("Alerts are temporarily unavailable");
      const values = ((await response.json()) as { data: Alert[] }).data;
      setItems(values);
      if (values.length) {
        void fetch("/api/alerts/shown", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alertIds: values.map((item) => item.id) }),
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Alerts are unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function open(item: Alert) {
    await fetch(`/api/alerts/${item.id}/open`, { method: "POST", credentials: "same-origin" });
    setItems((current) =>
      current.map((value) => (value.id === item.id ? { ...value, state: "READ" } : value)),
    );
  }

  async function dismiss(id: string) {
    const response = await fetch(`/api/alerts/${id}/dismiss`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok)
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, state: "DISMISSED" } : item)),
      );
  }

  async function markAllRead() {
    const response = await fetch("/api/alerts/mark-all-read", {
      method: "POST",
      credentials: "same-origin",
    });
    if (response.ok)
      setItems((current) =>
        current.map((item) => (item.state === "UNREAD" ? { ...item, state: "READ" } : item)),
      );
  }

  if (loading)
    return (
      <div className="surface p-6 text-sm text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        Loading alerts
      </div>
    );
  if (error) return <div className="surface p-6 text-sm text-red-800">{error}</div>;
  return (
    <div className="surface overflow-hidden">
      <div className="flex justify-end border-b border-[var(--line)] p-3">
        <button
          className="inline-flex items-center gap-2 text-xs font-bold"
          onClick={markAllRead}
          type="button"
        >
          <CheckCheck className="size-4" /> Mark all read
        </button>
      </div>
      {items.length === 0 ? (
        <div className="grid min-h-40 place-items-center p-6 text-center text-sm text-[var(--muted)]">
          <div>
            <Bell className="mx-auto mb-2 size-5" />
            No in-app alerts yet.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <article
              className={`p-5 ${item.state === "UNREAD" ? "bg-[var(--accent-soft)]" : "opacity-75"}`}
              key={item.id}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1 text-xs font-bold text-[var(--muted)] uppercase">
                    {humanizeEnum(item.type)} · {humanizeEnum(item.state)}
                  </div>
                  <h2 className="m-0 font-serif text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 mb-0 text-sm text-[var(--muted)]">{item.body}</p>
                  <p className="mt-2 mb-0 text-xs text-[var(--muted)]">
                    {item.reasonCodes.map(humanizeEnum).join(" · ")} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  aria-label="Dismiss alert"
                  className="rounded-lg p-2 hover:bg-black/5"
                  onClick={() => void dismiss(item.id)}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </div>
              {item.entity && item.state !== "DISMISSED" && (
                <Link
                  className="mt-3 inline-block text-sm font-bold text-[var(--forest)] underline"
                  href={item.entity.href}
                  onClick={() => void open(item)}
                  prefetch={false}
                >
                  Open update
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
