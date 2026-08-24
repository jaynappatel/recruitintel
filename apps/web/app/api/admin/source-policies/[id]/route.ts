import { NextResponse } from "next/server";

import { recordAuditEvent, updateSourcePolicy } from "@recruitintel/db";
import { databaseUuidSchema, sourcePolicyUpdateSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Source policy identifier is invalid");
  }
  const parsed = sourcePolicyUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const actor = await requireAdmin(request, "ORCHESTRATION_MUTATE");
    if (!(await updateSourcePolicy(id, parsed.data))) {
      return apiError(404, "NOT_FOUND", "Source policy was not found");
    }
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: "SOURCE_POLICY_UPDATED",
      resourceType: "SOURCE_POLICY",
      resourceId: id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
      metadata: { status: parsed.data.status },
    });
    return NextResponse.json({ data: { id, status: parsed.data.status } });
  } catch (error) {
    return authorizationApiError(error);
  }
}
