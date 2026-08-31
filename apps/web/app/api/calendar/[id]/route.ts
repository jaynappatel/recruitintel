import { NextResponse } from "next/server";

import { deleteCalendarItem, updateCalendarItem } from "@recruitintel/db";
import {
  calendarItemSchema,
  databaseUuidSchema,
  updateCalendarItemRequestSchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Calendar item ID must be a UUID");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const patch = updateCalendarItemRequestSchema.safeParse(body);
  if (!patch.success) return validationError(patch.error);
  try {
    const item = await updateCalendarItem(actor.user.id, id.data, patch.data);
    return NextResponse.json({ data: calendarItemSchema.parse(item) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Calendar item ID must be a UUID");
  try {
    await deleteCalendarItem(actor.user.id, id.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
