import { NextResponse } from "next/server";

import { getOpportunityDetail, recordProductEvent } from "@recruitintel/db";
import { databaseUuidSchema, opportunityDetailSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { optionalAuthenticatedUser } from "@/lib/server/authorization";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Opportunity id is invalid");
  }
  try {
    const opportunity = await getOpportunityDetail(id);
    if (!opportunity) return apiError(404, "NOT_FOUND", "Opportunity was not found");
    const actor = await optionalAuthenticatedUser(request);
    if (actor) {
      await recordProductEvent({
        userId: actor.user.id,
        eventType: "OPPORTUNITY_VIEWED",
        source: "SERVER",
        entityType: "OPPORTUNITY",
        entityId: id,
        requestId: actor.requestId,
      });
    }
    return NextResponse.json({ data: opportunityDetailSchema.parse(opportunity) });
  } catch (error) {
    return databaseApiError(error);
  }
}
