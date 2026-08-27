import { NextResponse } from "next/server";
import { uploadBrowserScan } from "@recruitintel/db";
import { browserScanUploadRequestSchema } from "@recruitintel/types";
import { validationError } from "@/lib/api";
import { browserCompanionApiError } from "@/lib/server/browser-companion-api-errors";
import {
  authorizationApiError,
  extensionCorsHeaders,
  requireExtensionGrant,
} from "@/lib/server/authorization";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: extensionCorsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const actor = await requireExtensionGrant(request, "PAGE_SCAN");
    const parsed = browserScanUploadRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const response = validationError(parsed.error);
      Object.entries(extensionCorsHeaders(request)).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      return response;
    }
    return NextResponse.json(
      { data: await uploadBrowserScan(actor.grant.userId, actor.grant.id, parsed.data) },
      { status: 201, headers: extensionCorsHeaders(request) },
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
