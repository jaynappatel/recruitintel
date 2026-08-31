import { NextResponse } from "next/server";

import { markAllAlertsRead } from "@recruitintel/db";

import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  try {
    return NextResponse.json({ data: { updated: await markAllAlertsRead(actor.user.id) } });
  } catch (error) {
    return personalizationApiError(error);
  }
}
