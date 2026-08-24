import { NextResponse } from "next/server";

import { listSourceHealth } from "@recruitintel/db";

import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
    return NextResponse.json({ data: await listSourceHealth() });
  } catch (error) {
    return authorizationApiError(error);
  }
}
