"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { humanizeEnum } from "@recruitintel/shared";

type Watch = {
  id: string;
  entityType: string;
  entityLabel: string;
  entityHref: string;
  state: string;
  origin: string;
  notificationOverride: "INHERIT" | "ENABLED" | "DISABLED";
  successorPolicy: "MANUAL" | "AUTO_FOLLOW_DIRECT";
  resolvedSuccessor: { id: string; label: string; href: string } | null;
  createdAt: string;
};

export function WatchlistPanel() {
  const [items, setItems] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/watchlist?limit=100", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) throw new Error("Sign in to see your private watchlist");
      if (!response.ok) throw new Error("Watchlist is temporarily unavailable");
      setItems(((await response.json()) as { data: Watch[] }).data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Watchlist is unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function patch(id: string, value: Partial<Watch>) {
    const response = await fetch(`/api/watchlist/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) return setError("Could not update watch settings");
    const updated = ((await response.json()) as { data: Watch }).data;
    setItems((current) => current.map((item) => (item.id === id ? updated : item)));
  }

  async function remove(id: string) {
    const response = await fetch(`/api/watchlist/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!response.ok) return setError("Could not remove that watch");
    await load();
  }

  if (loading) {
    return (
      <div className="surface p-6 text-sm text-[var(--muted)]">
        <LoaderCircle className="mr-2 inline size-4 animate-spin" />
        Loading watch history
      </div>
    );
  }
  if (error && items.length === 0)
    return <div className="surface p-6 text-sm text-red-800">{error}</div>;
  return (
    <div className="surface overflow-hidden">
      {error && (
        <div className="border-b border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {items.length === 0 ? (
        <p className="m-0 p-6 text-sm text-[var(--muted)]">Nothing watched yet.</p>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {items.map((item) => (
            <article
              className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_14rem_14rem_auto] lg:items-center"
              key={item.id}
            >
              <div>
                <div className="mb-1 text-xs font-bold text-[var(--muted)] uppercase">
                  {humanizeEnum(item.entityType)} · {humanizeEnum(item.state)}
                </div>
                <Link
                  className="font-serif text-xl font-semibold hover:underline"
                  href={item.entityHref}
                  prefetch={false}
                >
                  {item.entityLabel}
                </Link>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Added {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                  {humanizeEnum(item.origin)}
                </div>
                {item.resolvedSuccessor && (
                  <p className="mt-2 mb-0 text-sm text-amber-800">
                    Historical target retained. Resolved successor:{" "}
                    <Link
                      className="font-bold underline"
                      href={item.resolvedSuccessor.href}
                      prefetch={false}
                    >
                      {item.resolvedSuccessor.label}
                    </Link>
                  </p>
                )}
              </div>
              <label className="text-xs font-bold text-[var(--muted)] uppercase">
                Alerts
                <select
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)]"
                  disabled={item.state !== "ACTIVE"}
                  onChange={(event) =>
                    void patch(item.id, {
                      notificationOverride: event.target.value as Watch["notificationOverride"],
                    })
                  }
                  value={item.notificationOverride}
                >
                  <option value="INHERIT">Use global setting</option>
                  <option value="ENABLED">Enabled</option>
                  <option value="DISABLED">Disabled</option>
                </select>
              </label>
              {item.entityType === "OPPORTUNITY" ? (
                <label className="text-xs font-bold text-[var(--muted)] uppercase">
                  Merge successor
                  <select
                    className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm font-normal text-[var(--ink)]"
                    disabled={item.state !== "ACTIVE"}
                    onChange={(event) =>
                      void patch(item.id, {
                        successorPolicy: event.target.value as Watch["successorPolicy"],
                      })
                    }
                    value={item.successorPolicy}
                  >
                    <option value="MANUAL">Ask me</option>
                    <option value="AUTO_FOLLOW_DIRECT">Follow direct merge</option>
                  </select>
                </label>
              ) : (
                <span />
              )}
              <button
                aria-label={`Remove ${item.entityLabel}`}
                className="rounded-lg p-2 text-[var(--muted)] hover:bg-black/5 disabled:opacity-40"
                disabled={item.state !== "ACTIVE"}
                onClick={() => void remove(item.id)}
                type="button"
              >
                <Trash2 className="size-4" />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
