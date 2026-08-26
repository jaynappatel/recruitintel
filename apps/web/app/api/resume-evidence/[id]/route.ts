import { NextResponse } from "next/server";
import { reviewResumeEvidence, ResumeNotFoundError } from "@recruitintel/db";
import { evidenceReviewRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = evidenceReviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json({
      data: await reviewResumeEvidence(
        actor.user.id,
        (await context.params).id,
        parsed.data.disposition,
        parsed.data.reasonCode,
      ),
    });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
