import { NextResponse } from "next/server";
import { materializeResumeJobMatch, ResumeNotFoundError } from "@recruitintel/db";
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
