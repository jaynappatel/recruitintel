import { NextResponse } from "next/server";

import { deleteApplicationPlan, getApplicationPlan, updateApplicationPlan } from "@recruitintel/db";
import {
  applicationPlanSchema,
  databaseUuidSchema,
  updateApplicationPlanRequestSchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

function parseId(rawId: string) {
  return databaseUuidSchema.safeParse(rawId);
}

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Application plan ID must be a UUID");
  try {
    const plan = await getApplicationPlan(currentOwnerId(), id.data);
    if (!plan) return apiError(404, "NOT_FOUND", "Application plan not found");
    return NextResponse.json({ data: applicationPlanSchema.parse(plan) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Application plan ID must be a UUID");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
  }
  const patch = updateApplicationPlanRequestSchema.safeParse(body);
  if (!patch.success) return validationError(patch.error);
  try {
    const plan = await updateApplicationPlan(currentOwnerId(), id.data, patch.data);
    return NextResponse.json({ data: applicationPlanSchema.parse(plan) });
  } catch (error) {
    return calendarApiError(error);
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Application plan ID must be a UUID");
  try {
    await deleteApplicationPlan(currentOwnerId(), id.data);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return calendarApiError(error);
  }
}
