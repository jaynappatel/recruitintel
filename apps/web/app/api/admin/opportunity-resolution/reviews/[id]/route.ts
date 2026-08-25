import { NextResponse } from "next/server";

import {
  dismissOpportunityReview,
  OpportunityConflictError,
  OpportunityNotFoundError,
} from "@recruitintel/db";
import { dismissOpportunityReviewRequestSchema, databaseUuidSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireAdmin(request);
    if (!("user" in actor)) {
      return apiError(403, "FORBIDDEN", "Manual correction requires a human administrator");
    }
    const id = databaseUuidSchema.safeParse((await context.params).id);
    if (!id.success) return validationError(id.error);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
    const parsed = dismissOpportunityReviewRequestSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const review = await dismissOpportunityReview({
      reviewId: id.data,
      ...parsed.data,
      actorUserId: actor.user.id,
    });
    return NextResponse.json({ data: review });
  } catch (error) {
    if (error instanceof OpportunityNotFoundError) {
      return apiError(404, "NOT_FOUND", "Opportunity review was not found");
    }
    if (error instanceof OpportunityConflictError) {
      return apiError(409, "RESOLUTION_CONFLICT", error.message);
    }
    return authorizationApiError(error);
  }
}
