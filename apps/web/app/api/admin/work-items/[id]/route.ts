import { NextResponse } from "next/server";

import { getSafeWorkItem } from "@recruitintel/db";
import { databaseUuidSchema } from "@recruitintel/types";

import { apiError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
  } catch (error) {
    return authorizationApiError(error);
  }
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Work item identifier is invalid");
  }
  try {
    const item = await getSafeWorkItem(id);
    if (!item) return apiError(404, "NOT_FOUND", "Work item was not found");
    return NextResponse.json({ data: item });
  } catch (error) {
    return authorizationApiError(error);
  }
}
