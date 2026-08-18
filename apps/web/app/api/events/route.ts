import { NextResponse } from "next/server";

import { listEvents } from "@recruitintel/db";
import { eventsQuerySchema, recruitingEventSchema } from "@recruitintel/types";

import { databaseApiError, validationError } from "@/lib/api";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = eventsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return validationError(parsed.error);
  try {
    const page = await listEvents(parsed.data);
    return NextResponse.json({
      data: page.items.map((event) => recruitingEventSchema.parse(event)),
      meta: { total: page.total, limit: parsed.data.limit, offset: parsed.data.offset },
    });
  } catch (error) {
    return databaseApiError(error);
  }
}
