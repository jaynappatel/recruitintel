import { NextResponse } from "next/server";

import { recordAuditEvent, requeueGlobalDeadLetter } from "@recruitintel/db";
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
    const workItemId = await requeueGlobalDeadLetter(id);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: "WORK_ITEM_REQUEUED",
      resourceType: "WORK_ITEM",
      resourceId: id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
      metadata: { requeuedWorkItemId: workItemId },
    });
    return NextResponse.json({ data: { id: workItemId, status: "READY" } }, { status: 202 });
  } catch (error) {
    return authorizationApiError(error);
  }
}
