import { NextResponse } from "next/server";
import { getResumeMatch, materializeResumeJobMatch, ResumeNotFoundError } from "@recruitintel/db";
import { resumeMatchRequestSchema } from "@recruitintel/types";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = resumeMatchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json(
      {
        data: await materializeResumeJobMatch(
          actor.user.id,
          parsed.data.resumeVersionId,
          parsed.data.opportunityId,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return apiError(400, "INVALID_REQUEST", "id is required");
  try {
    return NextResponse.json({ data: await getResumeMatch(actor.user.id, id) });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
