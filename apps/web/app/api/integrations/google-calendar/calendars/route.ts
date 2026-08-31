import { NextResponse } from "next/server";

import { googleCalendarOptionSchema } from "@recruitintel/types";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { listGoogleCalendarOptions } from "@/lib/server/google-calendar-oauth";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const calendars = await listGoogleCalendarOptions(actor.user.id);
    return NextResponse.json({
      data: calendars.map((calendar) => googleCalendarOptionSchema.parse(calendar)),
      meta: { total: calendars.length },
    });
  } catch (error) {
    return calendarApiError(error);
  }
}
