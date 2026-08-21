import { NextResponse } from "next/server";

import { enqueueWebCandidateFetch } from "@recruitintel/db";
import { databaseUuidSchema, publicWebWorkRequestSchema } from "@recruitintel/types";

import { requireAdmin } from "@/lib/admin";
import { apiError, databaseApiError } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Candidate identifier is invalid");
  }
  try {
    const workRequest = await enqueueWebCandidateFetch(id);
    if (!workRequest) return apiError(404, "NOT_FOUND", "Public web candidate was not found");
    return NextResponse.json(
      { data: publicWebWorkRequestSchema.parse(workRequest) },
      { status: 202 },
    );
  } catch (error) {
    return databaseApiError(error);
  }
}
