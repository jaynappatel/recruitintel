import { NextResponse } from "next/server";

import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  updateGoogleCalendarConnection,
} from "@recruitintel/db";
import { googleCalendarStatusSchema, updateGoogleCalendarRequestSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";
import { revokeGoogleCalendarAuthorization } from "@/lib/server/google-calendar-oauth";

export async function GET() {
  try {
    const status = await getGoogleCalendarStatus(currentOwnerId());
    return NextResponse.json({ data: googleCalendarStatusSchema.parse(status) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const patch = updateGoogleCalendarRequestSchema.safeParse(body);
  if (!patch.success) return validationError(patch.error);
  try {
    const status = await updateGoogleCalendarConnection(currentOwnerId(), patch.data);
    return NextResponse.json({ data: googleCalendarStatusSchema.parse(status) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function DELETE() {
  const ownerId = currentOwnerId();
  try {
    await revokeGoogleCalendarAuthorization(ownerId);
    await disconnectGoogleCalendar(ownerId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
