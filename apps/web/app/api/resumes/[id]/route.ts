import { NextResponse } from "next/server";
import { deleteResumeDocument, ResumeNotFoundError } from "@recruitintel/db";
import { apiError, databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    await deleteResumeDocument(actor.user.id, (await context.params).id);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof ResumeNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
