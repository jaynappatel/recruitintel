"use client";

import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { WatchEntityType } from "@recruitintel/db";

type WatchItem = { id: string; entityId: string };

const reasonByType = {
  COMPANY: "TARGET_COMPANY",
  OPPORTUNITY: "SAVED_FOR_LATER",
  RECRUITER: "RECRUITING_CONTACT",
  SCHOOL: "TARGET_SCHOOL",
} as const;

export function WatchButton({
  entityType,
  entityId,
}: {
  entityType: WatchEntityType;
  entityId: string;
}) {
  const [watch, setWatch] = useState<WatchItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/watchlist?state=ACTIVE&entityType=${entityType}&limit=100`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) return { data: [] };
        if (!response.ok) throw new Error("Watch state is temporarily unavailable");
        return (await response.json()) as { data: WatchItem[] };
      })
      .then((result) => setWatch(result.data.find((item) => item.entityId === entityId) ?? null))
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "Watch state is unavailable");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [entityId, entityType]);

  async function toggle() {
    setLoading(true);
    setError(null);
    try {
      if (watch) {
        const response = await fetch(`/api/watchlist/${watch.id}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Could not remove this watch");
        setWatch(null);
      } else {
        const response = await fetch("/api/watchlist", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityType,
            entityId,
            reason: reasonByType[entityType],
            notificationOverride: "INHERIT",
            successorPolicy: "MANUAL",
          }),
        });
        if (response.status === 401) throw new Error("Sign in to use private watchlists");
        if (!response.ok) throw new Error("Could not add this watch");
        const result = (await response.json()) as { data: WatchItem };
        setWatch(result.data);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Watch update failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="inline-flex items-center gap-2 rounded-xl border border-current/15 bg-white/10 px-4 py-2.5 text-sm font-bold transition hover:bg-white/20 disabled:opacity-60"
        disabled={loading}
        onClick={toggle}
        type="button"
      >
        {loading ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : watch ? (
          <BookmarkCheck aria-hidden="true" className="size-4" />
        ) : (
          <Bookmark aria-hidden="true" className="size-4" />
        )}
        {watch ? "Watching" : "Watch"}
      </button>
      {error && <span className="max-w-56 text-right text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}
