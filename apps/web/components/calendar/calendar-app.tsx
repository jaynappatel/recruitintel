"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createApplicationPlan,
  createCalendarItem,
  getCalendarIntegration,
  getCalendarItems,
  updateCalendarItem,
} from "@/lib/api/calendar";
import {
  calendarCategories,
  calendarStatuses,
  type ApplicationPlan,
  type CalendarCategory,
  type CalendarIntegration,
  type CalendarItem,
  type CalendarStatus,
  type CreateCalendarItemInput,
} from "@/lib/types/calendar";

import { AddCalendarItemForm } from "./add-item-form";
import { addMonths, formatMonthLabel } from "./date-grid";
import { CalendarDetailPanel } from "./detail-panel";
import { CalendarFilterBar } from "./filter-bar";
import { MonthView } from "./month-view";
import { SyncStatusChip } from "./sync-status-chip";
import { UpcomingAgenda } from "./upcoming-agenda";
import { UpcomingRecruitingWindows } from "./upcoming-windows";
import { WeekView } from "./week-view";

const today = new Date().toISOString().slice(0, 10);

function todayYearMonth(): { year: number; month: number } {
  const [year, month] = today.split("-").map(Number) as [number, number];
  return { year, month: month - 1 };
}

export function CalendarApp() {
  const searchParams = useSearchParams();
  const deepLinkCompanySlug = searchParams.get("companySlug") ?? undefined;
  const deepLinkCompanyName = searchParams.get("companyName") ?? undefined;
  const wantsPlan = searchParams.get("plan") === "1";

  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [integration, setIntegration] = useState<CalendarIntegration | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(todayYearMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [plansByTarget, setPlansByTarget] = useState<Record<string, ApplicationPlan>>({});
  const [activeCategories, setActiveCategories] = useState<Set<CalendarCategory>>(
    new Set(calendarCategories),
  );
  const [activeStatuses, setActiveStatuses] = useState<Set<CalendarStatus>>(
    new Set(calendarStatuses),
  );

  const refresh = useCallback(async () => {
    const result = await getCalendarItems();
    setItems(result);
  }, []);

  useEffect(() => {
    Promise.all([getCalendarItems(), getCalendarIntegration()]).then(
      ([calItems, integrationState]) => {
        setItems(calItems);
        setIntegration(integrationState);
        setLoading(false);
      },
    );
  }, []);

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) => activeCategories.has(item.category) && activeStatuses.has(item.status),
      ),
    [items, activeCategories, activeStatuses],
  );

  const upcomingItems = useMemo(
    () =>
      filteredItems
        .filter((item) => (item.endDate ?? item.date) >= today)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [filteredItems],
  );

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const pendingPlanTarget =
    !selectedItem && wantsPlan && deepLinkCompanyName
      ? { companyName: deepLinkCompanyName, companySlug: deepLinkCompanySlug }
      : null;

  const planTargetKey = selectedItem?.id ?? deepLinkCompanySlug ?? deepLinkCompanyName;
  const existingPlan = planTargetKey ? (plansByTarget[planTargetKey] ?? null) : null;

  function toggleCategory(category: CalendarCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category) && next.size > 1) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleStatus(status: CalendarStatus) {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status) && next.size > 1) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  async function handleToggleComplete(item: CalendarItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, completed: !i.completed } : i)));
    await updateCalendarItem(item.id, { completed: !item.completed });
  }

  async function handleAddItem(input: CreateCalendarItemInput) {
    await createCalendarItem(input);
    await refresh();
    setShowAddForm(false);
  }

  async function handleCreatePlan(input: Parameters<typeof createApplicationPlan>[0]) {
    const plan = await createApplicationPlan(input);
    const key = selectedItem?.id ?? input.companySlug ?? input.companyName;
    setPlansByTarget((prev) => ({ ...prev, [key]: plan }));
    await refresh();
  }

  const monthLabel = formatMonthLabel(cursor.year, cursor.month);

  return (
    <div className="flex flex-col gap-6">
      <div className="surface flex flex-wrap items-center gap-3 p-4">
        <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-white p-1">
          {(["month", "week"] as const).map((option) => (
            <button
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                view === option ? "bg-[var(--panel)] text-white" : "text-[var(--muted)]"
              }`}
              key={option}
              onClick={() => setView(option)}
              type="button"
            >
              {option === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>

        {view === "month" && (
          <div className="flex items-center gap-2">
            <button
              aria-label="Previous month"
              className="grid size-8 place-items-center rounded-full border border-[var(--line)] bg-white hover:border-[var(--accent)]"
              onClick={() => setCursor((c) => addMonths(c.year, c.month, -1))}
              type="button"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="w-36 text-center text-sm font-bold">{monthLabel}</span>
            <button
              aria-label="Next month"
              className="grid size-8 place-items-center rounded-full border border-[var(--line)] bg-white hover:border-[var(--accent)]"
              onClick={() => setCursor((c) => addMonths(c.year, c.month, 1))}
              type="button"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-xs font-bold hover:border-[var(--accent)]"
              onClick={() => {
                setCursor(todayYearMonth());
                setSelectedDate(today);
              }}
              type="button"
            >
              Today
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {integration && <SyncStatusChip status={integration.status} />}
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--panel)] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[var(--panel-bright)]"
            onClick={() => setShowAddForm((prev) => !prev)}
            type="button"
          >
            <Plus className="size-3.5" />
            Add task / session
          </button>
        </div>
      </div>

      <CalendarFilterBar
        activeCategories={activeCategories}
        activeStatuses={activeStatuses}
        onReset={() => {
          setActiveCategories(new Set(calendarCategories));
          setActiveStatuses(new Set(calendarStatuses));
        }}
        onToggleCategory={toggleCategory}
        onToggleStatus={toggleStatus}
      />

      {showAddForm && (
        <AddCalendarItemForm
          defaultDate={selectedDate ?? today}
          onCancel={() => setShowAddForm(false)}
          onSubmit={handleAddItem}
        />
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-6">
          {loading ? (
            <div className="surface grid h-64 place-items-center text-sm text-[var(--muted)]">
              Loading calendar…
            </div>
          ) : view === "month" ? (
            <MonthView
              items={filteredItems}
              month={cursor.month}
              onSelectDate={(iso) => {
                setSelectedDate(iso);
                const match = filteredItems.find((item) => item.date === iso);
                setSelectedItemId(match?.id ?? null);
              }}
              selectedDate={selectedDate}
              today={today}
              year={cursor.year}
            />
          ) : (
            <WeekView
              anchorDate={selectedDate ?? today}
              items={filteredItems}
              onSelectDate={setSelectedDate}
              onSelectItem={setSelectedItemId}
              selectedDate={selectedDate}
              today={today}
            />
          )}

          <CalendarDetailPanel
            existingPlan={existingPlan}
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
            onCreatePlan={handleCreatePlan}
            pendingPlanTarget={pendingPlanTarget}
          />
        </div>

        <div className="flex flex-col gap-6">
          <UpcomingAgenda
            items={upcomingItems}
            onSelectItem={setSelectedItemId}
            onToggleComplete={handleToggleComplete}
          />
          <UpcomingRecruitingWindows items={upcomingItems} onSelectItem={setSelectedItemId} />
        </div>
      </div>
    </div>
  );
}
