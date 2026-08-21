import { NextResponse } from "next/server";

import { updateCalendarItem } from "@recruitintel/db";
import { calendarItemSchema, databaseUuidSchema } from "@recruitintel/types";

import { apiError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Calendar item ID must be a UUID");
  try {
    const item = await updateCalendarItem(actor.user.id, id.data, { status: "DONE" });
    return NextResponse.json({ data: calendarItemSchema.parse(item) });
  } catch (error) {
    return calendarApiError(error);
  }
}
