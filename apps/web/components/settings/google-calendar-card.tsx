"use client";

import { CalendarDays, Loader2, RefreshCw, TriangleAlert, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

import {
  disconnectGoogleCalendar,
  getGoogleCalendarAuthorizeUrl,
  getGoogleCalendars,
  getGoogleCalendarStatus,
  syncGoogleCalendar,
  updateGoogleCalendar,
} from "@/lib/api/calendar";
import type {
  CalendarProviderDisplayStatus,
  GoogleCalendarOption,
  GoogleCalendarStatus,
} from "@/lib/types/calendar";
import { Button } from "@/components/ui/button";
import { NoticeBanner } from "@/components/ui/notice-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";

const SYNC_TOGGLES: Array<{
  key: keyof GoogleCalendarStatus["preferences"];
  label: string;
}> = [
  { key: "syncApplicationTasks", label: "Recruiting tasks" },
  { key: "syncLeetcode", label: "LeetCode sessions" },
  { key: "syncRecruitingDates", label: "Application deadlines and recruiting dates" },
  { key: "syncInterviewPrep", label: "Interview prep" },
  { key: "syncCareerEvents", label: "Career events" },
];

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "Never synced";
  const date = new Date(iso);
  return `Last synced ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

export function GoogleCalendarCard() {
  const [integration, setIntegration] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarOption[] | null>(null);
  const [transientStatus, setTransientStatus] = useState<"CONNECTING" | "SYNCING" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGoogleCalendarStatus()
      .then((status) => {
        setIntegration(status);
        setError(null);
        const callbackStatus = new URLSearchParams(window.location.search).get("googleCalendar");
        if (callbackStatus === "connected") {
          setMessage("Google Calendar connected.");
        } else if (callbackStatus === "error") {
          setError("Google Calendar authorization did not complete. Please try connecting again.");
        }
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Google Calendar status is currently unavailable.",
        );
      });
  }, []);

  useEffect(() => {
    if (integration?.status !== "CONNECTED" && integration?.status !== "ERROR") return;
    getGoogleCalendars()
      .then((options) => {
        setCalendars(options);
        setError(null);
      })
      .catch((caught: unknown) => {
        setCalendars([]);
        setError(
          caught instanceof Error ? caught.message : "Google calendars could not be loaded.",
        );
      });
  }, [integration?.status]);

  if (!integration && !error) {
    return <Skeleton className="h-40" />;
  }

  if (!integration) {
    return (
      <NoticeBanner
        action={
          <Button
            onClick={() => {
              setError(null);
              getGoogleCalendarStatus()
                .then(setIntegration)
                .catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : "Calendar API unavailable.");
                });
            }}
            size="sm"
            variant="secondary"
          >
            Try again
          </Button>
        }
        tone="error"
      >
        {error}
      </NoticeBanner>
    );
  }

  const status: CalendarProviderDisplayStatus = transientStatus ?? integration.status;
  const connectedSurface = ["CONNECTED", "ERROR", "SYNCING"].includes(status);

  async function beginAuthorization() {
    setTransientStatus("CONNECTING");
    setError(null);
    setMessage(null);
    try {
      const authorizeUrl = await getGoogleCalendarAuthorizeUrl();
      window.location.assign(authorizeUrl);
    } catch (caught) {
      setTransientStatus(null);
      setError(caught instanceof Error ? caught.message : "Google authorization could not start.");
    }
  }

  async function queueSync() {
    setTransientStatus("SYNCING");
    setError(null);
    setMessage(null);
    try {
      const request = await syncGoogleCalendar();
      setMessage(`Calendar sync queued (${request.status.toLowerCase()}).`);
      void getGoogleCalendarStatus()
        .then(setIntegration)
        .catch(() => {
          // The accepted queue response remains authoritative even if status refresh is unavailable.
        });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Calendar sync could not be queued.");
    } finally {
      setTransientStatus(null);
    }
  }

  async function disconnect() {
    setError(null);
    setMessage(null);
    try {
      setIntegration(await disconnectGoogleCalendar());
      setCalendars(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Google Calendar could not be disconnected.",
      );
    }
  }

  return (
    <div className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[var(--panel)] text-white">
            <CalendarDays className="size-5" />
          </div>
          <div>
            <h3 className="m-0 text-sm font-bold">Google Calendar</h3>
            {status === "DISCONNECTED" && (
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
                <span className="font-semibold text-[var(--ink)]">
                  {integration.accountEmail ?? "Google account"}
                </span>
              </p>
            )}
            {status === "SYNCING" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                <Loader2 className="size-3 animate-spin" /> Queueing sync…
              </p>
            )}
            {status === "REAUTH_REQUIRED" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--warning)]">
                <TriangleAlert className="size-3" /> Reauthorization required
              </p>
            )}
            {status === "ERROR" && (
              <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-[var(--danger)]">
                <TriangleAlert className="size-3" /> Calendar connection error
              </p>
            )}
          </div>
        </div>

        {(status === "DISCONNECTED" || status === "REAUTH_REQUIRED") && (
          <button
            className="rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)]"
            onClick={beginAuthorization}
            type="button"
          >
            {status === "REAUTH_REQUIRED" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
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
        {(status === "CONNECTED" || status === "ERROR") && (
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm font-bold transition hover:border-[var(--accent)]"
              onClick={queueSync}
              type="button"
            >
              <RefreshCw className="size-3.5" />
              Sync now
            </button>
            {status === "ERROR" && (
              <button
                className="rounded-xl border border-[var(--line)] bg-white px-3.5 py-2.5 text-sm font-bold"
                onClick={beginAuthorization}
                type="button"
              >
                Reconnect
              </button>
            )}
            <button
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-bold text-[var(--muted)] transition hover:text-[var(--danger)]"
              onClick={disconnect}
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
            Queueing…
          </button>
        )}
      </div>

      {(message || error) && (
        <div
          className={`border-t border-[var(--line)] px-5 py-3 text-sm font-semibold ${
            error
              ? "bg-[var(--danger-bg)] text-[var(--danger)]"
              : "bg-[var(--success-bg)] text-[var(--success)]"
          }`}
          role="status"
        >
          {error ?? message}
        </div>
      )}

      {connectedSurface && (
        <div className="border-t border-[var(--line)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="m-0 text-xs font-bold tracking-wide text-[var(--muted)] uppercase">
              Sync
            </h4>
            <span className="text-xs text-[var(--muted)]">
              {formatSyncedAt(integration.lastSyncAt)}
            </span>
          </div>

          <label className="mb-4 flex flex-col gap-1.5 text-sm font-semibold">
            Target calendar
            <select
              className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)] disabled:text-[var(--muted)]"
              disabled={calendars === null || calendars.length === 0}
              onChange={async (event) => {
                setError(null);
                try {
                  setIntegration(
                    await updateGoogleCalendar({ selectedCalendarId: event.target.value }),
                  );
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "The target calendar could not be changed.",
                  );
                }
              }}
              value={integration.selectedCalendarId}
            >
              {(calendars ?? []).map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}
                  {calendar.primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </label>
          {calendars === null && (
            <p className="mb-4 text-xs text-[var(--muted)]">Loading Google calendars…</p>
          )}
          {calendars !== null && calendars.length === 0 && (
            <p className="mb-4 text-xs font-semibold text-[var(--warning)]">
              No owned Google calendars are available for synchronization.
            </p>
          )}

          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {SYNC_TOGGLES.map(({ key, label }) => (
              <li className="flex items-center justify-between gap-3" key={key}>
                <span className="text-sm font-semibold">{label}</span>
                <Toggle
                  label={label}
                  onChange={async (next) => {
                    setError(null);
                    try {
                      setIntegration(await updateGoogleCalendar({ preferences: { [key]: next } }));
                    } catch (caught) {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "The sync preference could not be saved.",
                      );
                    }
                  }}
                  pressed={integration.preferences[key]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
