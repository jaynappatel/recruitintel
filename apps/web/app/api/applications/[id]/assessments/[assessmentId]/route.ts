import { NextResponse } from "next/server";
import { updateAssessment, ApplicationNotFoundError } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, databaseApiError } from "@/lib/api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; assessmentId: string }> },
) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    const body = await request.json();
    return NextResponse.json({
      data: await updateAssessment(
        actor.user.id,
        (await context.params).id,
        (await context.params).assessmentId,
        body,
      ),
    });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
