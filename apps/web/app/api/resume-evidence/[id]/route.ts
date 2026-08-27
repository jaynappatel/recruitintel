import { NextResponse } from "next/server";
import {
  correctResumeEvidence,
  reviewResumeEvidence,
  ResumeConflictError,
  ResumeNotFoundError,
  ResumeValidationError,
} from "@recruitintel/db";
import { evidenceReviewRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = evidenceReviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const evidenceId = (await context.params).id;
    if (!isDatabaseUuid(evidenceId)) return apiError(400, "INVALID_REQUEST", "Invalid evidence id");
    if (parsed.data.disposition === "CORRECTED") {
      if (!parsed.data.normalizedValue)
        return apiError(400, "INVALID_REQUEST", "normalizedValue is required for correction");
      return NextResponse.json({
        data: await correctResumeEvidence(
          actor.user.id,
          evidenceId,
          parsed.data.normalizedValue,
          parsed.data.reasonCode,
        ),
      });
    }
    return NextResponse.json({
      data: await reviewResumeEvidence(
        actor.user.id,
        evidenceId,
        parsed.data.disposition as "CONFIRMED" | "REJECTED",
        parsed.data.reasonCode,
      ),
    });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof ResumeConflictError) return apiError(409, "CONFLICT", error.message);
    if (error instanceof ResumeValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
