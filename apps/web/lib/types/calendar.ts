/**
 * Frontend-owned calendar domain model. Codex has not exposed calendar/planner
 * endpoints yet, so this module is the contract the mocked API layer in
 * lib/api/calendar.ts implements. When real endpoints land, only that file
 * (and the fetch bodies inside it) should need to change — components and
 * pages consume the functions, never the mock store directly.
 */

/** How certain RecruitIntel is about a date. Never render ESTIMATED/HISTORICAL like CONFIRMED. */
export const calendarStatuses = ["CONFIRMED", "ESTIMATED", "HISTORICAL", "USER_SCHEDULED"] as const;
export type CalendarStatus = (typeof calendarStatuses)[number];

/** The three information families the calendar combines. */
export const calendarCategories = ["RECRUITING_DATE", "ACTION", "PREP_SESSION"] as const;
export type CalendarCategory = (typeof calendarCategories)[number];

export const calendarItemTypes = [
  // RECRUITING_DATE
  "INTERNSHIP_OPENING",
  "NEW_GRAD_OPENING",
  "APPLICATION_DEADLINE",
  "CAREER_FAIR",
  "CAMPUS_EVENT",
  // ACTION
  "APPLY",
  "UPDATE_RESUME",
  "RECRUITER_OUTREACH",
  "FOLLOW_UP",
  "COMPLETE_OA",
  "RESEARCH_COMPANY",
  // PREP_SESSION
  "LEETCODE",
  "SYSTEM_DESIGN",
  "BEHAVIORAL_PREP",
  "INTERVIEW_PREP",
  "MOCK_INTERVIEW",
  "RESUME_WORK",
] as const;
export type CalendarItemType = (typeof calendarItemTypes)[number];

export interface SourceRef {
  name: string;
  url?: string;
}

export interface CalendarItem {
  id: string;
  title: string;
  /** ISO date (yyyy-mm-dd) this item lands on. */
  date: string;
  /** Present when a recruiting date is a window rather than a single day. */
  endDate?: string;
  time?: string;
  category: CalendarCategory;
  type: CalendarItemType;
  status: CalendarStatus;
  companyId?: string;
  companySlug?: string;
  companyName?: string;
  source?: SourceRef;
  notes?: string;
  completed?: boolean;
  /** Links an action/prep item back to the plan that generated it. */
  planId?: string;
}

export interface ApplicationPlanTask {
  id: string;
  title: string;
  category: Extract<CalendarCategory, "ACTION" | "PREP_SESSION">;
  type: CalendarItemType;
  /** Days relative to the plan's target date. 0 = target day. */
  offsetDays: number;
  date: string;
  completed: boolean;
  calendarItemId: string;
}

export interface ApplicationPlan {
  id: string;
  companyId?: string;
  companySlug?: string;
  companyName: string;
  targetLabel: string;
  targetDate: string;
  createdAt: string;
  tasks: ApplicationPlanTask[];
}

export type CalendarProviderStatus =
  | "NOT_CONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "SYNCING"
  | "SYNC_ERROR";

export interface CalendarSyncSettings {
  recruitingTasks: boolean;
  leetcodeSessions: boolean;
  applicationDeadlines: boolean;
  careerEvents: boolean;
}

export interface CalendarIntegration {
  provider: "google";
  status: CalendarProviderStatus;
  accountEmail?: string;
  lastSyncedAt?: string;
  errorMessage?: string;
  sync: CalendarSyncSettings;
}

export interface CreateCalendarItemInput {
  title: string;
  date: string;
  endDate?: string;
  time?: string;
  category: CalendarCategory;
  type: CalendarItemType;
  status?: CalendarStatus;
  companyId?: string;
  companySlug?: string;
  companyName?: string;
  notes?: string;
}

export interface CreateApplicationPlanInput {
  companyId?: string;
  companySlug?: string;
  companyName: string;
  targetLabel: string;
  targetDate: string;
}
