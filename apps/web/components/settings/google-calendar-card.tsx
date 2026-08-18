"use client";

import { CalendarDays, Check, Loader2, RefreshCw, TriangleAlert, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

import {
  connectCalendarProvider,
  disconnectCalendarProvider,
  getCalendarIntegration,
  syncCalendar,
  updateCalendarSyncSetting,
} from "@/lib/api/calendar";
import type { CalendarIntegration } from "@/lib/types/calendar";

const SYNC_TOGGLES: Array<{ key: keyof CalendarIntegration["sync"]; label: string }> = [
  { key: "recruitingTasks", label: "Recruiting tasks" },
  { key: "leetcodeSessions", label: "LeetCode sessions" },
  { key: "applicationDeadlines", label: "Application deadlines" },
  { key: "careerEvents", label: "Career events" },
];

function formatSyncedAt(iso?: string): string {
  if (!iso) return "Never synced";
  const date = new Date(iso);
  return `Last synced ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

export function GoogleCalendarCard() {
  const [integration, setIntegration] = useState<CalendarIntegration | null>(null);

  useEffect(() => {
    getCalendarIntegration().then(setIntegration);
  }, []);

  if (!integration) {
    return <div className="surface h-40 animate-pulse" />;
  }

  const { status } = integration;

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--panel)] text-white">
            <CalendarDays className="size-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold">Google Calendar</h3>
            {status === "NOT_CONNECTED" && (
              <p className="m-0 text-xs text-[var(--muted)]">Not connected</p>
            )}
            {status === "CONNECTING" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                <Loader2 className="size-3 animate-spin" /> Connecting…
              </p>
            )}
            {status === "CONNECTED" && (
              <p className="m-0 text-xs text-[var(--muted)]">
                Connected as{" "}
                <span className="font-semibold text-[var(--ink)]">{integration.accountEmail}</span>
              </p>
            )}
            {status === "SYNCING" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                <Loader2 className="size-3 animate-spin" /> Syncing…
              </p>
            )}
            {status === "SYNC_ERROR" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-red-700">
                <TriangleAlert className="size-3" /> Sync error — try again
              </p>
            )}
          </div>
        </div>

        {status === "NOT_CONNECTED" && (
          <button
            className="rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)]"
            onClick={() => connectCalendarProvider().then(setIntegration)}
            type="button"
          >
            Connect Google Calendar
          </button>
        )}
        {status === "CONNECTING" && (
          <button
            className="rounded-xl bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-bold text-[var(--muted)]"
            disabled
            type="button"
          >
            Connecting…
          </button>
        )}
        {(status === "CONNECTED" || status === "SYNC_ERROR") && (
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm font-bold transition hover:border-[var(--accent)]"
              onClick={() => syncCalendar().then(setIntegration)}
              type="button"
            >
              <RefreshCw className="size-3.5" />
              Sync now
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-bold text-[var(--muted)] transition hover:text-red-700"
              onClick={() => disconnectCalendarProvider().then(setIntegration)}
              type="button"
            >
              <Unlink className="size-3.5" />
              Disconnect
            </button>
          </div>
        )}
        {status === "SYNCING" && (
          <button
            className="rounded-xl bg-[var(--surface-soft)] px-4 py-2.5 text-sm font-bold text-[var(--muted)]"
            disabled
            type="button"
          >
            Syncing…
          </button>
        )}
      </div>

      {(status === "CONNECTED" || status === "SYNCING" || status === "SYNC_ERROR") && (
        <div className="border-t border-[var(--line)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="m-0 text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
              Sync
            </h4>
            <span className="text-xs text-[var(--muted)]">
              {formatSyncedAt(integration.lastSyncedAt)}
            </span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {SYNC_TOGGLES.map(({ key, label }) => (
              <li className="flex items-center justify-between gap-3" key={key}>
                <span className="text-sm font-semibold">{label}</span>
                <button
                  aria-pressed={integration.sync[key]}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition ${
                    integration.sync[key] ? "bg-[var(--panel)]" : "bg-[var(--line)]"
                  }`}
                  onClick={() =>
                    updateCalendarSyncSetting(key, !integration.sync[key]).then(setIntegration)
                  }
                  type="button"
                >
                  <span
                    className={`absolute top-0.5 grid size-5 place-items-center rounded-full bg-white shadow transition ${
                      integration.sync[key] ? "left-[calc(100%-1.375rem)]" : "left-0.5"
                    }`}
                  >
                    {integration.sync[key] && (
                      <Check className="size-3 text-[var(--panel)]" strokeWidth={3} />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
