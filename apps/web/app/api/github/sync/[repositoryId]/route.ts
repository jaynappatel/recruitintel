import { NextResponse } from "next/server";

import { enqueueGitHubSync } from "@recruitintel/db";
import { databaseUuidSchema, githubSyncRequestSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { requireAdmin } from "@/lib/admin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;
  const { repositoryId } = await params;
  if (!databaseUuidSchema.safeParse(repositoryId).success) {
    return apiError(400, "INVALID_IDENTIFIER", "GitHub repository identifier is invalid");
  }
  try {
    const syncRequest = await enqueueGitHubSync(repositoryId);
    if (!syncRequest) return apiError(404, "NOT_FOUND", "GitHub repository was not found");
    return NextResponse.json({ data: githubSyncRequestSchema.parse(syncRequest) }, { status: 202 });
  } catch (error) {
    return databaseApiError(error);
  }
}
