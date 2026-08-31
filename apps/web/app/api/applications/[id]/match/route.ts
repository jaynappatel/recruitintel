import { NextResponse } from "next/server";
import {
  bindApplicationMatch,
  ApplicationNotFoundError,
  ApplicationValidationError,
} from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: applicationId } = await context.params;
  if (!isDatabaseUuid(applicationId))
    return apiError(400, "INVALID_REQUEST", "Invalid application id");
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    typeof body?.resumeVersionId !== "string" ||
    typeof body.matchId !== "string" ||
    !isDatabaseUuid(body.resumeVersionId) ||
    !isDatabaseUuid(body.matchId)
  )
    return apiError(400, "INVALID_REQUEST", "resumeVersionId and matchId are required");
  try {
    return NextResponse.json({
      data: await bindApplicationMatch(
        actor.user.id,
        applicationId,
        body.resumeVersionId,
        body.matchId,
      ),
    });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof ApplicationValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
