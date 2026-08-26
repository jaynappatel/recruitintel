import { NextResponse } from "next/server";
import { listResumeEvidence } from "@recruitintel/db";
import { databaseApiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({
      data: await listResumeEvidence(actor.user.id, (await context.params).id),
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
