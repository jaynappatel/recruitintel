import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enqueueM11Work,
  getResumeVersion,
  listResumeParseRuns,
  queueResumeParseRun,
  ResumeNotFoundError,
} from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

const parseRequestSchema = z.object({ resumeVersionId: z.uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: documentId } = await context.params;
  if (!isDatabaseUuid(documentId)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
  const body = parseRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "INVALID_REQUEST", "resumeVersionId is required");
  try {
    await getResumeVersion(actor.user.id, documentId, body.data.resumeVersionId);
    await queueResumeParseRun(actor.user.id, body.data.resumeVersionId);
    const fingerprint = createHash("sha256")
      .update(`RESUME_PARSE:${actor.user.id}:${body.data.resumeVersionId}:1`)
      .digest("hex");
    const work = await enqueueM11Work({
      workType: "RESUME_PARSE",
      userId: actor.user.id,
      resumeVersionId: body.data.resumeVersionId,
      parserVersion: 1,
      idempotencyFingerprint: fingerprint,
    });
    if (!work) return apiError(500, "INTERNAL_ERROR", "Parse work could not be queued");
    return NextResponse.json({ data: { id: work.id, status: work.status } }, { status: 202 });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const { id: documentId } = await context.params;
  if (!isDatabaseUuid(documentId)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
  const versionId = new URL(request.url).searchParams.get("resumeVersionId");
  if (!versionId || !isDatabaseUuid(versionId))
    return apiError(400, "INVALID_REQUEST", "resumeVersionId is required");
  try {
    await getResumeVersion(actor.user.id, documentId, versionId);
    return NextResponse.json({ data: await listResumeParseRuns(actor.user.id, versionId) });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
