import { NextResponse } from "next/server";
import { z } from "zod";
import {
  correctResumeEvidence,
  getResumeEvidence,
  getResumeVersion,
  listResumeEvidence,
  reviewResumeEvidence,
  ResumeConflictError,
  ResumeNotFoundError,
  ResumeValidationError,
} from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const { id: documentId } = await context.params;
  const versionId = new URL(request.url).searchParams.get("resumeVersionId");
  if (!isDatabaseUuid(documentId) || !versionId || !isDatabaseUuid(versionId))
    return apiError(400, "INVALID_REQUEST", "Valid resume and resumeVersionId are required");
  try {
    await getResumeVersion(actor.user.id, documentId, versionId);
    return NextResponse.json({
      data: await listResumeEvidence(actor.user.id, versionId),
    });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}

const evidenceActionSchema = z
  .object({
    resumeVersionId: z.uuid(),
    evidenceId: z.uuid(),
    action: z.enum(["CONFIRMED", "REJECTED", "CORRECTED"]),
    normalizedValue: z.record(z.string(), z.unknown()).optional(),
    reasonCode: z.string().trim().max(100).optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: documentId } = await context.params;
  if (!isDatabaseUuid(documentId)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
  const parsed = evidenceActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "INVALID_REQUEST", "Valid evidence action is required");
  const body = parsed.data;
  try {
    await getResumeVersion(actor.user.id, documentId, body.resumeVersionId);
    await getResumeEvidence(actor.user.id, body.resumeVersionId, body.evidenceId);
    if (body.action === "CONFIRMED" || body.action === "REJECTED") {
      return NextResponse.json({
        data: await reviewResumeEvidence(
          actor.user.id,
          body.evidenceId,
          body.action,
          body.reasonCode,
          body.expectedVersion,
        ),
      });
    }
    if (body.action === "CORRECTED" && body.normalizedValue) {
      return NextResponse.json({
        data: await correctResumeEvidence(
          actor.user.id,
          body.evidenceId,
          body.normalizedValue,
          body.reasonCode,
          body.expectedRevision,
        ),
      });
    }
    return apiError(400, "INVALID_REQUEST", "Unsupported evidence action");
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof ResumeConflictError) return apiError(409, "CONFLICT", error.message);
    if (error instanceof ResumeValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}
