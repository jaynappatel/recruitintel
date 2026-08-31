import { NextResponse } from "next/server";
import { BetaAccessNotFoundError, revokeBetaAccess } from "@recruitintel/db";
import { requireAdmin, authorizationApiError } from "@/lib/server/authorization";
import { apiError, databaseApiError } from "@/lib/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin(request);
    if (actor.kind === "SERVICE")
      return apiError(403, "FORBIDDEN", "A user administrator is required");
    return NextResponse.json({
      data: await revokeBetaAccess(actor.user.id, (await context.params).id),
    });
  } catch (error) {
    if (error instanceof BetaAccessNotFoundError) return apiError(404, "NOT_FOUND", error.message);
    const authorization = authorizationApiError(error);
    return authorization.status === 500 ? databaseApiError(error) : authorization;
  }
}
