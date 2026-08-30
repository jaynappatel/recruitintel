import { NextResponse } from "next/server";
import { z } from "zod";
import {
  InterviewPrepConflictError,
  InterviewPrepNotFoundError,
  setInterviewPrepItemCompletion,
} from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";

const schema = z
  .object({ completed: z.boolean(), expectedVersion: z.number().int().positive() })
  .strict();
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id, itemId } = await context.params;
  if (!isDatabaseUuid(id) || !isDatabaseUuid(itemId))
    return apiError(400, "INVALID_REQUEST", "Invalid identifier");
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json({
      data: await setInterviewPrepItemCompletion(
        actor.user.id,
        id,
        itemId,
        input.data.completed,
        input.data.expectedVersion,
      ),
    });
  } catch (error) {
    if (error instanceof InterviewPrepNotFoundError)
      return apiError(404, "NOT_FOUND", error.message);
    if (error instanceof InterviewPrepConflictError)
      return apiError(409, "CONFLICT", error.message);
    return databaseApiError(error);
  }
}
