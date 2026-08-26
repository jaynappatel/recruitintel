import { NextResponse } from "next/server";
import {
  bindApplicationMatch,
  ApplicationNotFoundError,
  ApplicationValidationError,
} from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.resumeVersionId !== "string" || typeof body.matchId !== "string")
    return apiError(400, "INVALID_REQUEST", "resumeVersionId and matchId are required");
  try {
    return NextResponse.json({
      data: await bindApplicationMatch(
        actor.user.id,
        (await context.params).id,
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
