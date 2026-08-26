import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { enqueueM11Work, listResumeParseRuns, queueResumeParseRun } from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request, _context: { params: Promise<{ id: string }> }) {
  void _context;
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.resumeVersionId !== "string")
    return apiError(400, "INVALID_REQUEST", "resumeVersionId is required");
  try {
    await queueResumeParseRun(actor.user.id, body.resumeVersionId);
    const fingerprint = createHash("sha256")
      .update(`RESUME_PARSE:${actor.user.id}:${body.resumeVersionId}:1`)
      .digest("hex");
    const work = await enqueueM11Work({
      workType: "RESUME_PARSE",
      userId: actor.user.id,
      resumeVersionId: body.resumeVersionId,
      parserVersion: 1,
      idempotencyFingerprint: fingerprint,
    });
    if (!work) return apiError(500, "INTERNAL_ERROR", "Parse work could not be queued");
    return NextResponse.json({ data: { id: work.id, status: work.status } }, { status: 202 });
  } catch (error) {
    return databaseApiError(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const versionId = new URL(request.url).searchParams.get("resumeVersionId");
  if (!versionId) return apiError(400, "INVALID_REQUEST", "resumeVersionId is required");
  try {
    return NextResponse.json({ data: await listResumeParseRuns(actor.user.id, versionId) });
  } catch (error) {
    return databaseApiError(error);
  }
}
