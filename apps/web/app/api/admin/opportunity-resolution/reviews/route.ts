import { NextResponse } from "next/server";

import { listOpportunityReviews } from "@recruitintel/db";
import { opportunityReviewsQuerySchema } from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
    const parsed = opportunityReviewsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validationError(parsed.error);
    const reviews = await listOpportunityReviews(parsed.data.status, parsed.data.limit);
    return NextResponse.json({ data: reviews, meta: parsed.data });
  } catch (error) {
    return authorizationApiError(error);
  }
}
