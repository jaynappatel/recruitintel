import { NextResponse } from "next/server";
import { approveOutreachDraft, OutreachConflictError } from "@recruitintel/db";
import { outreachApprovalSchema } from "@recruitintel/types";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = outreachApprovalSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json({
      data: await approveOutreachDraft(actor.user.id, (await params).id, parsed.data.version),
    });
  } catch (error) {
    if (error instanceof OutreachConflictError) return apiError(409, "CONFLICT", error.message);
    return databaseApiError(error);
  }
}
