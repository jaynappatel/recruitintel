import { NextResponse } from "next/server";

import { getGoogleCalendarStatus } from "@recruitintel/db";
import { googleCalendarStatusSchema } from "@recruitintel/types";

import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

export async function GET() {
  try {
    const status = await getGoogleCalendarStatus(currentOwnerId());
    return NextResponse.json({ data: googleCalendarStatusSchema.parse(status) });
  } catch (error) {
    return calendarApiError(error);
  }
}
