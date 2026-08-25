import { NextResponse } from "next/server";
import { archiveApplication, ApplicationNotFoundError } from "@recruitintel/db";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { apiError, databaseApiError } from "@/lib/api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: await archiveApplication(actor.user.id, (await context.params).id),
    });
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    return databaseApiError(error);
  }
}
