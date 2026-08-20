import { NextResponse } from "next/server";

import { updateCalendarItem } from "@recruitintel/db";
import { calendarItemSchema, databaseUuidSchema } from "@recruitintel/types";

import { apiError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Calendar item ID must be a UUID");
  try {
    const item = await updateCalendarItem(currentOwnerId(), id.data, { status: "DONE" });
    return NextResponse.json({ data: calendarItemSchema.parse(item) });
  } catch (error) {
    return calendarApiError(error);
  }
}
