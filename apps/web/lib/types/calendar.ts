import type {
  ApplicationPlan,
  CalendarItem as CanonicalCalendarItem,
  CalendarSyncRequest,
  Company,
  GoogleCalendarOption,
  GoogleCalendarStatus,
} from "@recruitintel/types";

/** Presentation-only groupings used by the existing Calendar visual design. */
export const calendarCategories = ["RECRUITING_DATE", "ACTION", "PREP_SESSION"] as const;
export type CalendarCategory = (typeof calendarCategories)[number];

/**
 * Date certainty shown by the UI. Scheduling state remains available separately
 * as `itemStatus`; it must never be rendered as intelligence certainty.
 */
export const calendarStatuses = [
  "CONFIRMED",
  "ESTIMATED",
  "HISTORICAL",
  "CLAIMED",
  "USER_SCHEDULED",
] as const;
export type CalendarStatus = (typeof calendarStatuses)[number];

export const calendarDisplayTypes = [
  "APPLICATION_OPEN",
  "APPLICATION_DEADLINE",
  "EXPECTED_OPENING_WINDOW",
  "CAREER_FAIR",
  "CAMPUS_EVENT",
  "INFO_SESSION",
  "INTERVIEW_EVENT",
  "OTHER",
  "RECRUITING_DATE",
  "APPLICATION_TASK",
  "LEETCODE",
  "INTERVIEW_PREP",
  "SYSTEM_DESIGN",
  "BEHAVIORAL_PREP",
  "RECRUITER_OUTREACH",
  "RESUME_WORK",
  "CAREER_EVENT",
  "OA",
  "CUSTOM",
  // Backend-generated presentation metadata may use these more specific labels.
  "APPLY",
  "UPDATE_RESUME",
  "FOLLOW_UP",
  "RESEARCH_COMPANY",
] as const;
export type CalendarItemType = (typeof calendarDisplayTypes)[number];

export interface SourceRef {
  name: string;
  url?: string;
}

/**
 * Read model for the existing Calendar components. `domainType`, `itemStatus`,
 * `itemSource`, timing, timezone, and sync fields remain canonical backend data;
 * the other fields are derived only for presentation.
 */
export interface CalendarItemView {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  allDay: boolean;
  timezone: string;
  category: CalendarCategory;
  type: CalendarItemType;
  status: CalendarStatus;
  domainType: CanonicalCalendarItem["type"];
  itemStatus: CanonicalCalendarItem["status"];
  itemSource: CanonicalCalendarItem["source"];
  companyId?: string;
  companySlug?: string;
  companyName?: string;
  jobId?: string;
  opportunityId?: string;
  resolvedOpportunityId?: string;
  resolutionMismatch: boolean;
  recruitingDateId?: string;
  source?: SourceRef;
  notes?: string;
  completed: boolean;
  syncEnabled: boolean;
  planId?: string;
}

export interface CreateCalendarItemInput {
  title: string;
  date: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  allDay: boolean;
  timezone: string;
  type: Exclude<CanonicalCalendarItem["type"], "RECRUITING_DATE">;
  companyId?: string;
  jobId?: string;
  opportunityId?: string;
  notes?: string;
  syncEnabled?: boolean;
}

export interface UpdateCalendarItemInput {
  title?: string;
  notes?: string | null;
  date?: string;
  endDate?: string | null;
  time?: string;
  endTime?: string | null;
  allDay?: boolean;
  timezone?: string;
  status?: CanonicalCalendarItem["status"];
  syncEnabled?: boolean;
  opportunityId?: string | null;
}

export interface CreateApplicationPlanInput {
  companyId?: string;
  companySlug?: string;
  companyName: string;
  recruitingDateId?: string;
  jobId?: string;
  opportunityId?: string;
  targetLabel: string;
  targetDate: string;
  timezone?: string;
}

export type CalendarProviderDisplayStatus =
  | GoogleCalendarStatus["status"]
  | "CONNECTING"
  | "SYNCING";

export type {
  ApplicationPlan,
  CalendarSyncRequest,
  Company,
  GoogleCalendarOption,
  GoogleCalendarStatus,
};
