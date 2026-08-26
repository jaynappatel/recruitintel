import { NextResponse } from "next/server";
import {
  correctResumeEvidence,
  listResumeEvidence,
  reviewResumeEvidence,
  ResumeConflictError,
  ResumeNotFoundError,
  ResumeValidationError,
} from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: await listResumeEvidence(actor.user.id, (await context.params).id),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.evidenceId !== "string" || typeof body.action !== "string")
    return apiError(400, "INVALID_REQUEST", "evidenceId and action are required");
  try {
    const expected = typeof body.expectedVersion === "number" ? body.expectedVersion : undefined;
    if (body.action === "CONFIRMED" || body.action === "REJECTED") {
      return NextResponse.json({
        data: await reviewResumeEvidence(
          actor.user.id,
          body.evidenceId,
          body.action,
          typeof body.reasonCode === "string" ? body.reasonCode : undefined,
          expected,
        ),
      });
    }
    if (body.action === "CORRECTED" && body.normalizedValue && typeof body.normalizedValue === "object") {
      return NextResponse.json({
        data: await correctResumeEvidence(
          actor.user.id,
          body.evidenceId,
          body.normalizedValue as Record<string, unknown>,
          typeof body.reasonCode === "string" ? body.reasonCode : undefined,
          typeof body.expectedRevision === "number" ? body.expectedRevision : undefined,
        ),
      });
    }
    return apiError(400, "INVALID_REQUEST", "Unsupported evidence action");
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof ResumeConflictError) return apiError(409, "CONFLICT", error.message);
    if (error instanceof ResumeValidationError) return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
