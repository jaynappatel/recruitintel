import { NextResponse } from "next/server";

import { createPrivacyRequest, deleteUserAccount } from "@recruitintel/db";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { revokeGoogleCalendarAuthorization } from "@/lib/server/google-calendar-oauth";

export async function DELETE(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    const privacyRequestId = await createPrivacyRequest(actor.user.id, "DELETE");
    await revokeGoogleCalendarAuthorization(actor.user.id);
    await deleteUserAccount(actor.user.id, privacyRequestId);
    return NextResponse.json({
      data: { requestId: privacyRequestId, status: "COMPLETED" },
    });
  } catch (error) {
    return calendarApiError(error);
  }
}
