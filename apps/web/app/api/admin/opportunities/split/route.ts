import { NextResponse } from "next/server";

import {
  OpportunityConflictError,
  OpportunityNotFoundError,
  splitOpportunity,
} from "@recruitintel/db";
import { opportunitySchema, splitOpportunityRequestSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    if (!("user" in actor)) {
      return apiError(403, "FORBIDDEN", "Manual correction requires a human administrator");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
    const parsed = splitOpportunityRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const opportunity = await splitOpportunity({ ...parsed.data, actorUserId: actor.user.id });
    return NextResponse.json({ data: opportunitySchema.parse(opportunity) });
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return apiError(404, "NOT_FOUND", "Opportunity membership was not found");
    }
    if (error instanceof OpportunityConflictError) {
      return apiError(409, "RESOLUTION_CONFLICT", error.message);
    }
    return authorizationApiError(error);
  }
}
