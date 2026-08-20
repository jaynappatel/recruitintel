import { NextResponse } from "next/server";

import { deleteCalendarItem, updateCalendarItem } from "@recruitintel/db";
import {
  calendarItemSchema,
  databaseUuidSchema,
  updateCalendarItemRequestSchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
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
    const item = await updateCalendarItem(currentOwnerId(), id.data, patch.data);
    return NextResponse.json({ data: calendarItemSchema.parse(item) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Calendar item ID must be a UUID");
  try {
    await deleteCalendarItem(currentOwnerId(), id.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
