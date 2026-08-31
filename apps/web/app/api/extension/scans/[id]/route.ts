import { NextResponse } from "next/server";
import { getBrowserScan } from "@recruitintel/db";
import { apiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { browserCompanionApiError } from "@/lib/server/browser-companion-api-errors";
import {
  authorizationApiError,
  extensionCorsHeaders,
  requireExtensionGrant,
} from "@/lib/server/authorization";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: extensionCorsHeaders(request) });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireExtensionGrant(request, "PAGE_SCAN");
    const { id } = await params;
    if (!isDatabaseUuid(id))
      return apiError(400, "INVALID_IDENTIFIER", "Browser scan id is invalid");
    return NextResponse.json(
      { data: await getBrowserScan(actor.grant.userId, id) },
      { headers: extensionCorsHeaders(request) },
    );
  } catch (error) {
    const response =
      error instanceof Error && error.name === "AuthorizationError"
        ? authorizationApiError(error)
        : browserCompanionApiError(error);
    Object.entries(extensionCorsHeaders(request)).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
