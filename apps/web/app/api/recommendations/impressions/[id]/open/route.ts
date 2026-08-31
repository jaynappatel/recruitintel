import { NextResponse } from "next/server";

import { openRecommendation } from "@recruitintel/db";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  try {
    await openRecommendation(actor.user.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return personalizationApiError(error);
  }
}
