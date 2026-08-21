import { NextResponse } from "next/server";

import { enqueueGoogleCalendarSync, recordAuditEvent } from "@recruitintel/db";
import { calendarSyncRequestSchema } from "@recruitintel/types";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    const syncRequest = await enqueueGoogleCalendarSync(actor.user.id);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: actor.user.id,
      action: "GOOGLE_CALENDAR_SYNC_QUEUED",
      resourceType: "CALENDAR_SYNC_REQUEST",
      resourceId: syncRequest.id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return NextResponse.json(
      { data: calendarSyncRequestSchema.parse(syncRequest) },
      { status: 202 },
    );
  } catch (error) {
    return calendarApiError(error);
  }
}
