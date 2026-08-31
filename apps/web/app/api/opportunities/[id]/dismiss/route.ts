import { NextResponse } from "next/server";

import { dismissOpportunity, restoreDismissedOpportunity } from "@recruitintel/db";
import { databaseUuidSchema, opportunityDismissalSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const id = databaseUuidSchema.safeParse((await params).id);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Opportunity ID is invalid");
  let body: unknown = {};
  const raw = await request.text();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
  }
  const input = opportunityDismissalSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    await dismissOpportunity(actor.user.id, id.data, input.data.reasonCode);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return personalizationApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const id = databaseUuidSchema.safeParse((await params).id);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Opportunity ID is invalid");
  try {
    await restoreDismissedOpportunity(actor.user.id, id.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return personalizationApiError(error);
  }
}
