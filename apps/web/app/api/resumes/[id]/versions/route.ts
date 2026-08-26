import { NextResponse } from "next/server";
import { createResumeVersion, ResumeNotFoundError, ResumeValidationError } from "@recruitintel/db";
import { resumeVersionRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = resumeVersionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { id } = await context.params;
    return NextResponse.json(
      { data: await createResumeVersion(actor.user.id, id, parsed.data.extractedText) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ResumeNotFoundError || error instanceof ResumeValidationError)
      return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
