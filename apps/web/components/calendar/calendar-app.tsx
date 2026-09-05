"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  activateApplicationPlan,
  completeCalendarItem,
  createApplicationPlan,
  createCalendarItem,
  deleteCalendarItem,
  getGoogleCalendarStatus,
  getCalendarItems,
  listApplicationPlans,
  updateCalendarItem,
} from "@/lib/api/calendar";
import {
  calendarCategories,
  calendarStatuses,
  type ApplicationPlan,
  type CalendarCategory,
  type CalendarItemView,
  type CalendarStatus,
  type CreateCalendarItemInput,
  type GoogleCalendarStatus,
  type UpdateCalendarItemInput,
} from "@/lib/types/calendar";

import { AddCalendarItemForm } from "./add-item-form";
import { addMonths, formatMonthLabel } from "./date-grid";
import { CalendarDetailPanel } from "./detail-panel";
import { CalendarFilterBar } from "./filter-bar";
import { MonthView } from "./month-view";
import { SyncStatusChip } from "./sync-status-chip";
import { SeasonalCalendarHeader } from "./seasonal-header";
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

  const [items, setItems] = useState<CalendarItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [integration, setIntegration] = useState<GoogleCalendarStatus | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(todayYearMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [plans, setPlans] = useState<ApplicationPlan[]>([]);
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
    Promise.all([getCalendarItems(), listApplicationPlans()])
      .then(([calItems, applicationPlans]) => {
        setItems(calItems);
        setPlans(applicationPlans);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "The calendar could not be loaded.");
      })
      .finally(() => {
        setLoading(false);
      });
    getGoogleCalendarStatus()
      .then(setIntegration)
      .catch(() => setIntegration(null));
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
  const existingPlan = useMemo(() => {
    if (!planTargetKey) return null;
    const currentPlans = plans.filter((plan) => plan.status !== "ARCHIVED");
    if (selectedItem?.planId) {
      const direct = currentPlans.find((plan) => plan.id === selectedItem.planId);
      if (direct) return direct;
    }
    if (selectedItem?.recruitingDateId) {
      const byDate = currentPlans.find(
        (plan) => plan.recruitingDateId === selectedItem.recruitingDateId,
      );
      if (byDate) return byDate;
    }
    const companyId = selectedItem?.companyId;
    if (companyId) {
      const byCompanyAndDate = currentPlans.find(
        (plan) => plan.company.id === companyId && plan.targetDate === selectedItem?.date,
      );
      if (byCompanyAndDate) return byCompanyAndDate;
      return currentPlans.find((plan) => plan.company.id === companyId) ?? null;
    }
    const companySlug = selectedItem?.companySlug ?? deepLinkCompanySlug;
    return currentPlans.find((plan) => plan.company.slug === companySlug) ?? null;
  }, [deepLinkCompanySlug, planTargetKey, plans, selectedItem]);

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

  function replaceItem(updated: CalendarItemView) {
    setItems((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function handleToggleComplete(item: CalendarItemView) {
    setError(null);
    try {
      const updated = item.completed
        ? await updateCalendarItem(item.id, { status: "TODO" })
        : await completeCalendarItem(item.id);
      replaceItem(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task status could not be updated.");
    }
  }

  async function handleAddItem(input: CreateCalendarItemInput) {
    await createCalendarItem(input);
    await refresh();
    setShowAddForm(false);
  }

  async function handleCreatePlan(input: Parameters<typeof createApplicationPlan>[0]) {
    const plan = await createApplicationPlan(input);
    setPlans((previous) => [plan, ...previous.filter((candidate) => candidate.id !== plan.id)]);
    await refresh();
  }

  async function handleActivatePlan(plan: ApplicationPlan, sync: boolean) {
    const active = await activateApplicationPlan(plan.id, sync);
    setPlans((previous) =>
      previous.map((candidate) => (candidate.id === active.id ? active : candidate)),
    );
    await refresh();
  }

  async function handleUpdateItem(id: string, input: UpdateCalendarItemInput) {
    const updated = await updateCalendarItem(id, input);
    replaceItem(updated);
  }

  async function handleDeleteItem(id: string) {
    await deleteCalendarItem(id);
    setItems((previous) => previous.filter((item) => item.id !== id));
  }

  const monthLabel = formatMonthLabel(cursor.year, cursor.month);

  return (
    <div className="flex flex-col gap-6">
      <SeasonalCalendarHeader month={cursor.month} />
      {error && (
        <div className="surface border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-sm font-semibold text-[var(--danger)]">
          {error}
        </div>
      )}
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
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
            key={selectedItem?.id ?? deepLinkCompanySlug ?? "calendar-detail"}
            onActivatePlan={handleActivatePlan}
            onClose={() => setSelectedItemId(null)}
            onCreatePlan={handleCreatePlan}
            onDeleteItem={handleDeleteItem}
            onUpdateItem={handleUpdateItem}
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
