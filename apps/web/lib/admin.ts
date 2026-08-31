import { recordAuditEvent } from "@recruitintel/db";

import { authorizationApiError, requireAdmin as resolveAdmin } from "@/lib/server/authorization";

export async function requireAdmin(request: Request) {
  try {
    const actor = await resolveAdmin(request);
    await recordAuditEvent({
      actorKind: actor.kind,
      actorUserId: "user" in actor ? actor.user.id : null,
      actorServicePrincipalId: "servicePrincipal" in actor ? actor.servicePrincipal.id : null,
      action: "ADMIN_API_AUTHORIZED",
      resourceType: "API_ROUTE",
      outcome: "SUCCEEDED",
      requestId: actor.requestId,
      ipHash: actor.ipHash,
      metadata: { method: request.method, path: new URL(request.url).pathname },
    });
    return null;
  } catch (error) {
    await recordAuditEvent({
      actorKind: "SYSTEM",
      action: "ADMIN_API_DENIED",
      resourceType: "API_ROUTE",
      outcome: "DENIED",
      metadata: { method: request.method, path: new URL(request.url).pathname },
    }).catch(() => undefined);
    return authorizationApiError(error);
  }
}
