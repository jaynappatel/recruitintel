import { NextResponse } from "next/server";
import { createExtensionGrant, listExtensionGrants } from "@recruitintel/db";
import { createExtensionGrantRequestSchema } from "@recruitintel/types";
import { apiError, databaseApiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({ data: await listExtensionGrants(actor.user.id) });
  } catch (error) {
    return databaseApiError(error);
  }
}

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = createExtensionGrantRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    return NextResponse.json(
      { data: await createExtensionGrant(actor.user.id, parsed.data) },
      { status: 201 },
    );
  } catch (error) {
    return error instanceof Error && error.message.includes("Extension grant")
      ? apiError(400, "INVALID_REQUEST", error.message)
      : databaseApiError(error);
  }
}
