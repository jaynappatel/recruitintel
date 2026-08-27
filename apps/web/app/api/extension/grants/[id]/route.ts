import { NextResponse } from "next/server";
import { refreshExtensionGrant, revokeExtensionGrant } from "@recruitintel/db";
import { z } from "zod";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

const refreshSchema = z
  .object({ expiresInSeconds: z.number().int().min(300).max(2_592_000) })
  .strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id } = await params;
  if (!isDatabaseUuid(id))
    return apiError(400, "INVALID_IDENTIFIER", "Extension grant id is invalid");
  const parsed = refreshSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json({
      data: await refreshExtensionGrant(actor.user.id, id, parsed.data.expiresInSeconds),
    });
  } catch (error) {
    return error instanceof Error && error.message.includes("not found")
      ? apiError(404, "NOT_FOUND", "Extension grant was not found")
      : databaseApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id } = await params;
  if (!isDatabaseUuid(id))
    return apiError(400, "INVALID_IDENTIFIER", "Extension grant id is invalid");
  try {
    if (!(await revokeExtensionGrant(actor.user.id, id)))
      return apiError(404, "NOT_FOUND", "Extension grant was not found");
    return new Response(null, { status: 204 });
  } catch (error) {
    return databaseApiError(error);
  }
}
