import { NextResponse } from "next/server";

import { removeWatchlistItem, updateWatchlistItem } from "@recruitintel/db";
import { databaseUuidSchema, watchlistItemSchema, watchlistPatchSchema } from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { authenticatedUserOrResponse } from "@/lib/server/authorization";
import { personalizationApiError } from "@/lib/server/personalization-api-errors";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = databaseUuidSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(400, "INVALID_REQUEST", "Watchlist item ID is invalid");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const input = watchlistPatchSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    return Response.json({
      data: watchlistItemSchema.parse(
        await updateWatchlistItem(actor.user.id, parsed.data, input.data),
      ),
    });
  } catch (error) {
    return personalizationApiError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const actor = await authenticatedUserOrResponse(request, { mutation: true });
  if (actor instanceof Response) return actor;
  const parsed = databaseUuidSchema.safeParse((await params).id);
  if (!parsed.success) return apiError(400, "INVALID_REQUEST", "Watchlist item ID is invalid");
  try {
    await removeWatchlistItem(actor.user.id, parsed.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return personalizationApiError(error);
  }
}
