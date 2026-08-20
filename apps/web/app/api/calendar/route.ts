import { NextResponse } from "next/server";

import { createCalendarItem, listCalendarItems } from "@recruitintel/db";
import {
  calendarItemSchema,
  calendarQuerySchema,
  createCalendarItemRequestSchema,
} from "@recruitintel/types";

import { validationError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

export async function GET(request: Request) {
  const query = calendarQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return validationError(query.error);
  try {
    const items = await listCalendarItems(currentOwnerId(), query.data);
    return NextResponse.json({
      data: items.map((item) => calendarItemSchema.parse(item)),
      meta: { total: items.length },
    });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function POST(request: Request) {
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
    const item = await createCalendarItem(currentOwnerId(), input.data);
    return NextResponse.json({ data: calendarItemSchema.parse(item) }, { status: 201 });
  } catch (error) {
    return calendarApiError(error);
  }
}
