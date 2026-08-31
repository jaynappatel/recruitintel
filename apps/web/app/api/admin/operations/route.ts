import { NextResponse } from "next/server";

import { getOperationalDiagnostics } from "@recruitintel/db";

import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
    return NextResponse.json({ data: await getOperationalDiagnostics() });
  } catch (error) {
    return authorizationApiError(error);
  }
}
