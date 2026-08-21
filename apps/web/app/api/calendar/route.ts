import { NextResponse } from "next/server";

import { createCalendarItem, listCalendarItems } from "@recruitintel/db";
import {
  calendarItemSchema,
  calendarQuerySchema,
  createCalendarItemRequestSchema,
} from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { calendarApiError } from "@/lib/server/calendar-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const query = calendarQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return validationError(query.error);
  try {
    const items = await listCalendarItems(actor.user.id, query.data);
    return NextResponse.json({
      data: items.map((item) => calendarItemSchema.parse(item)),
      meta: { total: items.length },
    });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }
  const input = createCalendarItemRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    const item = await createCalendarItem(actor.user.id, input.data);
    return NextResponse.json({ data: calendarItemSchema.parse(item) }, { status: 201 });
  } catch (error) {
    return calendarApiError(error);
  }
}
