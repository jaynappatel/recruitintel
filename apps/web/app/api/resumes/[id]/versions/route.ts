import { NextResponse } from "next/server";
import {
  createResumeVersion,
  listResumeVersions,
  ResumeNotFoundError,
  ResumeValidationError,
} from "@recruitintel/db";
import { resumeVersionRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = resumeVersionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { id } = await context.params;
    if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
    return NextResponse.json(
      { data: await createResumeVersion(actor.user.id, id, parsed.data.extractedText) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof ResumeValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const { id } = await context.params;
    if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
    return NextResponse.json({ data: await listResumeVersions(actor.user.id, id) });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
