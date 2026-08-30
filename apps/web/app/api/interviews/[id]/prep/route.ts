import { NextResponse } from "next/server";
import {
  createInterviewPrepPlan,
  getInterviewPrepPlan,
  InterviewPrepConflictError,
  InterviewPrepNotFoundError,
} from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid interview id");
  try {
    return NextResponse.json({ data: await getInterviewPrepPlan(actor.user.id, id) });
  } catch (error) {
    if (error instanceof InterviewPrepNotFoundError)
      return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid interview id");
  try {
    return NextResponse.json(
      { data: await createInterviewPrepPlan(actor.user.id, id) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InterviewPrepNotFoundError)
      return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof InterviewPrepConflictError)
      return apiError(409, "CONFLICT", error.message);
    return databaseApiError(error);
  }
}
