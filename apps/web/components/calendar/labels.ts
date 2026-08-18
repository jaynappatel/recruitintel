import type { CalendarCategory, CalendarItemType, CalendarStatus } from "@/lib/types/calendar";

/** A few overrides for acronyms/proper nouns humanizeEnum can't get right. */
const TYPE_OVERRIDES: Partial<Record<CalendarItemType, string>> = {
  COMPLETE_OA: "Complete OA",
  LEETCODE: "LeetCode",
};

export function formatItemType(type: CalendarItemType): string {
  if (TYPE_OVERRIDES[type]) return TYPE_OVERRIDES[type]!;
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const categoryLabels: Record<CalendarCategory, string> = {
  RECRUITING_DATE: "Recruiting date",
  ACTION: "Action",
  PREP_SESSION: "Prep session",
};

export const statusLabels: Record<CalendarStatus, string> = {
  CONFIRMED: "Confirmed",
  ESTIMATED: "Estimated",
  HISTORICAL: "Historical",
  USER_SCHEDULED: "Scheduled",
};

export const statusDescriptions: Record<CalendarStatus, string> = {
  CONFIRMED: "Verified directly from a source such as a careers page or ATS.",
  ESTIMATED: "Modeled from historical timing — not yet confirmed.",
  HISTORICAL: "A past-cycle reference date, shown for pattern context only.",
  USER_SCHEDULED: "An action or prep session you scheduled yourself.",
};
