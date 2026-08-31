import { NextResponse } from "next/server";
import { selectBrowserCandidate } from "@recruitintel/db";
import { browserCandidateSelectionRequestSchema } from "@recruitintel/types";
import { apiError, validationError } from "@/lib/api";
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireExtensionGrant(request, "JOB_IMPORT");
    const { id } = await params;
    if (!isDatabaseUuid(id))
      return apiError(400, "INVALID_IDENTIFIER", "Browser candidate id is invalid");
    const parsed = browserCandidateSelectionRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return validationError(parsed.error);
    return NextResponse.json(
      {
        data: await selectBrowserCandidate(
          actor.grant.userId,
          id,
          parsed.data.candidateRevision,
          parsed.data.idempotencyKey,
        ),
      },
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
