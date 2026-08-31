import { NextResponse } from "next/server";
import { createAssessment, ApplicationNotFoundError } from "@recruitintel/db";
import { applicationAssessmentRequestSchema } from "@recruitintel/types";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, validationError, databaseApiError } from "@/lib/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = applicationAssessmentRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json(
      { data: await createAssessment(actor.user.id, (await context.params).id, input.data) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
