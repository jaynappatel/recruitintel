import { NextResponse } from "next/server";
import { getApplication, ApplicationNotFoundError } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { databaseApiError, apiError } from "@/lib/api";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: await getApplication(actor.user.id, (await context.params).id),
    });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
