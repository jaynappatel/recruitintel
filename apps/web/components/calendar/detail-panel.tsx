"use client";

import { CalendarPlus, Pencil, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatCompactDate } from "@recruitintel/shared";

import type {
  ApplicationPlan,
  CalendarItemView,
  CreateApplicationPlanInput,
  UpdateCalendarItemInput,
} from "@/lib/types/calendar";

import { CategoryLabel } from "./category-badge";
import { formatItemType, statusDescriptions } from "./labels";
import { ApplicationPlanTimeline } from "./plan-timeline";
import { CalendarStatusBadge } from "./status-badge";

const SUGGESTED_PREP_ACTIONS = [
  "Review resume",
  "Review company interview questions",
  "Practice LeetCode",
  "Prepare recruiter outreach",
  "Apply when the opening is confirmed",
];

export function CalendarDetailPanel({
  item,
  pendingPlanTarget,
  existingPlan,
  onClose,
  onCreatePlan,
  onActivatePlan,
  onUpdateItem,
  onDeleteItem,
}: {
  item: CalendarItemView | null;
  pendingPlanTarget: { companyName: string; companySlug?: string; companyId?: string } | null;
  existingPlan: ApplicationPlan | null;
  onClose: () => void;
  onCreatePlan: (input: CreateApplicationPlanInput) => Promise<void>;
  onActivatePlan: (plan: ApplicationPlan, sync: boolean) => Promise<void>;
  onUpdateItem: (id: string, input: UpdateCalendarItemInput) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [targetDate, setTargetDate] = useState(item?.date ?? nextWeekIso());
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? nextWeekIso());
  const [endDate, setEndDate] = useState(item?.endDate ?? item?.date ?? nextWeekIso());
  const [time, setTime] = useState(item?.time ?? "09:00");
  const [endTime, setEndTime] = useState(item?.endTime ?? "10:00");
  const [allDay, setAllDay] = useState(item?.allDay ?? true);
  const [timezone, setTimezone] = useState(item?.timezone ?? "UTC");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!item && !pendingPlanTarget) {
    return (
      <section className="surface p-6 text-center">
        <p className="m-0 text-sm text-[var(--muted)]">
          Select a date, a recruiting window, or an agenda item to see details here — or start an
          application plan from a company page.
        </p>
      </section>
    );
  }

  const companyName = item?.companyName ?? pendingPlanTarget?.companyName ?? "This company";
  const companySlug = item?.companySlug ?? pendingPlanTarget?.companySlug;
  const companyId = item?.companyId ?? pendingPlanTarget?.companyId;
  const targetLabel = item ? item.title : `${companyName} internship opening`;
  const effectiveTargetDate = item?.date ?? targetDate;
  const canEdit = item && item.itemSource !== "RECRUITING_INTELLIGENCE";

  return (
    <section className="surface overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] p-5">
        <div>
          <div className="eyebrow mb-1">{item ? "Selected" : "New plan"}</div>
          <h2 className="m-0 font-serif text-xl font-semibold">
            {item ? item.title : "Create application plan"}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && !editing && (
            <button
              aria-label="Edit calendar item"
              className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-soft)]"
              onClick={() => setEditing(true)}
              type="button"
            >
              <Pencil className="size-4" />
            </button>
          )}
          <button
            aria-label="Close details"
            className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-soft)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {error && (
          <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        )}

        {item && editing ? (
          <div className="space-y-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Title
              <input
                className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                {allDay ? "Start date" : "Date"}
                <input
                  className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                  onChange={(event) => {
                    setDate(event.target.value);
                    if (endDate < event.target.value) setEndDate(event.target.value);
                  }}
                  type="date"
                  value={date}
                />
              </label>
              {allDay ? (
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  End date (inclusive)
                  <input
                    className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                    min={date}
                    onChange={(event) => setEndDate(event.target.value)}
                    type="date"
                    value={endDate}
                  />
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Starts
                    <input
                      className="rounded-lg border border-[var(--line)] bg-white/70 px-2 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                      onChange={(event) => setTime(event.target.value)}
                      type="time"
                      value={time}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-semibold">
                    Ends
                    <input
                      className="rounded-lg border border-[var(--line)] bg-white/70 px-2 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                      onChange={(event) => setEndTime(event.target.value)}
                      type="time"
                      value={endTime}
                    />
                  </label>
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={allDay}
                className="size-4 accent-[var(--panel)]"
                onChange={(event) => setAllDay(event.target.checked)}
                type="checkbox"
              />
              All-day item
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Timezone
              <input
                className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                onChange={(event) => setTimezone(event.target.value)}
                value={timezone}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Notes
              <textarea
                className="min-h-20 rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                onChange={(event) => setNotes(event.target.value)}
                value={notes}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--panel)] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                disabled={saving || !title.trim()}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  try {
                    await onUpdateItem(item.id, {
                      title: title.trim(),
                      date,
                      endDate: allDay && endDate !== date ? endDate : undefined,
                      time: allDay ? undefined : time,
                      endTime: allDay ? undefined : endTime,
                      allDay,
                      timezone,
                      notes: notes.trim() || null,
                    });
                    setEditing(false);
                  } catch (caught) {
                    setError(
                      caught instanceof Error ? caught.message : "The item could not be saved.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
                type="button"
              >
                <Save className="size-4" /> {saving ? "Saving…" : "Save"}
              </button>
              <button
                className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold"
                onClick={() => setEditing(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="ml-auto inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-red-700"
                onClick={async () => {
                  if (!window.confirm("Delete this calendar item?")) return;
                  setSaving(true);
                  setError(null);
                  try {
                    await onDeleteItem(item.id);
                    onClose();
                  } catch (caught) {
                    setError(
                      caught instanceof Error ? caught.message : "The item could not be deleted.",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
                type="button"
              >
                <Trash2 className="size-4" /> Delete
              </button>
            </div>
          </div>
        ) : item ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryLabel category={item.category} />
              <CalendarStatusBadge status={item.status} />
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">{statusDescriptions[item.status]}</p>
            <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Type
                </dt>
                <dd className="m-0 font-semibold">{formatItemType(item.type)}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Date
                </dt>
                <dd className="m-0 font-semibold">
                  {formatCompactDate(item.date)}
                  {item.endDate && item.endDate !== item.date
                    ? ` – ${formatCompactDate(item.endDate)}`
                    : ""}
                  {!item.allDay && item.time ? ` at ${item.time}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Timezone
                </dt>
                <dd className="m-0 font-semibold">{item.timezone}</dd>
              </div>
              <div>
                <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                  Task status
                </dt>
                <dd className="m-0 font-semibold">{item.itemStatus.toLowerCase()}</dd>
              </div>
              {companyName && (
                <div>
                  <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                    Company
                  </dt>
                  <dd className="m-0 font-semibold">
                    {companySlug ? (
                      <Link
                        className="text-[var(--ink)] hover:underline"
                        href={`/companies/${companySlug}`}
                      >
                        {companyName}
                      </Link>
                    ) : (
                      companyName
                    )}
                  </dd>
                </div>
              )}
              {item.source && (
                <div>
                  <dt className="text-[0.65rem] font-bold tracking-wide text-[var(--muted)] uppercase">
                    Source
                  </dt>
                  <dd className="m-0 font-semibold">
                    {item.source.url ? (
                      <a
                        className="text-[var(--ink)] hover:underline"
                        href={item.source.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.source.name}
                      </a>
                    ) : (
                      item.source.name
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {item.notes && <p className="m-0 text-sm text-[var(--muted)]">{item.notes}</p>}
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={item.syncEnabled}
                className="size-4 accent-[var(--panel)]"
                onChange={(event) => {
                  setError(null);
                  void onUpdateItem(item.id, { syncEnabled: event.target.checked }).catch(
                    (caught: unknown) => {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "The sync setting could not be updated.",
                      );
                    },
                  );
                }}
                type="checkbox"
              />
              Include in Google Calendar sync
            </label>
          </>
        ) : null}

        {existingPlan ? (
          <div className="border-t border-[var(--line)] pt-4">
            <ApplicationPlanTimeline
              onActivate={(sync) => onActivatePlan(existingPlan, sync)}
              plan={existingPlan}
            />
          </div>
        ) : item?.category === "RECRUITING_DATE" || pendingPlanTarget ? (
          <div className="border-t border-[var(--line)] pt-4">
            <h3 className="m-0 mb-2 text-sm font-bold">Build a preparation plan</h3>
            <ul className="m-0 mb-4 list-none space-y-1.5 p-0 text-sm text-[var(--muted)]">
              {SUGGESTED_PREP_ACTIONS.map((action) => (
                <li className="flex items-start gap-2" key={action}>
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--muted)]" />
                  {action}
                </li>
              ))}
            </ul>
            {!item && (
              <label className="mb-3 flex flex-col gap-1.5 text-sm font-semibold">
                Target date
                <input
                  className="w-40 rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
                  onChange={(event) => setTargetDate(event.target.value)}
                  type="date"
                  value={targetDate}
                />
              </label>
            )}
            {!companyId && !companySlug && (
              <p className="mb-3 text-sm font-semibold text-amber-800">
                A canonical company association is required to create a plan.
              </p>
            )}
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)] disabled:opacity-60"
              disabled={creating || (!companyId && !companySlug)}
              onClick={async () => {
                setCreating(true);
                setError(null);
                try {
                  await onCreatePlan({
                    companyId,
                    companySlug,
                    companyName,
                    recruitingDateId: item?.recruitingDateId,
                    jobId: item?.jobId,
                    targetLabel,
                    targetDate: effectiveTargetDate,
                    timezone: item?.timezone,
                  });
                } catch (caught) {
                  setError(
                    caught instanceof Error ? caught.message : "The plan could not be created.",
                  );
                } finally {
                  setCreating(false);
                }
              }}
              type="button"
            >
              <CalendarPlus className="size-4" />
              {creating ? "Building plan…" : "Create application plan"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function nextWeekIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}
