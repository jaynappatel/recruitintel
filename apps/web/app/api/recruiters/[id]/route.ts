import { NextResponse } from "next/server";

import { getRecruiter, recordProductEvent } from "@recruitintel/db";
import { recruiterDetailSchema } from "@recruitintel/types";

import { apiError, databaseApiError } from "@/lib/api";
import { isDatabaseUuid } from "@/lib/identifiers";
import { optionalAuthenticatedUser } from "@/lib/server/authorization";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!isDatabaseUuid(id)) return apiError(400, "INVALID_IDENTIFIER", "Recruiter id is invalid");
  try {
    const recruiter = await getRecruiter(id);
    if (!recruiter) return apiError(404, "NOT_FOUND", "Recruiter was not found");
    const actor = await optionalAuthenticatedUser(request);
    if (actor) {
      await recordProductEvent({
        userId: actor.user.id,
        eventType: "RECRUITER_VIEWED",
        source: "SERVER",
        entityType: "RECRUITER",
        entityId: id,
        requestId: actor.requestId,
      });
    }
    return NextResponse.json({ data: recruiterDetailSchema.parse(recruiter) });
  } catch (error) {
    return databaseApiError(error);
  }
}
