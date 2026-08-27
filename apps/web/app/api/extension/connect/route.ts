import { NextResponse } from "next/server";
import {
  extensionCorsHeaders,
  requireExtensionGrant,
  authorizationApiError,
} from "@/lib/server/authorization";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: extensionCorsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const actor = await requireExtensionGrant(request, "PAGE_SCAN");
    return NextResponse.json(
      {
        data: {
          grantId: actor.grant.id,
          scopes: actor.grant.scopes,
          expiresAt: actor.grant.expiresAt,
        },
      },
      { headers: extensionCorsHeaders(request) },
    );
  } catch (error) {
    const response = authorizationApiError(error);
    Object.entries(extensionCorsHeaders(request)).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
