import { NextResponse } from "next/server";

import { listOpportunities, OpportunityConflictError } from "@recruitintel/db";
import { opportunitiesQuerySchema, opportunitySchema } from "@recruitintel/types";

import { apiError, databaseApiError, validationError } from "@/lib/api";

export async function GET(request: Request) {
  const query = opportunitiesQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationError(query.error);
  try {
    const page = await listOpportunities(query.data);
    return NextResponse.json({
      data: page.items.map((item) => opportunitySchema.parse(item)),
      meta: { limit: query.data.limit, nextCursor: page.nextCursor },
    });
  } catch (error) {
    if (error instanceof OpportunityConflictError) {
      return apiError(400, "INVALID_CURSOR", error.message);
    }
    return databaseApiError(error);
  }
}
