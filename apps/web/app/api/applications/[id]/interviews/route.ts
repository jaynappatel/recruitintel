import { NextResponse } from "next/server";
import { createInterview, ApplicationNotFoundError } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, validationError, databaseApiError } from "@/lib/api";
import { z } from "zod";
const schema = z
  .object({
    interviewType: z.string().trim().min(1).max(100),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable().optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    recruiterProfileId: z.uuid().nullable().optional(),
  })
  .strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = schema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json(
      { data: await createInterview(actor.user.id, (await context.params).id, input.data) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
