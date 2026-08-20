import { NextResponse } from "next/server";

import { enqueueGoogleCalendarSync } from "@recruitintel/db";
import { calendarSyncRequestSchema } from "@recruitintel/types";

import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

export async function POST() {
  try {
    const request = await enqueueGoogleCalendarSync(currentOwnerId());
    return NextResponse.json({ data: calendarSyncRequestSchema.parse(request) }, { status: 202 });
  } catch (error) {
    return calendarApiError(error);
  }
}
