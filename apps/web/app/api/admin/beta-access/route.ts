import { NextResponse } from "next/server";
import { grantBetaAccess, listBetaAccessGrants, BetaAccessValidationError } from "@recruitintel/db";
import { z } from "zod";
import { requireAdmin, authorizationApiError } from "@/lib/server/authorization";
import { apiError, databaseApiError, validationError } from "@/lib/api";

const schema = z.object({ email: z.string().trim().email().max(320) }).strict();
export async function GET(request: Request) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
    return NextResponse.json({ data: await listBetaAccessGrants() });
  } catch (error) {
    return authorizationApiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    if (actor.kind === "SERVICE")
      return apiError(403, "FORBIDDEN", "A user administrator is required");
    const input = schema.safeParse(await request.json().catch(() => null));
    if (!input.success) return validationError(input.error);
    return NextResponse.json(
      { data: await grantBetaAccess(actor.user.id, input.data.email) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof BetaAccessValidationError)
      return apiError(400, "INVALID_REQUEST", error.message);
    const authorization = authorizationApiError(error);
    return authorization.status === 500 ? databaseApiError(error) : authorization;
  }
}
