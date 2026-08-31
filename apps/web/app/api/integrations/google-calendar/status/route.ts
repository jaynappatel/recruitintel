import { NextResponse } from "next/server";

import { getGoogleCalendarStatus } from "@recruitintel/db";
import { googleCalendarStatusSchema } from "@recruitintel/types";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const status = await getGoogleCalendarStatus(actor.user.id);
    return NextResponse.json({ data: googleCalendarStatusSchema.parse(status) });
  } catch (error) {
    return calendarApiError(error);
  }
}
