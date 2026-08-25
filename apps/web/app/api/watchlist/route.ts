import { NextResponse } from "next/server";

import { addWatchlistItem, listWatchlist } from "@recruitintel/db";
import {
  watchlistCreateSchema,
  watchlistItemSchema,
  watchlistQuerySchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

export async function GET(request: Request) {
  const actor = await authenticatedUserOrResponse(request);
  if (actor instanceof Response) return actor;
  const query = watchlistQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return validationError(query.error);
  try {
    const page = await listWatchlist(actor.user.id, query.data);
    return NextResponse.json({
      data: page.items.map((item) => watchlistItemSchema.parse(item)),
      meta: { limit: query.data.limit, nextCursor: page.nextCursor },
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}

export async function POST(request: Request) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = watchlistCreateSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    const result = await addWatchlistItem(actor.user.id, input.data);
    return NextResponse.json(
      { data: watchlistItemSchema.parse(result.item), meta: { created: result.created } },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return personalizationApiError(error);
  }
}
