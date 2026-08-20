import { CalendarConflictError, CalendarNotFoundError } from "@recruitintel/db";

import { apiError, databaseApiError } from "@/lib/api";
import { GoogleOAuthError } from "@/lib/server/google-calendar-oauth";

export function calendarApiError(error: unknown) {
  if (error instanceof CalendarNotFoundError) {
    return apiError(404, "NOT_FOUND", error.message);
  }
  if (error instanceof CalendarConflictError) {
    return apiError(409, "CALENDAR_CONFLICT", error.message);
  }
  if (error instanceof GoogleOAuthError) {
    const status = error.code === "GOOGLE_OAUTH_NOT_CONFIGURED" ? 503 : 400;
    return apiError(status, error.code, error.message);
  }
  return databaseApiError(error);
}
