import { NextResponse } from "next/server";

import { googleCalendarAuthorizeSchema } from "@recruitintel/types";

import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";
import { createGoogleCalendarAuthorization } from "@/lib/server/google-calendar-oauth";

export async function GET() {
  try {
    const authorization = await createGoogleCalendarAuthorization(currentOwnerId());
    return NextResponse.json({ data: googleCalendarAuthorizeSchema.parse(authorization) });
  } catch (error) {
    return calendarApiError(error);
  }
}
