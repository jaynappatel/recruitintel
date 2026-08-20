"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { browserTimezone, getCompanyOptions } from "@/lib/api/calendar";
import type { CalendarCategory, Company, CreateCalendarItemInput } from "@/lib/types/calendar";

import { formatItemType } from "./labels";

type UserCalendarType = CreateCalendarItemInput["type"];

const TYPE_OPTIONS: Record<Exclude<CalendarCategory, "RECRUITING_DATE">, UserCalendarType[]> = {
  ACTION: ["APPLICATION_TASK", "RECRUITER_OUTREACH", "OA", "CAREER_EVENT", "CUSTOM"],
  PREP_SESSION: ["LEETCODE", "SYSTEM_DESIGN", "BEHAVIORAL_PREP", "INTERVIEW_PREP", "RESUME_WORK"],
};

export function AddCalendarItemForm({
  defaultDate,
  onCancel,
  onSubmit,
}: {
  defaultDate: string;
  onCancel: () => void;
  onSubmit: (input: CreateCalendarItemInput) => Promise<void>;
}) {
  const [category, setCategory] = useState<Exclude<CalendarCategory, "RECRUITING_DATE">>("ACTION");
  const [type, setType] = useState<UserCalendarType>("APPLICATION_TASK");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCompanyOptions()
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, []);

  return (
    <form
      className="surface flex flex-col gap-4 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
          await onSubmit({
            title: title.trim(),
            date,
            endDate: allDay && endDate !== date ? endDate : undefined,
            time: allDay ? undefined : time,
            endTime: allDay ? undefined : endTime,
            allDay,
            timezone,
            type,
            companyId: companyId || undefined,
            syncEnabled,
          });
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "The calendar item could not be added.",
          );
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <h3 className="m-0 font-serif text-lg font-semibold">Add task or session</h3>
        <button
          aria-label="Close"
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--surface-soft)]"
          onClick={onCancel}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      {error && (
        <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Title
        <input
          className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Prep for Datadog phone screen"
          required
          value={title}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Category
          <select
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => {
              const nextCategory = event.target.value as Exclude<
                CalendarCategory,
                "RECRUITING_DATE"
              >;
              setCategory(nextCategory);
              setType(TYPE_OPTIONS[nextCategory][0]!);
            }}
            value={category}
          >
            <option value="ACTION">Action</option>
            <option value="PREP_SESSION">Prep session</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Type
          <select
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setType(event.target.value as UserCalendarType)}
            value={type}
          >
            {TYPE_OPTIONS[category].map((option) => (
              <option key={option} value={option}>
                {formatItemType(option)}
              </option>
            ))}
          </select>
        </label>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {allDay ? "Start date" : "Date"}
          <input
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => {
              setDate(event.target.value);
              if (endDate < event.target.value) setEndDate(event.target.value);
            }}
            required
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
                required
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Timezone
          <input
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setTimezone(event.target.value)}
            required
            value={timezone}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Company (optional)
          <select
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setCompanyId(event.target.value)}
            value={companyId}
          >
            <option value="">No company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.canonicalName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          checked={syncEnabled}
          className="size-4 accent-[var(--panel)]"
          onChange={(event) => setSyncEnabled(event.target.checked)}
          type="checkbox"
        />
        Include this item in Google Calendar sync
      </label>

      <button
        className="self-start rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--panel-bright)] disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {submitting ? "Adding…" : "Add to calendar"}
      </button>
    </form>
  );
}
