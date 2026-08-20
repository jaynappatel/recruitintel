import { NextResponse } from "next/server";

import { activateApplicationPlan } from "@recruitintel/db";
import {
  activateApplicationPlanRequestSchema,
  applicationPlanSchema,
  databaseUuidSchema,
} from "@recruitintel/types";

import { apiError, validationError } from "@/lib/api";
import { calendarApiError } from "@/lib/server/calendar-api-errors";
import { currentOwnerId } from "@/lib/server/current-owner";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id: rawId } = await params;
  const id = databaseUuidSchema.safeParse(rawId);
  if (!id.success) return apiError(400, "INVALID_REQUEST", "Application plan ID must be a UUID");
  let body: unknown = {};
  const raw = await request.text();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
  }
  const input = activateApplicationPlanRequestSchema.safeParse(body);
  if (!input.success) return validationError(input.error);
  try {
    const plan = await activateApplicationPlan(currentOwnerId(), id.data, input.data.sync);
    return NextResponse.json({ data: applicationPlanSchema.parse(plan) });
  } catch (error) {
    return calendarApiError(error);
  }
}
