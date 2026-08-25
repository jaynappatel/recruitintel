import { NextResponse } from "next/server";

import { listOpportunityRecommendations } from "@recruitintel/db";
import { opportunityRecommendationSchema, recommendationQuerySchema } from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const query = recommendationQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return validationError(query.error);
  try {
    const page = await listOpportunityRecommendations(actor.user.id, query.data);
    return NextResponse.json({
      data: page.items.map((item) => opportunityRecommendationSchema.parse(item)),
      meta: {
        limit: query.data.limit,
        nextCursor: page.nextCursor,
        scoreLabel: "Recommendation Score",
      },
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
