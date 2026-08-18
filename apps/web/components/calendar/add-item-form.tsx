"use client";

import { useState } from "react";
import { X } from "lucide-react";

import type {
  CalendarCategory,
  CalendarItemType,
  CreateCalendarItemInput,
} from "@/lib/types/calendar";

import { formatItemType } from "./labels";

const TYPE_OPTIONS: Record<CalendarCategory, CalendarItemType[]> = {
  RECRUITING_DATE: [
    "INTERNSHIP_OPENING",
    "NEW_GRAD_OPENING",
    "APPLICATION_DEADLINE",
    "CAREER_FAIR",
    "CAMPUS_EVENT",
  ],
  ACTION: [
    "APPLY",
    "UPDATE_RESUME",
    "RECRUITER_OUTREACH",
    "FOLLOW_UP",
    "COMPLETE_OA",
    "RESEARCH_COMPANY",
  ],
  PREP_SESSION: [
    "LEETCODE",
    "SYSTEM_DESIGN",
    "BEHAVIORAL_PREP",
    "INTERVIEW_PREP",
    "MOCK_INTERVIEW",
    "RESUME_WORK",
  ],
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
  const [category, setCategory] = useState<CalendarCategory>("ACTION");
  const [type, setType] = useState<CalendarItemType>("APPLY");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="surface flex flex-col gap-4 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setSubmitting(true);
        await onSubmit({
          title: title.trim(),
          date,
          category,
          type,
          companyName: companyName.trim() || undefined,
        });
        setSubmitting(false);
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
              const nextCategory = event.target.value as CalendarCategory;
              setCategory(nextCategory);
              setType(TYPE_OPTIONS[nextCategory][0]!);
            }}
            value={category}
          >
            <option value="ACTION">Action</option>
            <option value="PREP_SESSION">Prep session</option>
            <option value="RECRUITING_DATE">Recruiting date</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Type
          <select
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setType(event.target.value as CalendarItemType)}
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

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Date
          <input
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setDate(event.target.value)}
            required
            type="date"
            value={date}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Company (optional)
          <input
            className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2 text-sm font-normal outline-none focus:border-[var(--accent)]"
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="e.g. Stripe"
            value={companyName}
          />
        </label>
      </div>

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
