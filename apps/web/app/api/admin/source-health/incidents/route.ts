import { NextResponse } from "next/server";

import { listSourceIncidents } from "@recruitintel/db";
import { sourceIncidentListQuerySchema } from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function GET(request: Request) {
  const parsed = sourceIncidentListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);
  try {
    await requireAdmin(request, "ORCHESTRATION_READ");
    return NextResponse.json({ data: await listSourceIncidents(parsed.data.status) });
  } catch (error) {
    return authorizationApiError(error);
  }
}
