import { NextResponse } from "next/server";
import { getPersonalAnalytics } from "@recruitintel/db";
import { personalAnalyticsSchema } from "@recruitintel/types";
import { databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: personalAnalyticsSchema.parse(await getPersonalAnalytics(actor.user.id)),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
