import { NextResponse } from "next/server";

import { googleCalendarOptionSchema } from "@recruitintel/types";

import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";
import { listGoogleCalendarOptions } from "@/lib/server/google-calendar-oauth";

export async function GET() {
  try {
    const calendars = await listGoogleCalendarOptions(currentOwnerId());
    return NextResponse.json({
      data: calendars.map((calendar) => googleCalendarOptionSchema.parse(calendar)),
      meta: { total: calendars.length },
    });
  } catch (error) {
    return calendarApiError(error);
  }
}
