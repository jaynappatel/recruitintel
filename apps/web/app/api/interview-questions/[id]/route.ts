import { NextResponse } from "next/server";

import { getInterviewQuestionDetail } from "@recruitintel/db";
import { databaseUuidSchema, interviewQuestionDetailSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Interview question identifier is invalid");
  }
  try {
    const detail = await getInterviewQuestionDetail(id);
    if (!detail) return apiError(404, "NOT_FOUND", "Interview question was not found");
    return NextResponse.json({ data: interviewQuestionDetailSchema.parse(detail) });
  } catch (error) {
    return databaseApiError(error);
  }
}
