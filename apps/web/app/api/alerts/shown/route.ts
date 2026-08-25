import { NextResponse } from "next/server";

import { markAlertsShown } from "@recruitintel/db";
import { alertsShownSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = alertsShownSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json({
      data: { updated: await markAlertsShown(actor.user.id, input.data.alertIds) },
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
