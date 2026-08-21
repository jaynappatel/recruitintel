import { NextResponse } from "next/server";

import { productEventEntityExists, recordProductEvent } from "@recruitintel/db";
import { clientProductEventSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

const ENTITY_TYPE = {
  JOB_VIEWED: "JOB",
  RECRUITER_VIEWED: "RECRUITER",
  INTERVIEW_INTEL_VIEWED: "INTERVIEW_INTEL",
} as const;

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = clientProductEventSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    if (!(await productEventEntityExists(input.data.eventType, input.data.entityId))) {
      return apiError(404, "NOT_FOUND", "Instrumentation target was not found");
    }
    await recordProductEvent({
      userId: actor.user.id,
      eventType: input.data.eventType,
      source: "CLIENT",
      entityType: ENTITY_TYPE[input.data.eventType],
      entityId: input.data.entityId,
      requestId: actor.requestId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
