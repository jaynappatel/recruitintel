import { NextResponse } from "next/server";
import { createResumeDocument, listResumeDocuments, ResumeValidationError } from "@recruitintel/db";
import { resumeUploadRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const parsed = resumeUploadRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json(
      {
        data: await createResumeDocument(actor.user.id, {
          originalFilename: parsed.data.originalFilename,
          mediaType: parsed.data.mediaType,
          bytes: Buffer.from(parsed.data.content, "base64"),
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ResumeValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    return databaseApiError(error);
  }
}

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  return NextResponse.json({ data: await listResumeDocuments(actor.user.id) });
}
