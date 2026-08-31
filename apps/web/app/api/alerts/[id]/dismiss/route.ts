import { NextResponse } from "next/server";

import { dismissAlert } from "@recruitintel/db";
import { alertSchema, databaseUuidSchema } from "@recruitintel/types";

import { apiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const id = databaseUuidSchema.safeParse((await params).id);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Alert ID is invalid");
  try {
    return NextResponse.json({
      data: alertSchema.parse(await dismissAlert(actor.user.id, id.data)),
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
