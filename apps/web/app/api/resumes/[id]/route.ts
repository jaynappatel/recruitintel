import { NextResponse } from "next/server";
import { deleteResumeDocument, getResumeDocument, ResumeNotFoundError } from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    const { id } = await context.params;
    if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
    await deleteResumeDocument(actor.user.id, id);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    const { id } = await context.params;
    if (!isDatabaseUuid(id)) return apiError(400, "INVALID_REQUEST", "Invalid resume id");
    return NextResponse.json({
      data: await getResumeDocument(actor.user.id, id),
    });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
