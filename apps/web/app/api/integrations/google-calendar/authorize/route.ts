import { NextResponse } from "next/server";

import { recordAuditEvent } from "@recruitintel/db";
import { googleCalendarAuthorizeSchema } from "@recruitintel/types";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { createGoogleCalendarAuthorization } from "@/lib/server/google-calendar-oauth";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const authorization = await createGoogleCalendarAuthorization(actor.user.id);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: actor.user.id,
      action: "GOOGLE_CALENDAR_AUTHORIZATION_STARTED",
      resourceType: "CALENDAR_CONNECTION",
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return NextResponse.json({ data: googleCalendarAuthorizeSchema.parse(authorization) });
  } catch (error) {
    return calendarApiError(error);
  }
}
