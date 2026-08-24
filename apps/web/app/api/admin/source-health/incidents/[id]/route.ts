import { NextResponse } from "next/server";

import { recordAuditEvent, updateSourceIncidentStatus } from "@recruitintel/db";
import { databaseUuidSchema, sourceIncidentUpdateSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Source incident identifier is invalid");
  }
  const parsed = sourceIncidentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const actor = await requireAdmin(request, "ORCHESTRATION_MUTATE");
    if (!(await updateSourceIncidentStatus(id, parsed.data.status))) {
      return apiError(404, "NOT_FOUND", "Source incident was not found");
    }
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: "SOURCE_INCIDENT_UPDATED",
      resourceType: "SOURCE_INCIDENT",
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
