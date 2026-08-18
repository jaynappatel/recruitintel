"use client";

/**
 * Frontend API abstraction for the recruiting calendar + application planner.
 *
 * Codex has not exposed real calendar endpoints yet. Every function here is
 * implemented against an in-memory mock store so the Calendar UI can be built
 * and tested end to end today. When real endpoints exist, swap the bodies of
 * these functions for `fetch("/api/calendar/...")` calls — nothing in
 * components/ or app/ should need to change, since they only ever import
 * from this module.
 */
import { mockCalendarIntegration, mockCalendarItems } from "@/lib/mock-data/calendar";
import type {
  ApplicationPlan,
  ApplicationPlanTask,
  CalendarIntegration,
  CalendarItem,
  CreateApplicationPlanInput,
  CreateCalendarItemInput,
} from "@/lib/types/calendar";

let itemStore: CalendarItem[] = mockCalendarItems.map((item) => ({ ...item }));
let planStore: ApplicationPlan[] = [];
let integrationStore: CalendarIntegration = { ...mockCalendarIntegration };

let nextId = 1000;
function generateId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

/** Small artificial latency so loading states are real, not instantaneous. */
function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export interface CalendarItemFilters {
  categories?: CalendarItem["category"][];
  statuses?: CalendarItem["status"][];
  companySlug?: string;
  from?: string;
  to?: string;
}

export async function getCalendarItems(filters: CalendarItemFilters = {}): Promise<CalendarItem[]> {
  let items = [...itemStore];
  if (filters.categories?.length) {
    items = items.filter((item) => filters.categories!.includes(item.category));
  }
  if (filters.statuses?.length) {
    items = items.filter((item) => filters.statuses!.includes(item.status));
  }
  if (filters.companySlug) {
    items = items.filter((item) => item.companySlug === filters.companySlug);
  }
  if (filters.from) {
    items = items.filter((item) => (item.endDate ?? item.date) >= filters.from!);
  }
  if (filters.to) {
    items = items.filter((item) => item.date <= filters.to!);
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return delay(items);
}

export async function createCalendarItem(input: CreateCalendarItemInput): Promise<CalendarItem> {
  const item: CalendarItem = {
    id: generateId("cal"),
    status: "USER_SCHEDULED",
    completed: false,
    ...input,
  };
  itemStore = [...itemStore, item];
  return delay(item);
}

export async function updateCalendarItem(
  id: string,
  patch: Partial<Pick<CalendarItem, "completed" | "title" | "date" | "notes" | "status">>,
): Promise<CalendarItem> {
  let updated: CalendarItem | undefined;
  itemStore = itemStore.map((item) => {
    if (item.id !== id) return item;
    updated = { ...item, ...patch };
    return updated;
  });
  if (!updated) throw new Error(`Calendar item ${id} not found`);
  return delay(updated);
}

export async function deleteCalendarItem(id: string): Promise<void> {
  itemStore = itemStore.filter((item) => item.id !== id);
  return delay(undefined);
}

/** Fixed prep template used to seed a new application plan around a target date. */
const PLAN_TEMPLATE: Array<{
  offsetDays: number;
  title: string;
  category: "ACTION" | "PREP_SESSION";
  type: ApplicationPlanTask["type"];
}> = [
  { offsetDays: -7, title: "Resume review", category: "ACTION", type: "UPDATE_RESUME" },
  { offsetDays: -5, title: "Interview research", category: "ACTION", type: "RESEARCH_COMPANY" },
  { offsetDays: -3, title: "LeetCode practice", category: "PREP_SESSION", type: "LEETCODE" },
  { offsetDays: 0, title: "Apply", category: "ACTION", type: "APPLY" },
  { offsetDays: 2, title: "Recruiter follow-up", category: "ACTION", type: "FOLLOW_UP" },
];

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function createApplicationPlan(
  input: CreateApplicationPlanInput,
): Promise<ApplicationPlan> {
  const planId = generateId("plan");
  const tasks: ApplicationPlanTask[] = PLAN_TEMPLATE.map((step) => {
    const date = addDays(input.targetDate, step.offsetDays);
    const calendarItem: CalendarItem = {
      id: generateId("cal"),
      title: `${step.title} — ${input.companyName}`,
      date,
      category: step.category,
      type: step.type,
      status: "USER_SCHEDULED",
      companyId: input.companyId,
      companySlug: input.companySlug,
      companyName: input.companyName,
      completed: false,
      planId,
      notes: `Application plan for ${input.targetLabel}`,
    };
    itemStore = [...itemStore, calendarItem];
    return {
      id: generateId("task"),
      title: step.title,
      category: step.category,
      type: step.type,
      offsetDays: step.offsetDays,
      date,
      completed: false,
      calendarItemId: calendarItem.id,
    };
  });

  const plan: ApplicationPlan = {
    id: planId,
    companyId: input.companyId,
    companySlug: input.companySlug,
    companyName: input.companyName,
    targetLabel: input.targetLabel,
    targetDate: input.targetDate,
    createdAt: new Date().toISOString(),
    tasks,
  };
  planStore = [...planStore, plan];
  return delay(plan);
}

export async function getApplicationPlan(planId: string): Promise<ApplicationPlan | null> {
  return delay(planStore.find((plan) => plan.id === planId) ?? null);
}

export async function listApplicationPlans(companySlug?: string): Promise<ApplicationPlan[]> {
  const plans = companySlug
    ? planStore.filter((plan) => plan.companySlug === companySlug)
    : [...planStore];
  return delay(plans);
}

export async function getCalendarIntegration(): Promise<CalendarIntegration> {
  return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
}

export async function connectCalendarProvider(): Promise<CalendarIntegration> {
  integrationStore = { ...integrationStore, status: "CONNECTING" };
  await delay(undefined, 900);
  integrationStore = {
    ...integrationStore,
    status: "CONNECTED",
    accountEmail: "jayna05@gmail.com",
    lastSyncedAt: new Date().toISOString(),
  };
  return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
}

export async function disconnectCalendarProvider(): Promise<CalendarIntegration> {
  integrationStore = {
    ...integrationStore,
    status: "NOT_CONNECTED",
    accountEmail: undefined,
    lastSyncedAt: undefined,
    errorMessage: undefined,
  };
  return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
}

export async function syncCalendar(): Promise<CalendarIntegration> {
  if (integrationStore.status !== "CONNECTED" && integrationStore.status !== "SYNC_ERROR") {
    return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
  }
  integrationStore = { ...integrationStore, status: "SYNCING" };
  await delay(undefined, 900);
  integrationStore = {
    ...integrationStore,
    status: "CONNECTED",
    lastSyncedAt: new Date().toISOString(),
  };
  return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
}

export async function updateCalendarSyncSetting(
  key: keyof CalendarIntegration["sync"],
  value: boolean,
): Promise<CalendarIntegration> {
  integrationStore = { ...integrationStore, sync: { ...integrationStore.sync, [key]: value } };
  return delay({ ...integrationStore, sync: { ...integrationStore.sync } });
}
