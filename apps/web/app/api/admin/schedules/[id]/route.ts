import { NextResponse } from "next/server";

import { recordAuditEvent, setScheduleEnabled } from "@recruitintel/db";
import { databaseUuidSchema, scheduleUpdateSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authorizationApiError, requireAdmin } from "@/lib/server/authorization";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) {
    return apiError(400, "INVALID_IDENTIFIER", "Schedule identifier is invalid");
  }
  const parsed = scheduleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const actor = await requireAdmin(request, "ORCHESTRATION_MUTATE");
    if (!(await setScheduleEnabled(id, parsed.data.enabled))) {
      return apiError(404, "NOT_FOUND", "Schedule was not found");
    }
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: parsed.data.enabled ? "SCHEDULE_ENABLED" : "SCHEDULE_DISABLED",
      resourceType: "SCHEDULE",
      resourceId: id,
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
    });
    return NextResponse.json({ data: { id, enabled: parsed.data.enabled } });
  } catch (error) {
    return authorizationApiError(error);
  }
}
