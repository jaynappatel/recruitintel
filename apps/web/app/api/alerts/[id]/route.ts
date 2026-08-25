import { NextResponse } from "next/server";

import { getAlert, updateAlert } from "@recruitintel/db";
import { alertSchema, alertUpdateSchema, databaseUuidSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

type Context = { params: Promise<{ id: string }> };

function parseId(value: string) {
  return databaseUuidSchema.safeParse(value);
}

export async function GET(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const id = parseId((await params).id);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Alert ID is invalid");
  try {
    return NextResponse.json({ data: alertSchema.parse(await getAlert(actor.user.id, id.data)) });
  } catch (error) {
    return personalizationApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const id = parseId((await params).id);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Alert ID is invalid");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = alertUpdateSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return NextResponse.json({
      data: alertSchema.parse(await updateAlert(actor.user.id, id.data, input.data.read)),
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}
