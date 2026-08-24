import { NextResponse } from "next/server";

import { listSafeWorkItems } from "@recruitintel/db";
import { orchestrationListQuerySchema } from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function GET(request: Request) {
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
  } catch (error) {
    return authorizationApiError(error);
  }
  const parsed = orchestrationListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    const page = await listSafeWorkItems(parsed.data);
    return NextResponse.json({ data: page.items, meta: { total: page.total, ...parsed.data } });
  } catch (error) {
    return authorizationApiError(error);
  }
}
