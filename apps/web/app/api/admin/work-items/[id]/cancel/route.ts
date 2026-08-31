import { NextResponse } from "next/server";

import { cancelGlobalWork, recordAuditEvent } from "@recruitintel/db";
import { databaseUuidSchema } from "@recruitintel/types";

import { apiError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Work item identifier is invalid");
  }
  try {
    const actor = await requireAdmin(request, "ORCHESTRATION_MUTATE");
    if (!(await cancelGlobalWork(id))) {
      return apiError(404, "NOT_FOUND", "Cancellable global work item was not found");
    }
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: "WORK_ITEM_CANCELLED",
      resourceType: "WORK_ITEM",
      resourceId: id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return NextResponse.json({ data: { id, cancellationRequested: true } });
  } catch (error) {
    return authorizationApiError(error);
  }
}
