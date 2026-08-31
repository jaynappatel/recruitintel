import { NextResponse } from "next/server";

import {
  disconnectGoogleCalendar,
  getGoogleCalendarStatus,
  recordAuditEvent,
  updateGoogleCalendarConnection,
} from "@recruitintel/db";
import { googleCalendarStatusSchema, updateGoogleCalendarRequestSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { revokeGoogleCalendarAuthorization } from "@/lib/server/google-calendar-oauth";

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

export async function PATCH(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const patch = updateGoogleCalendarRequestSchema.safeParse(body);
  if (!patch.success) return validationError(patch.error);
  try {
    const status = await updateGoogleCalendarConnection(actor.user.id, patch.data);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: actor.user.id,
      action: "GOOGLE_CALENDAR_PREFERENCES_UPDATED",
      resourceType: "CALENDAR_CONNECTION",
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
      metadata: {
        selectedCalendarChanged: patch.data.selectedCalendarId !== undefined,
        preferenceKeys: Object.keys(patch.data.preferences ?? {}).sort(),
      },
    });
    return NextResponse.json({ data: googleCalendarStatusSchema.parse(status) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function DELETE(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    await revokeGoogleCalendarAuthorization(actor.user.id);
    await disconnectGoogleCalendar(actor.user.id);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: actor.user.id,
      action: "GOOGLE_CALENDAR_DISCONNECTED",
      resourceType: "CALENDAR_CONNECTION",
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
