import { NextResponse } from "next/server";

import { getInterviewQuestionDetail, recordProductEvent } from "@recruitintel/db";
import { databaseUuidSchema, interviewQuestionDetailSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { optionalAuthenticatedUser } from "@/lib/server/authorization";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Interview question identifier is invalid");
  }
  try {
    const detail = await getInterviewQuestionDetail(id);
    if (!detail) return apiError(404, "NOT_FOUND", "Interview question was not found");
    const actor = await optionalAuthenticatedUser(request);
    if (actor) {
      await recordProductEvent({
        userId: actor.user.id,
        eventType: "INTERVIEW_INTEL_VIEWED",
        source: "SERVER",
        entityType: "INTERVIEW_INTEL",
        entityId: id,
        requestId: actor.requestId,
      });
    }
    return NextResponse.json({ data: interviewQuestionDetailSchema.parse(detail) });
  } catch (error) {
    return databaseApiError(error);
  }
}
