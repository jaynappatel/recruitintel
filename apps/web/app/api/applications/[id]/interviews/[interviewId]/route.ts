import { NextResponse } from "next/server";
import { updateInterview, ApplicationNotFoundError } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, databaseApiError } from "@/lib/api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; interviewId: string }> },
) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    const body = await request.json();
    const params = await context.params;
    return NextResponse.json({
      data: await updateInterview(actor.user.id, params.id, params.interviewId, body),
    });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
