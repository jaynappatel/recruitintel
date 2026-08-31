import { NextResponse } from "next/server";
import { z } from "zod";

import { createPrivacyRequest, recordAuditEvent } from "@recruitintel/db";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

const requestSchema = z.object({ type: z.literal("EXPORT") }).strict();

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = requestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    const id = await createPrivacyRequest(actor.user.id, input.data.type);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: actor.user.id,
      action: "PRIVACY_EXPORT_REQUESTED",
      resourceType: "PRIVACY_REQUEST",
      resourceId: id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return NextResponse.json(
      { data: { id, type: input.data.type, status: "PENDING" } },
      { status: 202 },
    );
  } catch (error) {
    return calendarApiError(error);
  }
}
